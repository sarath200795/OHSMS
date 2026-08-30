// ─────────────────────────────────────────────────────────────────────────────
// Cloud Functions entry point.
//
// package.json named this file as `main` long before it existed — everything
// under lib/ was library code with nothing calling it. That is why
// `firebase deploy --only functions` had nothing to deploy.
//
// The first thing here was the smallest change that closes SECURITY.md S-01:
// putting the caller's organization onto their ID token so Cloud Storage rules
// can read it. Storage rules cannot query Firestore, so without a claim they
// have no way to tell one tenant from another — which is exactly why any
// signed-in user could reach any org's files.
// ─────────────────────────────────────────────────────────────────────────────
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import { logger } from 'firebase-functions'
import { claimsFor, claimsChanged, mergeClaims, revokesAccess } from './lib/claims.js'
import { planBackfill } from './lib/docVisibility.js'
import { classifyLocks } from './lib/defectLocks.js'
import { PURGEABLE, PURGE_AFTER_DAYS, MAX_PURGES_PER_RUN, planPurge, summarizeFailures } from './lib/retention.js'
import { mayDeleteFile } from './lib/fileDelete.js'
import { planExport, planScan, scanFeasibility, classifyErasure } from './lib/subjectData.js'
import { planWithdrawals, withdrawnFields, MAX_WITHDRAWALS_PER_RUN } from './lib/permitMirror.js'
import { planQrBackfill, QR_SOURCES } from './lib/qrMirrors.js'
import { planMedicalStrip, planInjurySeed } from './lib/incidentMedical.js'
import { planSiteLinks, LINKABLE_COLLECTIONS } from './lib/siteLinks.js'
import { planMedicalRecordMove, landedIntact, MEDICAL_RECORD_KIND } from './lib/medicalRecords.js'
import { KEY_DOC_PATH, generateKeyset, releaseKeyset, grantsFor, unwrapKey, fromB64u } from './lib/dataKeys.js'
import {
  configPath, normalizeConfig, redactConfig, readiness, checkBaseUrl, sourcesFor,
  cardQueryUrl, cardUrl, currentUserUrl, normalizeRows, capRows,
  buildDateParams, safeRange,
} from './lib/metabase.js'
import {
  FILE_TARGETS, MAX_OBJECTS_PER_RUN, needsObjectSealing, sealedPath,
  sealObjectBytes, openObjectBytes, sameBytes, pointerUpdate,
} from './lib/objectSeal.js'

initializeApp()

/**
 * The master key every organization's data keys are wrapped under.
 *
 * defineSecret, not process.env. With firebase-functions v2 a plain env var
 * lives in the Cloud Run service configuration in cleartext, readable by anyone
 * with project Viewer, absent from Secret Manager's versioning, access log and
 * rotation — which is ISO 27001 audit finding LOW-13, recorded against a mail
 * API key that no longer exists. This one opens every sealed field in every
 * tenant, so it is the last credential in this project that should repeat it.
 *
 * Set it once with:
 *
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))" \
 *     | firebase functions:secrets:set DATA_KEY_MASTER
 *
 * LOSING THIS VALUE DESTROYS EVERY ENCRYPTED RECORD IN EVERY TENANT. It is not
 * derived from anything and it is not recoverable from the database — the
 * wrapped keys in Firestore are useless without it. Secret Manager keeps
 * versions, so the operational rule is: never disable an old version until the
 * rotation that replaced it has been verified against real data.
 */
const DATA_KEY_MASTER = defineSecret('DATA_KEY_MASTER')

// Keep the functions beside the data they trigger on. This project's Firestore
// is in asia-south1 (Mumbai), and a Firestore trigger's Eventarc plumbing is
// created in the DATABASE's region regardless of where the function runs — so a
// function anywhere else means every profile write crosses a continent twice
// before anything happens. It also bills egress for the privilege.
//
// The callable is pinned to the same region deliberately: the client has to
// name it when calling (getFunctions(app, REGION)), and two regions in one file
// is one more thing to get wrong at the call site.
const REGION = 'asia-south1'

// The timezone a scheduled run's clock time means. A retention sweep pinned to
// UTC would move around the working day twice a year for everyone reading the
// logs, and "03:30" is chosen to be the quiet part of THEIR night.
const SCHEDULE_TZ = 'Asia/Kolkata'

// The bucket, resolved on first use rather than at import. Two jobs reach it —
// the retention sweep, which deletes the object behind a purged pointer, and the
// medical-record move, which copies one from the photo prefix to the manager-only
// one — and neither runs at deploy time, so nothing here should touch Storage
// while the module is merely being loaded.
let bucket = null
const getBucket = () => (bucket ||= getStorage().bucket())

/**
 * Reject a caller-supplied value that is about to become ONE segment of a
 * Firestore path.
 *
 * The Admin SDK happily accepts a slash inside what the caller believes is a
 * document id, so a doc() built from uid = "a/b/c" silently addresses a
 * different document in a different collection — the id stops naming the thing
 * the surrounding permission check was made about. The same applies to "." and
 * ".." (path traversal), to the reserved __name__ shape, and to control
 * characters, which render invisibly in every log and console anyone would use
 * to investigate afterwards.
 *
 * This used to mirror an assertSegment in server/src/routes/orgCollection.js.
 * That package is gone — it served no traffic and was removed rather than
 * maintained — so this is now the only copy and nothing needs keeping in step
 * with it.
 *
 * Exported for index.test.js, not for deploy: function discovery only picks up
 * exports carrying an __endpoint, which a plain function does not.
 */
export function assertPathSegment(value, what) {
  const bad =
    typeof value !== 'string' ||
    value === '' ||
    value === '.' ||
    value === '..' ||
    value.includes('/') ||
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f]/.test(value) ||
    /^__.*__$/.test(value) ||
    Buffer.byteLength(value, 'utf8') > 1500
  if (bad) {
    throw new HttpsError('invalid-argument', `${what} is not a usable id.`)
  }
}

/**
 * Mirror /users/{uid} onto the ID token.
 *
 * Triggered on every write to a profile, including deletion. `claimsFor`
 * decides what the token should say — the important part being that only an
 * APPROVED member gets an orgId, so a pending joiner cannot mint themselves
 * access to a tenant's files simply by naming it at signup.
 *
 * Not idempotent-by-luck but idempotent-by-design: identical claims are skipped
 * rather than rewritten, because each write invalidates the client's cached
 * token, and this document is edited for unrelated reasons all the time.
 */
export const syncUserClaims = onDocumentWritten(
  { document: 'users/{uid}', region: REGION },
  async (event) => {
    const { uid } = event.params
    const after = event.data?.after?.data() || null

    let existing = {}
    try {
      const record = await getAuth().getUser(uid)
      existing = record.customClaims || {}
    } catch (err) {
      // The auth user can legitimately be gone — an account deleted, with its
      // profile cleaned up after. Nothing to stamp, and retrying will not help.
      if (err?.code === 'auth/user-not-found') {
        logger.info('claims: no auth user, nothing to sync', { uid })
        return
      }
      throw err
    }

    const next = claimsFor(after)
    if (!claimsChanged(existing, next)) return

    await getAuth().setCustomUserClaims(uid, mergeClaims(existing, next))

    // A REDUCTION also has to end the existing session.
    //
    // Firestore re-reads the profile on every rule evaluation, so a revoked
    // member loses Firestore access the instant this document changes. Cloud
    // Storage does not — storage.rules reads orgId and role off the presented
    // TOKEN, which stays valid for up to an hour. Without this, someone
    // suspended, moved to another tenant, or demoted out of the roles that can
    // delete keeps that access for the rest of the hour, holding a token that
    // names an organization they have left.
    //
    // Only on reductions: revoking on a promotion or a first approval would
    // interrupt somebody mid-task and close no window at all.
    if (revokesAccess(existing, next)) {
      try {
        await getAuth().revokeRefreshTokens(uid)
        logger.info('claims: sessions revoked', { uid, from: existing?.orgId || null, to: next.orgId })
      } catch (e) {
        // The claim change is the control; this narrows the window it leaves.
        // Failing here must not undo the claim write that already succeeded.
        logger.error('claims: could not revoke sessions', { uid, error: e?.message || String(e) })
      }
    }

    // Nothing is written back to Firestore here, deliberately: a write to
    // /users would re-trigger this same function, and that loop would be silent
    // and billable. The client picks the new claim up by forcing a token
    // refresh on sign-in (see AuthContext), which is where it matters — a
    // freshly approved user signs in again anyway.
    logger.info('claims: updated', { uid, orgId: next.orgId, role: next.role })
  }
)

/**
 * Stamp every existing user, once.
 *
 * The trigger above only fires on a write, so the people already in the system
 * would carry no claim until someone happened to edit their profile — and until
 * they do, the stricter storage rules would lock them out of their own files.
 * This is the one-off that makes the cutover safe. Idempotent, so it can be run
 * again without consequence.
 *
 * Admin-only, and scoped to the caller's own organization: this is a support
 * tool, not a way to enumerate another tenant.
 */
export const backfillClaims = onCall({ region: REGION }, async (request) => {
  const callerUid = request.auth?.uid
  if (!callerUid) throw new HttpsError('unauthenticated', 'Sign in first.')

  const db = getFirestore()
  const caller = (await db.doc(`users/${callerUid}`).get()).data()
  if (!caller || caller.status !== 'approved' || caller.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Administrators only.')
  }

  const members = await db.collection('users').where('orgId', '==', caller.orgId).get()

  let updated = 0
  const failed = []
  // Skips were a single number, and that was not enough to explain a run that
  // did nothing. "0 updated, 2 skipped" is either "everyone was already
  // correct" or "nobody qualified" — opposite meanings, and the second one is
  // the reason the storage cutover must not proceed. Each reason is counted
  // separately now so the answer is in the result rather than in a guess.
  const skipped = { alreadyCorrect: 0, notApproved: 0, noAuthUser: 0 }

  for (const doc of members.docs) {
    const uid = doc.id
    const data = doc.data()
    try {
      const record = await getAuth().getUser(uid)
      const existing = record.customClaims || {}
      const next = claimsFor(data)

      if (!claimsChanged(existing, next)) {
        // Nulls on both sides is not "already correct" — it is a person who
        // does not qualify for a claim at all, almost always because their
        // status is not 'approved'.
        if (next.orgId) skipped.alreadyCorrect += 1
        else skipped.notApproved += 1
        continue
      }
      await getAuth().setCustomUserClaims(uid, mergeClaims(existing, next))
      updated += 1
    } catch (err) {
      // A /users document whose id is not an auth uid — the usual cause is a
      // profile created by hand. It can never receive a claim, so it would sit
      // in the skip count forever looking like a success.
      if (err?.code === 'auth/user-not-found') {
        skipped.noAuthUser += 1
        continue
      }
      failed.push(uid)
      logger.error('claims: backfill failed for one user', { uid, code: err?.code })
    }
  }

  const stamped = updated + skipped.alreadyCorrect
  logger.info('claims: backfill complete', { orgId: caller.orgId, updated, ...skipped, failed: failed.length })
  return {
    orgId: caller.orgId,
    total: members.size,
    updated,
    stamped, // how many now carry a claim — the number the cutover depends on
    ...skipped,
    failed,
  }
})

/**
 * Hand the signed-in member the encryption keys their role entitles them to.
 *
 * Called once per session by src/shared/crypto/keyring.js, which caches the
 * result in memory for the life of the tab and never persists it.
 *
 * This callable IS the access control for encrypted data. The rules decide who
 * can read a DOCUMENT; this decides who can read what is inside it, and the two
 * are written to agree line for line — see grantsFor() in lib/dataKeys.js,
 * where every branch names the rules helper it copies. The one that matters is
 * the medical private key: `role in ['admin','manager']`, which is isManagerOf,
 * which is what /injuries, /injuries/records and /illnesses are gated on. An
 * auditor is an outside party with a login and does not get it, so if that rule
 * is ever widened by accident they are handed ciphertext rather than a named
 * colleague's medication.
 *
 * The keyset is created on first call rather than at sign-up, so no
 * organization needs a migration to start using this and an org that never
 * writes an encrypted field never gets a key. It is created INSIDE A
 * TRANSACTION because two tabs opening at once would otherwise each generate a
 * keyset and the second would overwrite the first — leaving every value written
 * in the intervening seconds sealed under a key no longer stored anywhere.
 * That is unrecoverable data loss from a race that would show up once in a
 * thousand sign-ins and never in testing.
 *
 * Notably absent: any parameter. The caller does not name an organization, a
 * role or a key class — all three are read from their own /users profile, so
 * there is nothing to tamper with in the request.
 */
export const getDataKeys = onCall({ region: REGION, secrets: [DATA_KEY_MASTER] }, async (request) => {
  const callerUid = request.auth?.uid
  if (!callerUid) throw new HttpsError('unauthenticated', 'Sign in first.')

  const db = getFirestore()
  const caller = (await db.doc(`users/${callerUid}`).get()).data()
  const grants = grantsFor(caller)
  if (!grants.general) {
    // Covers unapproved, suspended, and anyone still on a temporary password.
    // Deliberately says nothing about which: a probe should not learn its own
    // status from the error text.
    throw new HttpsError('permission-denied', 'Approved members only.')
  }

  const orgId = caller.orgId
  if (!orgId) throw new HttpsError('failed-precondition', 'Your profile names no organization.')

  const master = DATA_KEY_MASTER.value()
  const ref = db.doc(KEY_DOC_PATH(orgId))

  // The common path: the keyset exists, and this is one read outside any
  // transaction. Only the first caller in an organization's life pays for the
  // transaction below.
  let keyset = (await ref.get()).data()
  if (!keyset) {
    keyset = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      if (snap.exists) return snap.data()
      const fresh = await generateKeyset(master, orgId, 1)
      tx.set(ref, { ...fresh, createdAt: FieldValue.serverTimestamp() })
      return fresh
    })
    logger.info('crypto: keyset created', { orgId })
  }

  // Cloud Logging, not the app's audit log. This runs on every session start,
  // so an /auditLogs entry per call would bury the actions people actually
  // review under one row per page load — and the audit log is read in the app
  // by the very roles this is recording.
  logger.info('crypto: keys released', {
    orgId,
    uid: callerUid,
    role: caller.role || null,
    medicalPrivate: grants.medicalPrivate,
  })

  return releaseKeyset(master, orgId, keyset, caller)
})

/**
 * Encrypt the objects already sitting in the bucket.
 *
 * `files: true` in the client policy sealed every NEW upload. Every photo,
 * drill evidence shot and attachment uploaded before that is still lying in
 * Cloud Storage in the clear — readable by anything that reaches the bucket
 * rather than the app. Same sentence as every migration above it: closing the
 * write path closes nothing already written.
 *
 * This is the ONE part of the encryption work that runs server-side. The field
 * backfill deliberately runs in the browser to avoid duplicating the policy
 * across the functions/ seam; that argument does not survive gigabytes of
 * objects, so this pays the duplication price instead — narrowed to four
 * constants and held in step by a test that seals with this code and opens with
 * the client's (src/shared/crypto/objectSeal.crossSeam.test.js).
 *
 * Reports without touching anything unless `dryRun: false`.
 *
 * ORDERING IS THE SAFETY PROPERTY, and it is the same one confineMedicalRecords
 * uses: write the sealed copy to a new path, download it back and decrypt it,
 * re-point the document, and only then delete the original. Sealing in place
 * would overwrite the only copy with bytes nobody has read back — one truncated
 * upload and the photograph is gone with the pointer still naming it.
 */
export const sealStoredObjects = onCall(
  { region: REGION, timeoutSeconds: 540, memory: '1GiB', secrets: [DATA_KEY_MASTER] },
  async (request) => {
    const dryRun = request.data?.dryRun !== false
    const callerUid = request.auth?.uid
    if (!callerUid) throw new HttpsError('unauthenticated', 'Sign in first.')

    const db = getFirestore()
    const caller = (await db.doc(`users/${callerUid}`).get()).data()
    if (!caller || caller.status !== 'approved' || caller.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Administrators only.')
    }
    const orgId = caller.orgId
    if (!orgId) throw new HttpsError('failed-precondition', 'Your profile names no organization.')

    // The keyset, unwrapped once for the whole run. Both halves of the medical
    // keypair: the public one seals, and the private one is held ONLY to verify
    // — nothing below writes with it.
    const master = DATA_KEY_MASTER.value()
    const keyset = (await db.doc(KEY_DOC_PATH(orgId)).get()).data()
    if (!keyset) {
      // Nothing has ever been sealed in this tenant, so there is no key these
      // objects could be sealed under. Creating one here would work, and would
      // be the wrong moment: the app has not been switched on, and a keyset
      // minted by a migration is one nobody knows exists.
      throw new HttpsError(
        'failed-precondition',
        'This organization has no encryption keys yet. Sign in with encryption switched on first.',
      )
    }
    const keys = {
      general: {
        keyId: keyset.general.keyId,
        key: await unwrapKey(master, orgId, keyset.general.keyId, keyset.general.wrappedKey),
      },
      medical: {
        keyId: keyset.medical.keyId,
        publicKey: fromB64u(keyset.medical.publicKey),
        privateKey: await unwrapKey(master, orgId, keyset.medical.keyId, keyset.medical.wrappedPrivateKey),
      },
    }

    const bucket = getBucket()
    const base = `organizations/${orgId}`
    const results = []
    const blocked = []
    const failed = []
    let budget = MAX_OBJECTS_PER_RUN
    let remaining = 0

    for (const target of FILE_TARGETS) {
      let scanned = 0
      let sealed = 0
      let already = 0
      let inline = 0

      const parents = await db.collection(`${base}/${target.parent}`).get()
      for (const parent of parents.docs) {
        const pointers = await db.collection(`${base}/${target.parent}/${parent.id}/${target.sub}`).get()
        for (const p of pointers.docs) {
          scanned += 1
          const data = p.data()
          // Counted apart from `already`, because conflating them is what hid a
          // real gap. A pointer with no `path` holds the image base64 INSIDE the
          // document — the no-bucket fallback — so there is nothing here to
          // seal, and reporting it as "already encrypted" told an operator the
          // opposite of the truth. It is the FIELD policy that covers those, and
          // whether it does is worth being able to see from this report.
          if (!String(data.path ?? '').trim()) { inline += 1; continue }
          if (!needsObjectSealing(data)) { already += 1; continue }
          if (budget <= 0) { remaining += 1; continue }

          // NEVER the filename, here or in any report below. "MRI-left-knee —
          // A Kumar.pdf" is the record; a migration log must not become one more
          // copy of the thing it is confining. The collection and the document
          // id find any row and carry nothing clinical.
          const row = { collection: target.collection, id: p.id }

          const toPath = sealedPath(data.path, orgId)
          if (!toPath) { blocked.push({ ...row, reason: 'foreign-path' }); continue }
          if (dryRun) { sealed += 1; budget -= 1; continue }

          try {
            const [plain] = await bucket.file(data.path).download()
            const out = await sealObjectBytes(keys, orgId, target.keyClass, new Uint8Array(plain))

            // 1. The bytes, to a NEW path. The original is untouched.
            await bucket.file(toPath).save(Buffer.from(out.bytes), {
              contentType: 'application/octet-stream',
              resumable: false,
            })

            // 2. Read it back and decrypt it. This is what licences the delete:
            //    a truncated upload or a wrong key fails here, with the original
            //    still exactly where it was.
            const [written] = await bucket.file(toPath).download()
            const reopened = await openObjectBytes(keys, orgId, target.keyClass, out, new Uint8Array(written))
            if (!sameBytes(new Uint8Array(plain), reopened)) {
              failed.push({ ...row, reason: 'failed-verify' })
              await bucket.file(toPath).delete({ ignoreNotFound: true })
              continue
            }

            // 3. The pointer, now that the sealed object is proven readable.
            await p.ref.update(pointerUpdate(out, toPath))

            // 4. The plaintext original, last of all. A failure here is an
            //    orphan — a cost, not a correctness bug — but it is the one
            //    that leaves the exposure open, so it is reported rather than
            //    swallowed.
            try {
              await bucket.file(data.path).delete({ ignoreNotFound: true })
            } catch (e) {
              failed.push({ ...row, reason: 'original-left-behind' })
              logger.error('objects: sealed but could not delete the plaintext', {
                orgId, collection: target.collection, id: p.id, error: e?.message || String(e),
              })
            }

            sealed += 1
            budget -= 1
          } catch (e) {
            failed.push({ ...row, reason: 'failed' })
            logger.error('objects: could not seal', {
              orgId, collection: target.collection, id: p.id, error: e?.message || String(e),
            })
          }
        }
      }
      results.push({ collection: target.collection, scanned, sealed, alreadySealed: already, inline })
    }

    logger.info('objects: seal run complete', {
      orgId, dryRun,
      sealed: results.reduce((n, r) => n + r.sealed, 0),
      blocked: blocked.length, failed: failed.length, remaining,
    })

    return {
      dryRun,
      results,
      scannedTotal: results.reduce((n, r) => n + r.scanned, 0),
      sealedTotal: results.reduce((n, r) => n + r.sealed, 0),
      alreadySealedTotal: results.reduce((n, r) => n + r.alreadySealed, 0),
      // Files held base64 inside their pointer instead of in the bucket. Not an
      // error and not sealed by THIS job — the field policy owns them — but a
      // number an operator has to be able to see rather than infer.
      inlineTotal: results.reduce((n, r) => n + r.inline, 0),
      remaining,
      blocked,
      blockedTotal: blocked.length,
      failed,
      failedTotal: failed.length,
    }
  },
)

/**
 * Stamp `visibility` onto documents written before site scoping existed.
 *
 * The same job as scripts/backfill-document-visibility.mjs, reachable without
 * holding a production password in a shell. Admin-only and scoped to the
 * caller's own organization, like backfillClaims beside it, and idempotent for
 * the same reason: it only touches documents that carry no visibility yet.
 *
 * This is not tidy-up. firestore.rules reads the field directly — it must, or
 * the condition stops constraining list queries — and direct access to a field
 * that is not there errors, which denies. So until a document is stamped it is
 * readable by nobody except admins, managers and auditors.
 */
export const backfillDocumentVisibility = onCall({ region: REGION }, async (request) => {
  const callerUid = request.auth?.uid
  if (!callerUid) throw new HttpsError('unauthenticated', 'Sign in first.')

  const db = getFirestore()
  const caller = (await db.doc(`users/${callerUid}`).get()).data()
  if (!caller || caller.status !== 'approved' || caller.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Administrators only.')
  }
  const orgId = caller.orgId

  const [sitesSnap, docsSnap] = await Promise.all([
    db.collection(`organizations/${orgId}/sites`).get(),
    db.collection(`organizations/${orgId}/documents`).get(),
  ])
  const sites = new Map(sitesSnap.docs.map((d) => [d.id, d.data()]))
  const plan = planBackfill(docsSnap.docs.map((d) => ({ id: d.id, data: d.data() })), sites)

  // dryRun is the default. Reporting first and writing only when asked is what
  // the script does, and this is the same operation with the same stakes.
  const dryRun = request.data?.dryRun !== false
  if (!dryRun) {
    // Chunked: a batch takes 500 writes, and a library can exceed that.
    for (let i = 0; i < plan.writes.length; i += 400) {
      const batch = db.batch()
      plan.writes.slice(i, i + 400).forEach((w) => {
        batch.update(db.doc(`organizations/${orgId}/documents/${w.id}`), w.patch)
      })
      await batch.commit()
    }
  }

  logger.info('documents: visibility backfill', {
    orgId, dryRun, total: docsSnap.size, toWrite: plan.writes.length,
  })

  return {
    orgId,
    dryRun,
    total: docsSnap.size,
    alreadyStamped: plan.alreadyStamped,
    written: dryRun ? 0 : plan.writes.length,
    wouldWrite: plan.writes.length,
    orgWide: plan.orgWide,
    siteScoped: plan.siteScoped,
    titles: plan.writes.slice(0, 25).map((w) => w.title),
  }
})

/**
 * Stamp orgId onto QR mirrors written before the field existed.
 *
 * /qr/{token} is the public copy a scanned label resolves to, and its update
 * rule reads resource.data.orgId DIRECTLY. Reading an absent field raises in
 * Firestore rules, and a raising rule denies — so a mirror predating that field
 * cannot be updated by anybody. The bulk extinguisher import writes each asset
 * and its mirror in one batch, so ONE legacy document refuses the whole upload:
 * 771 rows, one stale mirror, everything denied. Reproduced on the emulator.
 *
 * A callable rather than a script because no client can do this. /qr denies
 * list outright, so the mirrors cannot even be enumerated from the browser, and
 * the write that would fix each one is the write the rule is refusing. Only the
 * Admin SDK, which bypasses rules, can break that deadlock.
 *
 * The rule is not being loosened to accept an absent orgId. That would let
 * anyone who scans a label claim its mirror into their own organization and
 * control what the label then displays — defacement of a safety notice. The
 * data is what is stale, so the data is what gets fixed.
 *
 * dryRun defaults to TRUE. Report first, write when asked.
 */
export const backfillQrMirrors = onCall({ region: REGION, timeoutSeconds: 540 }, async (request) => {
  const callerUid = request.auth?.uid
  if (!callerUid) throw new HttpsError('unauthenticated', 'Sign in first.')

  const db = getFirestore()
  const caller = (await db.doc(`users/${callerUid}`).get()).data()
  if (!caller || caller.status !== 'approved' || caller.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Administrators only.')
  }
  const orgId = caller.orgId

  // Every asset in this org that names a token, across all three collections
  // that share /qr.
  const snaps = await Promise.all(
    QR_SOURCES.map((c) => db.collection(`organizations/${orgId}/${c}`).get()),
  )
  const assets = []
  snaps.forEach((snap, i) => {
    snap.docs.forEach((d) => {
      const qrToken = d.data()?.qrToken
      if (qrToken) assets.push({ collection: QR_SOURCES[i], id: d.id, qrToken })
    })
  })

  // Read the mirrors by id. getAll takes 300 refs at a time; a mirror that is
  // absent comes back with exists === false, which the plan reports rather than
  // inventing a payload for.
  const mirrors = new Map()
  const tokens = [...new Set(assets.map((a) => a.qrToken))]
  for (let i = 0; i < tokens.length; i += 300) {
    const refs = tokens.slice(i, i + 300).map((t) => db.doc(`qr/${t}`))
    const docs = await db.getAll(...refs)
    docs.forEach((d, j) => mirrors.set(tokens[i + j], d.exists ? d.data() : null))
  }

  const plan = planQrBackfill(assets, mirrors, orgId)

  const dryRun = request.data?.dryRun !== false
  if (!dryRun) {
    for (let i = 0; i < plan.writes.length; i += 400) {
      const batch = db.batch()
      plan.writes.slice(i, i + 400).forEach((w) => {
        batch.update(db.doc(`qr/${w.token}`), w.patch)
      })
      await batch.commit()
    }
  }

  logger.info('qr: mirror orgId backfill', {
    orgId, dryRun, assets: assets.length, toWrite: plan.writes.length,
    foreign: plan.foreign.length, missingMirror: plan.missingMirror.length,
  })

  return {
    orgId,
    dryRun,
    assets: assets.length,
    alreadyStamped: plan.alreadyStamped,
    written: dryRun ? 0 : plan.writes.length,
    wouldWrite: plan.writes.length,
    // Both are reported, never guessed at: a mirror naming another tenant, and
    // an asset whose mirror is gone. Each needs a human, not a default.
    foreign: plan.foreign,
    missingMirror: plan.missingMirror.slice(0, 50),
    missingMirrorTotal: plan.missingMirror.length,
  }
})

/**
 * Give equipment the siteId it was created without.
 *
 * Extinguishers, AEDs and FAS devices predate sites being first-class. They came
 * from a system that knew a site only as a free-text "Center Name", so much of
 * the estate carries a centre name printed on a physical label and no siteId at
 * all. Everything that joins through the site registry — the display fill-in in
 * siteResolve.js, the analytics roll-ups, the site filters — sees nothing for
 * those records.
 *
 * What it does NOT do, said plainly because the name invites the wrong
 * expectation: no rule in firestore.rules reads a siteId on any of these three
 * collections today, so this grants nobody access and hides nothing. It repairs
 * the joins, and it is the prerequisite for scoping equipment by site later —
 * which is exactly why a wrong link is expensive. A guess made today becomes an
 * access decision the day that scoping lands, and nobody re-checks a backfill
 * that already reported success.
 *
 * siteId and nothing else is ever written. The centre name on an extinguisher is
 * stencilled on the extinguisher; it must not change because a link was missing.
 *
 * Every decision is planSiteLinks' — see functions/lib/siteLinks.js for why a
 * name resolving to two sites, or a record whose existing link disagrees with
 * its name, is reported instead of resolved. This function does the reading and
 * the writing and decides nothing.
 *
 * dryRun defaults to TRUE. Report first, write when asked.
 */
export const linkEquipmentSites = onCall({ region: REGION, timeoutSeconds: 540 }, async (request) => {
  const callerUid = request.auth?.uid
  if (!callerUid) throw new HttpsError('unauthenticated', 'Sign in first.')

  const db = getFirestore()
  const caller = (await db.doc(`users/${callerUid}`).get()).data()
  if (!caller || caller.status !== 'approved' || caller.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Administrators only.')
  }
  const orgId = caller.orgId
  const base = `organizations/${orgId}`

  // The site registry read straight from the collection, NOT the way the app
  // reads it: subscribeSites orders by name (src/shared/org/orgData.js:258) and
  // Firestore drops documents missing the ordered field, so a site saved without
  // a name is invisible to every reader in the browser. Sourcing the registry
  // through that listener would make a nameless site silently absent here too,
  // and every piece of equipment naming it would be reported as unmatched with
  // no hint why. indexSites skips nameless sites explicitly instead.
  const [sitesSnap, ...equipSnaps] = await Promise.all([
    db.collection(`${base}/sites`).get(),
    ...LINKABLE_COLLECTIONS.map((c) => db.collection(`${base}/${c}`).get()),
  ])

  const sites = sitesSnap.docs.map((d) => ({ id: d.id, name: d.data()?.name }))
  const equipment = []
  equipSnaps.forEach((snap, i) => {
    snap.docs.forEach((d) => {
      const data = d.data()
      equipment.push({
        collection: LINKABLE_COLLECTIONS[i],
        id: d.id,
        centerName: data?.centerName,
        siteId: data?.siteId,
        deletedAt: data?.deletedAt,
      })
    })
  })

  const plan = planSiteLinks(equipment, sites)

  const dryRun = request.data?.dryRun !== false
  if (!dryRun) {
    // Chunked: a batch takes 500 writes, and three equipment collections across
    // an estate this size exceed that comfortably.
    for (let i = 0; i < plan.writes.length; i += 400) {
      const batch = db.batch()
      plan.writes.slice(i, i + 400).forEach((w) => {
        // The patch is spelled out rather than spread from the row. A row also
        // carries matchedName, for the report, and spreading it would write the
        // registry's wording onto equipment as a new field — the one thing this
        // job promised not to do. updatedAt is left alone for the same reason as
        // the medical strip: nobody edited these, and stamping every asset in
        // the tenant would bury whatever a person actually touched that day.
        batch.update(db.doc(`${base}/${w.collection}/${w.id}`), { siteId: w.siteId })
      })
      await batch.commit()
    }
  }

  // Not refused server-side when ambiguous or conflicting rows exist, and that
  // is deliberate: they are never in plan.writes, so writing is already safe,
  // and one permanently ambiguous pair of site names would otherwise block every
  // sound link in the org forever. The Maintenance card disables the write
  // button on those counts — the point is that a person sees them, not that the
  // run is impossible.
  logger.info('equipment: site link backfill', {
    orgId, dryRun, sites: sitesSnap.size, equipment: equipment.length,
    toWrite: plan.writes.length, ambiguous: plan.ambiguous.length,
    conflicting: plan.conflicting.length, unmatched: plan.unmatched.length,
  })

  return {
    orgId,
    dryRun,
    // Reported because 0 sites explains a page of "unmatched" far better than
    // the page of unmatched names does.
    sites: sitesSnap.size,
    equipment: equipment.length,
    alreadyLinked: plan.alreadyLinked,
    deleted: plan.deleted,
    written: dryRun ? 0 : plan.writes.length,
    wouldWrite: plan.writes.length,
    // The two that need a human, each with its own total so the card can gate on
    // a count without paging through the samples. A name resolving to two sites
    // is a coin flip; a record already linked elsewhere may have been linked by
    // hand, correctly, with the free text being the stale half. Neither is
    // guessed at.
    ambiguous: plan.ambiguous.slice(0, 50),
    ambiguousTotal: plan.ambiguous.length,
    conflicting: plan.conflicting.slice(0, 50),
    conflictingTotal: plan.conflicting.length,
    // Names rather than rows: a few hundred unmatched records collapse to a
    // couple of dozen centre names, and a name is what somebody can go and fix.
    unmatchedNames: plan.unmatchedNames.slice(0, 50),
    unmatchedNameTotal: plan.unmatchedNames.length,
    unmatchedTotal: plan.unmatched.length,
    // No centre name at all, so unmatchable by name however the rules are
    // loosened. These need another route entirely.
    noName: plan.noName.length,
    sample: plan.writes.slice(0, 25).map((w) => ({
      collection: w.collection, id: w.id, matchedName: w.matchedName,
    })),
  }
})

/**
 * Put the medical detail INTO /injuries, so the strip below has a copy to prove
 * against. Step one of two; it removes nothing.
 *
 * stripIncidentMedicalDetail refuses to take a field off an incident unless it
 * can first find that field in the matching /injuries record, because /injuries
 * is about to be the only copy and an unproved removal destroys a medical
 * record. On production data that guard fired with an injury document already
 * present:
 *
 *   incidents: 1  injuries: 1  toWrite: 0  blocked: 1  stillExposed: 1
 *
 * A record existing is not a record being complete, and nothing in the product
 * closes the gap: syncIncidentInjuries writes from the wizard's live form, not
 * from what is already stored, and it skips a verified record outright. Left
 * alone, that incident carries a colleague's injury type and body parts for
 * every approved member and the external auditor to list, permanently.
 *
 * Deliberately a SEPARATE callable rather than a mode of the strip. Seeding
 * copies clinical detail into the system of record; an admin has to be able to
 * run it, open the Injuries page, read what actually landed, and only then
 * strip. Folding it into one button would make that copy reviewable only in the
 * moment before the original was deleted.
 *
 * Fills gaps and creates missing records. Never overwrites an answer /injuries
 * already holds, never touches a verified or soft-deleted record, and never
 * invents a document id for a row that names no person — see planInjurySeed for
 * why each of those is a human's decision and not this job's.
 *
 * dryRun defaults to TRUE. Report first, write when asked.
 */
export const seedInjuryRecords = onCall({ region: REGION, timeoutSeconds: 540 }, async (request) => {
  const callerUid = request.auth?.uid
  if (!callerUid) throw new HttpsError('unauthenticated', 'Sign in first.')

  const db = getFirestore()
  const caller = (await db.doc(`users/${callerUid}`).get()).data()
  if (!caller || caller.status !== 'approved' || caller.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Administrators only.')
  }
  const orgId = caller.orgId
  const base = `organizations/${orgId}`

  const [incSnap, injSnap] = await Promise.all([
    db.collection(`${base}/incidents`).get(),
    db.collection(`${base}/injuries`).get(),
  ])

  // More of the incident than the strip reads, and that is the point: a new
  // injury record needs the date, type, severity and location to render as
  // anything but a blank row on the Injuries page. A medical record nobody can
  // place is not a record.
  const incidents = incSnap.docs.map((d) => {
    const data = d.data() || {}
    return {
      id: d.id,
      refNo: data.refNo,
      incidentDate: data.incidentDate,
      type: data.type,
      severity: data.severity,
      location: data.location,
      injuryReports: data.injuryReports,
    }
  })
  const injuries = new Map(injSnap.docs.map((d) => [d.id, d.data()]))

  const plan = planInjurySeed(incidents, injuries)

  const dryRun = request.data?.dryRun !== false
  if (!dryRun) {
    for (let i = 0; i < plan.writes.length; i += 400) {
      const batch = db.batch()
      plan.writes.slice(i, i + 400).forEach((w) => {
        // merge, always. On a create there is nothing to merge with; on a
        // completion the patch holds only the fields /injuries had no answer
        // for, and set() without merge would replace the whole document —
        // deleting the verification, the incident context and every answer this
        // job promised not to touch.
        //
        // updatedAt is stamped here rather than in the plan because a pure
        // function cannot mint a server timestamp, and it is NOT optional:
        // subscribeInjuries orders by updatedAt and Firestore drops documents
        // missing the ordered field, so a seeded record without one would be a
        // medical record that shows on no screen. Unlike the strip below, this
        // genuinely changes what the record says, so moving it to the top of
        // "recently changed" is honest.
        batch.set(
          db.doc(`${base}/injuries/${w.id}`),
          { ...w.patch, updatedAt: FieldValue.serverTimestamp() },
          { merge: true },
        )
      })
      await batch.commit()
    }
  }

  // Counts and reasons. No field names and certainly no values: a migration log
  // must not become one more copy of the thing being confined.
  logger.info('incidents: injury record seed', {
    orgId, dryRun, incidents: incSnap.size, injuries: injSnap.size,
    toWrite: plan.writes.length, created: plan.created, completed: plan.completed,
    blocked: plan.blocked.length, orphans: plan.orphanInjuries.length,
  })

  return {
    orgId,
    dryRun,
    incidents: incSnap.size,
    injuries: injSnap.size,
    written: dryRun ? 0 : plan.writes.length,
    wouldWrite: plan.writes.length,
    // The gate the strip is sequenced behind: while this is above zero, medical
    // detail is on incidents that /injuries cannot yet account for.
    created: plan.created,
    completed: plan.completed,
    // Kept apart from the strip's `confined` on purpose. `confined` claims the
    // detail was already in /injuries and merely removed from the incident;
    // `seeded` is detail this migration COPIED there, proved by nothing but the
    // incident it came from.
    seeded: plan.seeded,
    alreadyHeld: plan.alreadyHeld,
    alreadyComplete: plan.alreadyComplete,
    // The rows a human has to resolve, by reason. Field names only.
    blocked: plan.blocked.slice(0, 50),
    blockedTotal: plan.blocked.length,
    blockedFields: plan.blockedFields,
    // Injury records for an incident that has rows, which no row names —
    // usually one person holding a record under one id and a row under another.
    // Reported, never reconciled: merging them writes one colleague's clinical
    // detail into another's record.
    orphanInjuries: plan.orphanInjuries.slice(0, 50),
    orphanInjuryTotal: plan.orphanInjuries.length,
    sample: plan.writes.slice(0, 25).map((w) => ({
      id: w.id, refNo: w.refNo, create: w.create, fields: w.fields.length,
    })),
  }
})

/**
 * Take the medical detail off incident documents that already carry a copy.
 * Step two of two — run seedInjuryRecords first.
 *
 * /injuries is gated on isManagerOf rather than isElevatedOf specifically to
 * keep the external auditor out of colleagues' health records. That gate was
 * decorative: the same detail was ALSO written onto the parent incident as
 * injuryReports[], and /incidents falls through to the generic read — every
 * approved member, plus the auditor. One getDocs on the incident collection
 * returned bodyParts, injuryType, medication, firstAidDetail and
 * daysToReturnToWork for every injured person in the tenant. ISO 27001 audit
 * MEDIUM-31, and the manager-only rule never touched it.
 *
 * Closing the write path closes nothing already stored, and every incident
 * filed before that fix still answers the query. Same reasoning already
 * recorded for the visibility backfill: this migration is a PREREQUISITE of the
 * rules and UI change, not a tidy-up afterwards.
 *
 * It cannot be done by re-syncing from the incident, because
 * syncIncidentInjuries skips a record that is already verified.
 *
 * NEVER strips a field it has not first found in /injuries — see
 * planMedicalStrip. /injuries is about to be the only copy, so an unproved
 * removal deletes an injury record rather than confining it. Everything
 * unproved is kept and reported for a human.
 *
 * That guard is what makes seedInjuryRecords above a prerequisite rather than a
 * convenience: a run reporting `blocked` has found detail whose only copy is
 * the exposed one, and running this again will report exactly the same thing
 * forever. Seed first, read what landed, then strip.
 *
 * dryRun defaults to TRUE. Report first, write when asked.
 */
export const stripIncidentMedicalDetail = onCall({ region: REGION, timeoutSeconds: 540 }, async (request) => {
  const callerUid = request.auth?.uid
  if (!callerUid) throw new HttpsError('unauthenticated', 'Sign in first.')

  const db = getFirestore()
  const caller = (await db.doc(`users/${callerUid}`).get()).data()
  if (!caller || caller.status !== 'approved' || caller.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Administrators only.')
  }
  const orgId = caller.orgId
  const base = `organizations/${orgId}`

  // Both sides of the join, whole. Soft-deleted incidents are included
  // deliberately — the generic read rule does not filter on deletedAt, so a
  // record in the Recycle Bin is exposed exactly like a live one.
  const [incSnap, injSnap] = await Promise.all([
    db.collection(`${base}/incidents`).get(),
    db.collection(`${base}/injuries`).get(),
  ])

  const incidents = incSnap.docs.map((d) => ({
    id: d.id,
    refNo: d.data()?.refNo,
    injuryReports: d.data()?.injuryReports,
  }))
  const injuries = new Map(injSnap.docs.map((d) => [d.id, d.data()]))

  const plan = planMedicalStrip(incidents, injuries)

  const dryRun = request.data?.dryRun !== false
  if (!dryRun) {
    // Chunked: a batch takes 500 writes and an org's incident register exceeds
    // that long before anyone runs this.
    for (let i = 0; i < plan.writes.length; i += 400) {
      const batch = db.batch()
      plan.writes.slice(i, i + 400).forEach((w) => {
        // The patch replaces injuryReports and nothing else. updatedAt is
        // deliberately NOT stamped: this is not an edit anybody made, and
        // moving every incident in the tenant to the top of "recently changed"
        // would bury whatever a human actually touched that day.
        batch.update(db.doc(`${base}/incidents/${w.id}`), w.patch)
      })
      await batch.commit()
    }
  }

  // Counts only. The blocked rows name fields, never values, and this log line
  // does not even name the fields — a migration report must not become one more
  // copy of the thing it is confining.
  logger.info('incidents: medical detail strip', {
    orgId, dryRun, incidents: incSnap.size, injuries: injSnap.size,
    toWrite: plan.writes.length, confined: plan.confined,
    blocked: plan.blocked.length, stillExposed: plan.stillExposed,
  })

  return {
    orgId,
    dryRun,
    incidents: incSnap.size,
    injuries: injSnap.size,
    alreadyClean: plan.alreadyClean,
    // The number this whole run is for: incidents that will STILL carry medical
    // detail afterwards. Until it is 0 the exposure is open, and the rules and
    // UI change must not ship on the strength of a big `confined` count.
    stillExposed: plan.stillExposed,
    written: dryRun ? 0 : plan.writes.length,
    wouldWrite: plan.writes.length,
    // Split on purpose: `confined` is real medical values proved present in
    // /injuries and then removed here, `emptied` is blank keys that never held
    // anything. "600 fields removed" reads like a much bigger migration than it
    // is when most of them were empty strings.
    confined: plan.confined,
    emptied: plan.emptied,
    // The part that needs a person. Each row is an injury whose detail could
    // NOT be proved to exist anywhere else, so it was left where it is —
    // exposed, but not destroyed. Field names only, never values.
    blocked: plan.blocked.slice(0, 50),
    blockedTotal: plan.blocked.length,
    blockedFields: plan.blockedFields,
    sample: plan.writes.slice(0, 25).map((w) => ({ id: w.id, refNo: w.refNo, confined: w.confined })),
  }
})

/**
 * Copy the bytes of one medical record to the manager-only prefix.
 *
 * An object already at the destination is the RESUMED run — a previous attempt
 * copied the file and died before it could delete the source — so it is left
 * alone rather than copied over. What matters either way is that the destination
 * is confirmed present before anything is destroyed.
 *
 * A GCS copy is server-side and atomic: it either completes or raises. So
 * "exists at the destination" is the whole proof, and a size comparison would
 * only re-assert what the absence of an error already said.
 *
 * Throws when the file is in NEITHER place. That means somebody has been
 * deleting objects out from under the database, and this job is not the place to
 * paper over it — the record is reported and left where it is, with its pointer
 * intact, rather than moved as though the file had come along.
 */
async function copyStoredRecord(store, fromPath, toPath) {
  const source = store.file(fromPath)
  const dest = store.file(toPath)
  const [already] = await dest.exists()
  if (!already) {
    const [there] = await source.exists()
    if (!there) throw new Error('the file this record names is in neither place')
    await source.copy(dest)
    const [landed] = await dest.exists()
    if (!landed) throw new Error('the copied file did not arrive in the bucket')
  }

  // Strip the download token from the copy.
  //
  // firebaseStorageDownloadTokens is what makes a getDownloadURL link work
  // without any credential, and a copy carries the source's metadata across. No
  // URL has ever been minted for this new path, so the token is unused — but an
  // unused bearer token on a confined medical file is a door left unlocked in a
  // room nobody has been shown yet. Removing it means the only way in is
  // getBlob, which storage.rules actually decides on.
  //
  // Best-effort on purpose: the record is already confined on both surfaces by
  // the time this runs, and failing the whole move over the metadata would leave
  // it in the photo album where every member can list it. Counted and logged
  // instead, by the caller.
  await dest.setMetadata({ metadata: { firebaseStorageDownloadTokens: null } })
}

/**
 * Move medical records out of the photo album — the destructive half.
 *
 * THE ORDER IS THE POINT, and it is this:
 *
 *   1. copy the object to the medical-records prefix, and confirm it arrived
 *   2. write the new pointer at injuries/{injuryId}/records/{recordId}
 *   3. READ IT BACK and prove it landed intact (landedIntact)
 *   4. only then delete the old object
 *   5. and last, delete the old pointer
 *
 * Every gap between those steps leaves the record reachable in at least one
 * whole place. A crash after 1 leaves two copies of the file and the original
 * pointer; after 2, two pointers; after 4, the old pointer names a path that has
 * gone while the new pointer names the live copy. Nothing anywhere leaves the
 * record findable by nothing — losing a medical record is a worse outcome than
 * the exposure staying open another day, which is the same rule planMedicalStrip
 * follows for the clinical fields.
 *
 * 4 before 5 rather than the other way round, deliberately. Deleting the pointer
 * first and then dying would strand the object under the member-readable photo
 * prefix with nothing left in the database naming it: invisible to this job
 * forever, invisible to the retention sweep, and still readable by anyone who
 * knows the path. A dead path on a pointer that is about to be deleted is
 * recoverable by re-running; an orphan in the bucket is not.
 *
 * The destination document id is the SOURCE document id (planMedicalRecordMove),
 * so every step above is idempotent: a re-run after any crash lands on the same
 * document rather than making a second copy of somebody's discharge summary.
 *
 * One failure never stops the rest. Each record is independent, and a run that
 * abandoned forty confinable records because the forty-first had a bad path
 * would leave them exposed for no reason.
 *
 * Exported for index.test.js, not for deploy: function discovery only picks up
 * exports carrying an __endpoint, which a plain function does not.
 */
export async function moveMedicalRecords(db, store, orgId, moves) {
  const base = `organizations/${orgId}`
  const failed = []
  const perIncident = new Map()
  let moved = 0
  let filesMoved = 0
  let tokensLeft = 0

  for (const m of moves) {
    const ctx = { orgId, incidentId: m.incidentId, recordId: m.photoId }
    try {
      // 1. The bytes, first, so the new pointer never names a file that is not
      //    there yet.
      if (m.toPath && m.toPath !== m.fromPath) {
        try {
          await copyStoredRecord(store, m.fromPath, m.toPath)
        } catch (e) {
          // Only the metadata strip is survivable; a failed copy is not, and
          // both arrive here. Telling them apart by message would be brittle, so
          // the destination is asked directly: present means the file is
          // confined and only the token strip failed.
          const [there] = await store.file(m.toPath).exists()
          if (!there) throw e
          tokensLeft += 1
          logger.error('medical records: could not remove the download token from a moved file', {
            ...ctx, error: e?.message || String(e),
          })
        }
        filesMoved += 1
      }

      // 2. The pointer.
      const doc = { ...m.doc }
      // A pointer with no uploadedAt is dropped by the only query that reads
      // this collection (subscribeMedicalRecords orders by it), so a record
      // moved without one would be confined onto no screen at all. Stamped here
      // rather than in the plan because a pure function cannot mint one.
      if (m.needsUploadedAt) doc.uploadedAt = FieldValue.serverTimestamp()
      const target = db.doc(`${base}/injuries/${m.injuryId}/records/${m.photoId}`)
      await target.set(doc)

      // 3. The proof. Read back out of Firestore, not trusted from the write.
      const check = await target.get()
      if (!landedIntact(m.doc, check.exists ? check.data() : null)) {
        throw new Error('the moved record did not read back intact')
      }

      // 4. and 5. Nothing above this line was destructive.
      if (m.fromPath && m.toPath && m.toPath !== m.fromPath) {
        await store.file(m.fromPath).delete({ ignoreNotFound: true })
      }
      await db.doc(`${base}/incidents/${m.incidentId}/photos/${m.photoId}`).delete()

      moved += 1
      perIncident.set(m.incidentId, (perIncident.get(m.incidentId) || 0) + 1)
    } catch (e) {
      // Named by id, never by filename: a failure report must not become one
      // more copy of the thing being confined.
      failed.push({
        incidentId: m.incidentId, refNo: m.refNo, photoId: m.photoId,
        error: e?.message || String(e),
      })
      logger.error('medical records: left where it was', { ...ctx, error: e?.message || String(e) })
    }
  }

  // photoCount is maintained by addIncidentPhoto and deleteIncidentPhoto, so a
  // migration that removes pointers without it leaves a counter that no longer
  // counts anything. updatedAt is deliberately not stamped, for the reason the
  // medical strip records: nobody edited these incidents, and moving every one
  // of them to the top of "recently changed" would bury whatever a person
  // actually touched that day.
  for (const [incidentId, n] of perIncident) {
    try {
      await db.doc(`${base}/incidents/${incidentId}`).update({ photoCount: FieldValue.increment(-n) })
    } catch (e) {
      // The records have already moved. A stale count is not worth reporting the
      // run as failed over.
      logger.error('medical records: photo count left stale', {
        orgId, incidentId, error: e?.message || String(e),
      })
    }
  }

  return { moved, filesMoved, tokensLeft, failed }
}

/**
 * Move the medical record FILES out of the shared photo subcollection.
 *
 * stripIncidentMedicalDetail confined the injury FIELDS. The documents stayed
 * where they were — incidents/{id}/photos, kind:'medical_record' — and the
 * generic {sub=**} at the foot of firestore.rules hands that subtree to every
 * approved member AND to the external auditor, by get and by list. One getDocs
 * returned the filename, caption, size and download URL of every medical
 * document in the tenant. A GP letter, a fit note, a discharge summary IS the
 * record: the fields were confined and the scan of the same information was not.
 *
 * The rules change moved the boundary to the collection itself, because rules
 * cannot filter which documents a list returns. Closing the write path closes
 * nothing already stored, and what is already stored is the exposure — this
 * migration is a PREREQUISITE of that change, not a tidy-up after it.
 *
 * It moves both halves, because a pointer nobody can read is worth nothing while
 * the file behind it is readable by anyone in the tenant: the pointer into
 * injuries/{injuryId}/records, and the object from the `incident-photos` Storage
 * prefix to `medical-records`, which is the one prefix storage.rules excludes
 * from its generic member-wide read.
 *
 * WHAT IT CANNOT DO, said plainly because the count of moved records invites the
 * wrong conclusion: a getDownloadURL already handed out is a bearer link that no
 * rule is ever consulted for. Deleting the object it names is what kills it, and
 * this does delete it — so a link in someone's history stops working for every
 * file this run moves. Nothing recalls the ones that were already FOLLOWED. A
 * file downloaded last March is on somebody's laptop, and no migration reaches
 * it. If a record was exposed to a person who should not have had it, the
 * remedy is the incident process, not this button.
 *
 * Sequenced AFTER seedInjuryRecords: a record is filed under the injury document
 * for the person it belongs to, and one filed under an injury that does not
 * exist outlives the purge of its own incident, unreachable by any query in the
 * product. Those are reported as `no-injury-record` rather than filed anyway.
 *
 * dryRun defaults to TRUE. Report first, write when asked.
 */
export const confineMedicalRecords = onCall({ region: REGION, timeoutSeconds: 540 }, async (request) => {
  const callerUid = request.auth?.uid
  if (!callerUid) throw new HttpsError('unauthenticated', 'Sign in first.')

  const db = getFirestore()
  const caller = (await db.doc(`users/${callerUid}`).get()).data()
  if (!caller || caller.status !== 'approved' || caller.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Administrators only.')
  }
  const orgId = caller.orgId
  const base = `organizations/${orgId}`

  // Existence and deletedAt, and not one clinical field. This job decides where
  // a file goes, never what is wrong with anybody, so select() keeps the answer
  // to that question out of its memory and out of anything that might log it.
  const [incSnap, injSnap] = await Promise.all([
    db.collection(`${base}/incidents`).get(),
    db.collection(`${base}/injuries`).select('deletedAt').get(),
  ])
  const injuries = new Map(injSnap.docs.map((d) => [d.id, d.data() || {}]))

  // One photos query per incident rather than one collectionGroup query for the
  // lot. A collectionGroup('photos') spans EVERY tenant, and this runs with
  // Admin SDK privileges that never consult firestore.rules — the same trap the
  // retention sweep's ownedByOrg() guards. Twenty at a time so a large register
  // does not open a query per incident all at once.
  const incidents = []
  for (let i = 0; i < incSnap.docs.length; i += 20) {
    const wave = incSnap.docs.slice(i, i + 20)
    const photoSnaps = await Promise.all(wave.map((d) => d.ref.collection('photos').get()))
    wave.forEach((d, j) => {
      const data = d.data() || {}
      incidents.push({
        id: d.id,
        refNo: data.refNo,
        injuryReports: data.injuryReports,
        photos: photoSnaps[j].docs.map((p) => ({ id: p.id, ...p.data() })),
      })
    })
  }

  const plan = planMedicalRecordMove(incidents, injuries, orgId)

  const dryRun = request.data?.dryRun !== false
  const run = dryRun
    ? { moved: 0, filesMoved: 0, tokensLeft: 0, failed: [] }
    : await moveMedicalRecords(db, getBucket(), orgId, plan.moves)

  // Counts, ids and reasons. No filenames, here or in the response: "MRI-left-
  // knee — A Kumar.pdf" is the record, and a migration log must not become one
  // more copy of the thing it is confining.
  logger.info('incidents: medical record confinement', {
    orgId, dryRun, incidents: incSnap.size, records: plan.records,
    toMove: plan.moves.length, moved: run.moved, filesMoved: run.filesMoved,
    blocked: plan.blocked.length, failed: run.failed.length, remaining: plan.remaining,
  })

  return {
    orgId,
    dryRun,
    incidents: incSnap.size,
    // Every medical record still filed in the shared photo subcollection —
    // readable, by get and by list, by every member and the auditor.
    records: plan.records,
    photos: plan.photos,
    moved: run.moved,
    wouldMove: plan.moves.length,
    // Bytes still under the prefix storage.rules hands to the whole tenant. The
    // pointer move alone would leave the storage rule decorative for history.
    filesToMove: plan.filesToMove,
    filesMoved: run.filesMoved,
    // Base64 on the pointer itself, with nothing in the bucket — for these the
    // document IS the medical record, and Firestore rules are the only control.
    inlineRecords: plan.inlineRecords,
    // Permanent bearer links this run removes from the database. It does NOT
    // mean they are recalled: see the note above the function and the card text.
    urlsDropped: plan.urlsDropped,
    // Records whose injury document is in the Recycle Bin. Moved anyway — the
    // file is not destroyed by moving it, and leaving it in the photo album is
    // the exposure — but counted, because nothing purges /injuries yet.
    underDeletedInjury: plan.underDeletedInjury,
    // Above the cap, so a second run finishes the job.
    remaining: plan.remaining,
    // The rows that need a person, by reason, and never by filename:
    //   several-people    the incident injured more than one, and the pointer
    //                     says nothing about whose record this is
    //   no-person-id      no injury row names a person to file it against
    //   no-injury-record  run seedInjuryRecords first
    //   foreign-path      the file path is not inside this org's own prefix
    blocked: plan.blocked.slice(0, 50),
    blockedTotal: plan.blocked.length,
    blockedReasons: plan.blockedReasons,
    // Attempted and refused mid-flight. Each one still has its pointer and its
    // file exactly where they were — nothing is deleted until the copy has been
    // read back intact.
    failed: run.failed.slice(0, 50),
    failedTotal: run.failed.length,
    // Files that arrived confined but kept an unused download token. Nobody has
    // ever been given a URL for the new path, so this is a door in a room nobody
    // has been shown — but it is worth knowing about.
    tokensLeft: run.tokensLeft,
    prefix: MEDICAL_RECORD_KIND,
    sample: plan.moves.slice(0, 25).map((m) => ({
      incidentId: m.incidentId, refNo: m.refNo, personId: m.personId, recordId: m.photoId,
    })),
  }
})

/**
 * Delete defect locks that no longer describe a live fault.
 *
 * A lock outlived its defect whenever the Action Tracker resolved one — that
 * path removed the defect from the unit without releasing the lock. It is fixed
 * going forward, but the locks already left behind are unreachable from the app:
 * the defect is gone, so there is nothing to resolve, and the next person to
 * scan that extinguisher for that fault is told it has already been reported.
 *
 * Conservative by construction — see classifyLocks. Anything it cannot explain
 * is kept, because deleting a live lock re-opens the duplicate flood the
 * mechanism exists to prevent, while keeping a stale one costs another run.
 */
export const clearOrphanedDefectLocks = onCall({ region: REGION }, async (request) => {
  const callerUid = request.auth?.uid
  if (!callerUid) throw new HttpsError('unauthenticated', 'Sign in first.')

  const db = getFirestore()
  const caller = (await db.doc(`users/${callerUid}`).get()).data()
  if (!caller || caller.status !== 'approved' || caller.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Administrators only.')
  }
  const orgId = caller.orgId
  const base = `organizations/${orgId}`

  const [lockSnap, extSnap, reportSnap] = await Promise.all([
    db.collection(`${base}/defectLocks`).get(),
    db.collection(`${base}/extinguishers`).get(),
    db.collection(`${base}/reports`).get(),
  ])

  const { orphaned, live } = classifyLocks({
    locks: lockSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    extinguishers: extSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    reports: reportSnap.docs.map((d) => d.data()),
  })

  const dryRun = request.data?.dryRun !== false
  if (!dryRun && orphaned.length) {
    for (let i = 0; i < orphaned.length; i += 400) {
      const batch = db.batch()
      orphaned.slice(i, i + 400).forEach((l) => {
        batch.delete(db.doc(`${base}/defectLocks/${l.id}`))
      })
      await batch.commit()
    }
  }

  logger.info('defectLocks: orphan sweep', {
    orgId, dryRun, total: lockSnap.size, orphaned: orphaned.length,
  })

  return {
    orgId,
    dryRun,
    total: lockSnap.size,
    kept: live.length,
    removed: dryRun ? 0 : orphaned.length,
    wouldRemove: orphaned.length,
    // Named so an admin can recognise the unit before agreeing to the delete.
    ids: orphaned.slice(0, 25).map((l) => l.id),
  }
})

/**
 * Destroy the stored object a file pointer names, before the pointer goes.
 *
 * The Storage path is written on the pointer document and nowhere else, so
 * deleting the document first strands the object in the bucket with nothing left
 * in the database able to name it. For illness attachments that is retained
 * occupational-health data that can no longer be found, produced or erased —
 * the precise opposite of what a purge is for. The client's own purge has always
 * removed the file first; see purgeIllness in
 * src/modules/incidents/lib/illnesses.js. This one deleted only the pointer.
 *
 * Never throws. An object that has already gone is a success, and any other
 * Storage failure is logged and stepped over: the documents still have to go, or
 * a record 30 days past its retention window survives because a bucket had a bad
 * minute — and the next run will not find the file either way.
 */
/**
 * Is this Storage path inside the org being purged?
 *
 * Every upload goes through storagePath() in src/shared/storage/index.js, which
 * builds `orgs/<orgId>/<kind>/<file>`. Anything else was either hand-written by
 * a client or points somewhere it has no business pointing. Rejecting '..' as
 * well, because a path that climbs out of the prefix defeats the prefix.
 */
function ownedByOrg(path, orgId) {
  const p = String(path || '')
  return p.startsWith(`orgs/${orgId}/`) && !p.includes('..')
}

async function purgeStoredFile(store, path, ctx) {
  try {
    await store.file(path).delete({ ignoreNotFound: true })
    return true
  } catch (e) {
    logger.error('retention: file left behind in storage', { ...ctx, path, error: e?.message || String(e) })
    return false
  }
}

/**
 * Make the Recycle Bin's promise true.
 *
 * The screen has always said "Auto-purged after 30 days" and rendered a
 * countdown, and nothing implemented it — soft-deleted records, including
 * illness records carrying health data, sat there for as long as the project
 * existed unless a human clicked Purge. The countdown reached zero and kept
 * going. A stated retention period nothing enforces is worse than none: it is a
 * control an auditor will test, a claim a data subject may rely on, and the
 * reason somebody stops thinking about the delete they performed.
 *
 * 03:30, the quiet part of the night for the people whose records these are.
 * retryCount 0 because the handler never throws: a failed org is logged and
 * skipped, and tomorrow's run picks up anything missed — a record already 30
 * days dead is not urgent.
 *
 * Exported for index.test.js, not for deploy: function discovery only picks up
 * exports carrying an __endpoint, which a plain function does not.
 */
export async function purgeOrgCollection(db, orgId, spec, now, store = null) {
  const col = db.collection('organizations').doc(orgId).collection(spec.collection)
  // Query by the field AND re-check in the plan. The query is a filter; the
  // plan is the guarantee, and only one of them is tested.
  const cutoff = new Date(now - PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000)
  const snap = await col.where('deletedAt', '<=', cutoff).limit(MAX_PURGES_PER_RUN * 2).get()
  if (snap.empty) return { purged: 0, kept: 0, files: 0 }

  const docs = snap.docs.map((d) => ({ id: d.id, deletedAt: d.data().deletedAt, data: d.data() }))
  const { purge, keep, capped } = planPurge(docs, { now })
  if (capped) {
    logger.info('retention: capped', { orgId, collection: spec.collection, cap: MAX_PURGES_PER_RUN })
  }

  let files = 0
  // Everything that went wrong but did not stop the sweep. Each of these used
  // to be a logger.error and nothing else, which meant the most dangerous code
  // in this codebase — unattended, irreversible deletion of health records —
  // failed in total silence. Two of these are also ATTACK INDICATORS: a member
  // who cannot delete anything under storage.rules trying to get this
  // Admin-SDK sweep to delete it for them, in another tenant. Collected here,
  // returned to the caller, and turned into a failed invocation at the end of
  // the run so that something outside Cloud Logging finally notices.
  const problems = []
  for (const id of purge) {
    const ref = col.doc(id)
    const row = docs.find((d) => d.id === id)

    // Subcollections first. A pointer must not outlive its file, and the
    // parent going first would orphan the children beyond any query that
    // could find them again.
    for (const sub of spec.subcollections || []) {
      const kids = await ref.collection(sub).get()
      for (const kid of kids.docs) {
        // An attachment small enough to inline is base64 on the document
        // itself and has no object behind it, which is not a failure.
        const path = String(kid.data()?.path || '').trim()
        // The path is CLIENT-WRITABLE and this runs with Admin SDK
        // privileges that never consult storage.rules. Without this check a
        // plain member — a role storage.rules forbids from deleting anything —
        // could write a document with deletedAt backdated past the retention
        // window and a path naming ANY object in the bucket, including another
        // tenant's, and the nightly sweep would delete it for them. Confining
        // the sweep to its own org's prefix makes that impossible to express.
        if (path && ownedByOrg(path, orgId)) {
          const ctx = { orgId, collection: spec.collection, docId: id }
          if (await purgeStoredFile(store || getBucket(), path, ctx)) files += 1
          // The pointer is about to be deleted regardless — see purgeStoredFile.
          // So this is the case where the record says the file is gone and the
          // file is still in the bucket, which is precisely the shape of a
          // failed erasure request. It has to be louder than a log line.
          else problems.push({ kind: 'file-left-behind', docId: id, path })
        } else if (path) {
          logger.error('retention: refused a file path outside the org', {
            orgId, collection: spec.collection, docId: id, path,
          })
          problems.push({ kind: 'foreign-file-path', docId: id, path })
        }
        await kid.ref.delete()
      }
    }

    // The public QR mirror lives outside the org path, keyed by token. Leaving
    // it behind means a world-readable record of equipment that no longer
    // exists, reachable by anyone who photographed the label.
    // Same trap, different collection: qrToken is client-writable and /qr is a
    // TOP-LEVEL collection shared by every tenant, so an unchecked delete here
    // lets anyone who photographs another org's sticker destroy its public
    // record. The mirror already carries the org that owns it — require it.
    if (spec.qrMirror && row?.data?.qrToken) {
      const token = String(row.data.qrToken)
      const mirrorRef = db.collection('qr').doc(token)
      try {
        const mirror = await mirrorRef.get()
        if (!mirror.exists) {
          // Nothing to remove. Not a fault: the asset may never have had one.
        } else if (mirror.data()?.orgId === orgId) {
          await mirrorRef.delete()
        } else {
          logger.error('retention: refused a QR mirror belonging to another org', {
            orgId, token, mirrorOrgId: mirror.data()?.orgId ?? null,
          })
          problems.push({ kind: 'foreign-qr-mirror', docId: id, token })
        }
      } catch (e) {
        logger.error('retention: could not check a QR mirror', { orgId, token, error: e?.message || String(e) })
        problems.push({ kind: 'qr-mirror-error', docId: id, token })
      }
    }

    await ref.delete()
  }

  return { purged: purge.length, kept: keep.length, files, problems }
}

export const purgeSoftDeleted = onSchedule(
  { schedule: '30 3 * * *', timeZone: SCHEDULE_TZ, region: REGION, retryCount: 0, timeoutSeconds: 540 },
  async () => {
    const db = getFirestore()
    const now = Date.now()
    const orgs = await db.collection('organizations').get()
    let total = 0
    let totalFiles = 0

    const failures = []

    for (const org of orgs.docs) {
      for (const spec of PURGEABLE) {
        try {
          const { purged, kept, files, problems } = await purgeOrgCollection(db, org.id, spec, now)
          total += purged
          totalFiles += files
          if (purged > 0) {
            logger.info('retention: purged', { orgId: org.id, collection: spec.collection, purged, kept, files })
          }
          for (const p of problems || []) {
            failures.push({ orgId: org.id, collection: spec.collection, ...p })
          }
        } catch (e) {
          // One bad collection must not stop the rest, and must not retry the
          // whole sweep — the next run covers it.
          logger.error('retention: skipped', {
            orgId: org.id, collection: spec.collection, error: e?.message || String(e),
          })
          failures.push({
            kind: 'collection-failed',
            orgId: org.id,
            collection: spec.collection,
            error: e?.message || String(e),
          })
        }
      }
    }

    logger.info('retention: run complete', {
      organizations: orgs.size, purged: total, files: totalFiles, failures: failures.length,
    })

    // Do all the work, THEN fail. Both halves matter.
    //
    // The work has to finish first because a retention sweep that stops at the
    // first bad org leaves every later org's expired health records sitting
    // there — the resilience this handler was written with is correct and is
    // preserved exactly.
    //
    // But it used to end here, having swallowed everything, and that made the
    // most dangerous code in the system perfectly silent: retryCount is 0, no
    // exception ever escaped, and the invocation was recorded as a success no
    // matter what happened inside it. A sweep that had been failing for months
    // looked identical to one that had nothing to do. Meanwhile the app keeps
    // promising users their data is purged after 30 days.
    //
    // Throwing at the very end marks the invocation FAILED, which is a signal
    // Cloud Monitoring already knows how to alert on with no extra
    // instrumentation (PRODUCTION.md §2a) — and with retryCount 0 it costs
    // nothing but the alert. Tomorrow's run still picks up whatever was missed.
    const summary = summarizeFailures(failures)
    if (summary) {
      logger.error('retention: run had failures', {
        failures: failures.slice(0, 50), byKind: summary.byKind, total: summary.total,
      })
      throw new Error(summary.message)
    }
  }
)

/**
 * Delete one file from Cloud Storage, on behalf of a caller whose standing is
 * checked against the LIVE profile rather than their ID token.
 *
 * This is the only way a signed-in user can delete a file: `storage.rules`
 * refuses client deletes outright. See functions/lib/fileDelete.js for why the
 * check could not stay in the rules, and SECURITY.md S-19 for what it closes —
 * the hour in which a suspended, demoted or transferred manager could still
 * destroy their former organization's evidence using a token issued before
 * anyone touched their account.
 *
 * `ignoreNotFound` because callers treat deletion as best-effort — an already
 * absent object is the expected state of a retry, not a failure. What is NOT
 * best-effort is the authorisation above it.
 */
export const deleteOrgFile = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.')

  const path = String(request.data?.path || '').trim()
  if (!path) throw new HttpsError('invalid-argument', 'A file path is required.')

  const db = getFirestore()
  const profile = (await db.doc(`users/${uid}`).get()).data() || null

  const decision = mayDeleteFile(profile, path)
  if (!decision.ok) {
    // Logged with the reason, answered without it. "Your profile says member"
    // and "that file belongs to another organization" are both just "no" to
    // somebody probing — but the difference is exactly what an operator needs
    // when a legitimate manager reports that deleting stopped working.
    logger.warn('deleteOrgFile: refused', {
      uid, path, reason: decision.reason, orgId: profile?.orgId ?? null, role: profile?.role ?? null,
    })
    throw new HttpsError('permission-denied', 'You cannot delete this file.')
  }

  await getBucket().file(path).delete({ ignoreNotFound: true })
  logger.info('deleteOrgFile: deleted', { uid, orgId: profile.orgId, path })
  return { deleted: true }
})

/**
 * A subject access request: everything this organization holds about one person.
 *
 * Manager-only and org-scoped. The people who may run it are exactly the people
 * `firestore.rules` already lets read /injuries and /illnesses (isManagerOf) —
 * anything less would be a member assembling a colleague's medical history in
 * one call, which is the concentration risk that makes a bulk export different
 * from the screens it draws on.
 *
 * ── What it returns, and what it deliberately does not claim ────────────────
 *
 * `records` is COMPLETE for everything joined by a key — personId on injuries,
 * employeeUid on training, actorUid in the audit log, the uid on the account.
 *
 * `mentions` is a LIST OF PLACES TO LOOK, not results. A person's name is also
 * free text inside array objects (`affectedPersonnel[].name`,
 * `attendees[].name`, `commanders[]`), and Firestore cannot query inside those.
 * Reporting them as "not found" would make an incomplete export look
 * authoritative, so they come back named and unsearched, with the exact field
 * paths a human has to review.
 *
 * That honesty is the feature. A subject access response that quietly omitted
 * the committee minutes naming someone is a failed response, not a partial one.
 */
export const exportSubjectData = onCall({ region: REGION, timeoutSeconds: 540 }, async (request) => {
  const callerUid = request.auth?.uid
  if (!callerUid) throw new HttpsError('unauthenticated', 'Sign in first.')

  const db = getFirestore()
  const caller = (await db.doc(`users/${callerUid}`).get()).data()
  if (!caller || caller.status !== 'approved' || !['admin', 'manager'].includes(caller.role)) {
    throw new HttpsError('permission-denied', 'Administrators and managers only.')
  }
  const orgId = caller.orgId
  if (!orgId) throw new HttpsError('failed-precondition', 'Your profile names no organization.')

  const uid = String(request.data?.uid || '').trim()
  const personId = String(request.data?.personId || '').trim()
  if (!uid && !personId) {
    throw new HttpsError('invalid-argument', 'Give a uid, a personId, or both.')
  }
  // Both become path segments below — uid in the tenancy check immediately
  // after, and either of them as the document id in a `docId` source. Validate
  // BEFORE the tenancy check, so the value that check is made about is the same
  // value the queries then use.
  if (uid) assertPathSegment(uid, 'uid')
  if (personId) assertPathSegment(personId, 'personId')

  // Tenancy: the subject must belong to the CALLER's org. Without this, a
  // manager of any tenant could export any uid in the system — the export is
  // by uid, and a uid is not secret.
  if (uid) {
    const subject = (await db.doc(`users/${uid}`).get()).data()
    if (!subject || subject.orgId !== orgId) {
      throw new HttpsError('permission-denied', 'That person is not in your organization.')
    }
  }

  const plan = planExport({ uid, personId })
  const records = {}
  const problems = []

  for (const q of plan) {
    try {
      if (q.kind === 'docId') {
        const snap = await db.doc(`${q.path}/${q.value}`).get()
        records[q.path] = snap.exists ? [{ id: snap.id, ...snap.data() }] : []
        continue
      }

      // Subcollections are reached through their parent, so a source with a
      // `parent` is gathered by the parent's own query rather than a
      // collectionGroup scan — a collectionGroup would cross tenants, and the
      // rules that normally prevent that do not apply to the Admin SDK.
      //
      // A top-level source is NOT org-scoped, so a field query against one
      // reads every tenant's rows. Only `users` is top-level today and it joins
      // on `docId`, which never reaches this line — so this guard is currently
      // unreachable, and that is exactly why it is here: the next top-level
      // source added with a field join would otherwise cross tenants silently.
      if (q.topLevel) {
        throw new Error(
          `source ${q.path} is top-level and cannot be reached by a field query without crossing tenants`,
        )
      }
      const col = db.collection(`organizations/${orgId}/${q.path}`)
      const snap = await col.where(q.field, '==', q.value).limit(2000).get()
      records[q.path] = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    } catch (e) {
      // One unreachable collection must not lose the rest of the response, but
      // it must be visible in it — an export with a silent hole is the failure
      // this whole function exists to avoid.
      logger.error('exportSubjectData: source failed', { orgId, path: q.path, error: e?.message || String(e) })
      problems.push({ path: q.path, error: e?.message || String(e) })
    }
  }

  const encryptionOn = Boolean(request.data?.encryptionOn)
  logger.info('exportSubjectData: ran', {
    orgId, callerUid, subjectUid: uid || null, personId: personId || null,
    collections: Object.keys(records).length,
  })

  return {
    subject: { uid: uid || null, personId: personId || null },
    generatedFor: orgId,
    records,
    // Named, not searched. See the note above.
    mentions: planScan(),
    scan: scanFeasibility({ encryptionOn }),
    erasure: classifyErasure(),
    problems,
  }
})

/**
 * Withdraw the public detail of permits nobody came back to close.
 *
 * `/permitQr/{token}` is world-readable so a person at the barrier can scan the
 * code and see the work is authorised. The crew is already published as counts
 * rather than names, and a permit that reaches Closed has its describing fields
 * blanked on the write that closes it.
 *
 * That covers every permit somebody touches. It covers nothing about the
 * permits nobody touches again — and those are the whole problem. A permit that
 * lapses at 18:00 and is never formally closed gets no further writes, so its
 * job description, location, hazards and the name it was issued to stayed on an
 * unauthenticated URL indefinitely. The behaviour selected for neglect: close a
 * permit properly and it was withdrawn, forget it and it was published forever.
 *
 * Expiry alone is deliberately not grounds for withdrawal — a permit that
 * lapsed while work carried on is exactly the one somebody should still be able
 * to read and challenge. That holds for days, not years. This ends the years.
 *
 * 04:15, after the retention sweep, so two unattended destructive-ish jobs do
 * not interleave in the logs. retryCount 0 and the same do-all-the-work-then-
 * fail shape as the retention sweep, for the same reason: a job that quietly
 * stops working must not look identical to one with nothing to do.
 */
export const withdrawStalePermitMirrors = onSchedule(
  { schedule: '15 4 * * *', timeZone: SCHEDULE_TZ, region: REGION, retryCount: 0, timeoutSeconds: 540 },
  async () => {
    const db = getFirestore()
    const now = Date.now()

    // The mirrors are a TOP-LEVEL collection shared by every tenant, so this is
    // one query rather than one per org. Only documents not already withdrawn
    // are candidates; `withdrawn` is absent on mirrors written before the field
    // existed, so the filter is applied in planWithdrawals rather than here —
    // a `where('withdrawn','==',false)` would silently skip every legacy
    // mirror, which is precisely the population this exists for.
    const snap = await db.collection('permitQr').limit(MAX_WITHDRAWALS_PER_RUN * 4).get()
    const mirrors = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    const { withdraw, capped } = planWithdrawals(mirrors, { now })

    if (capped) {
      logger.info('permitQr: capped', { cap: MAX_WITHDRAWALS_PER_RUN })
    }

    const failures = []
    for (const token of withdraw) {
      try {
        await db.collection('permitQr').doc(token).set(withdrawnFields(), { merge: true })
      } catch (e) {
        // One bad mirror must not stop the rest, and must not retry the whole
        // sweep — but it must not vanish either.
        logger.error('permitQr: could not withdraw', { token, error: e?.message || String(e) })
        failures.push({ kind: 'withdraw-failed', token, error: e?.message || String(e) })
      }
    }

    logger.info('permitQr: run complete', {
      scanned: mirrors.length, withdrawn: withdraw.length - failures.length, failures: failures.length,
    })

    const summary = summarizeFailures(failures)
    if (summary) {
      logger.error('permitQr: run had failures', { byKind: summary.byKind, total: summary.total })
      throw new Error(summary.message)
    }
  }
)

// ─────────────────────────────────────────────────────────────────────────────
// ODIN — the Metabase connector.
//
// Three callables, and the split between them is the security model.
//
//   metabaseConfig  reads the connection settings back to an ADMIN, with the
//                   API key removed. Not "masked" — removed. See redactConfig.
//   metabaseTest    proves the URL and key work, without running a question.
//   metabaseQuery   runs one of the configured saved questions and returns its
//                   rows to ANY approved member of the organization.
//
// That last line is the point of the whole design. The dashboard is for the
// safety team; the credential is not. A key that reached the browser would be a
// bearer token for the entire analytics warehouse handed to everyone who can
// open a tab, and no Firestore rule can un-hand it. So the key never leaves the
// server, and firestore.rules keeps /integrations admin-only on top of that, so
// even the document holding it is out of an ordinary member's reach.
//
// Everything decidable without a network lives in lib/metabase.js and is tested
// there. This is the part that talks to Firestore, to Metabase, and to the
// caller.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How long we will wait on someone else's Metabase before giving up on it.
 *
 * A hundred seconds, not the twenty-five this used to be. Twenty-five is a
 * sensible wait for a web request and a hopeless one for a warehouse query: the
 * two questions this was first pointed at take thirty to sixty seconds for a
 * single month of data, so every real load timed out and reported "Metabase did
 * not answer in time" about an instance that was working perfectly.
 *
 * The ceiling is the callable's own 300s budget — this has to expire first, or
 * the caller gets a transport error instead of the diagnosis below.
 *
 * 280s, not 100s, because 100s was not a timeout so much as a cap on how much
 * history anyone could ask for. Timed against the live questions: the tickets
 * question answers a 90-day window in 4 seconds and a 365-day window in 227.
 * At 100s the second one could not complete, so widening the date pickers
 * returned "Metabase did not answer in time" rather than the year of data the
 * reader had just asked for — a filter that appears to work and cannot.
 */
const METABASE_TIMEOUT_MS = 280_000

/**
 * How much history a dashboard load asks for when nobody said.
 *
 * A quarter. These are quarterly audit programmes, so a quarter is the period
 * people actually review.
 *
 * It is also as much as a callable can physically carry, which is the harder
 * constraint and the reason this is not simply set to a year. Measured against
 * the live tickets question: 90 days is 8,529 rows and 6MB of response, and a
 * year is 31,291 rows and roughly 24MB — well past the 10MB ceiling, so a
 * 365-day default would not be slow, it would fail, or be truncated by capRows
 * into a confidently wrong total. Showing a year needs the arithmetic to move
 * server-side so that summaries cross the wire instead of rows.
 *
 * Whatever this is, the tab now PRINTS the window it ran, because the previous
 * failure mode was silent: two empty date boxes look like "no filter", and the
 * figures were being compared against Metabase tabs run over all of history.
 */
const DEFAULT_RANGE_DAYS = 90

/** The caller's live profile, or a refusal. Never their ID token's claims. */
async function metabaseCaller(request, { adminOnly = false } = {}) {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.')
  const db = getFirestore()
  const profile = (await db.doc(`users/${uid}`).get()).data() || null
  if (!profile || profile.status !== 'approved' || !profile.orgId) {
    throw new HttpsError('permission-denied', 'Your account is not an approved member of an organization.')
  }
  if (adminOnly && profile.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Administrators only.')
  }
  // An account still on the password an admin typed for it reaches nothing in
  // Firestore (passwordIsOwn in firestore.rules). That rule is repeated here
  // because a callable bypasses rules entirely, and this would otherwise be the
  // one door left open to a credential the provisioning admin still knows.
  if (profile.mustChangePassword === true) {
    throw new HttpsError('permission-denied', 'Change your password before using this.')
  }
  return { uid, profile, db }
}

/**
 * Ask Metabase, with a timeout, and without ever putting the key in a URL.
 *
 * The key travels in the `x-api-key` header. A query parameter would land in
 * the instance's access log, in any proxy in front of it, and in the referrer
 * of whatever it redirects to.
 */
async function metabaseFetch(url, apiKey, { method = 'GET', body } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), METABASE_TIMEOUT_MS)
  try {
    return await fetch(url, {
      method,
      headers: {
        'x-api-key': apiKey,
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Turn a Metabase failure into something an admin can act on.
 *
 * The instance's own error body is deliberately NOT forwarded: it can quote the
 * SQL of the question, which names tables and columns in a warehouse the member
 * reading this dashboard has no business seeing. The status code is the
 * actionable part, and it is enough to tell "your key is wrong" apart from
 * "that question no longer exists".
 */
function metabaseFailure(status) {
  if (status === 401 || status === 403) {
    return 'Metabase rejected the API key. Check it has not been revoked, and that its permission group can read the question.'
  }
  if (status === 404) return 'Metabase has no saved question with that ID.'
  if (status === 429) return 'Metabase is rate-limiting these requests. Try again shortly.'
  if (status >= 500) return 'Metabase returned a server error while running the question.'
  return `Metabase refused the request (HTTP ${status}).`
}

/** The connection settings, for the admin screen. Without the key. */
export const metabaseConfig = onCall({ region: REGION }, async (request) => {
  const { profile, db } = await metabaseCaller(request, { adminOnly: true })
  const snap = await db.doc(configPath(profile.orgId)).get()
  return { config: redactConfig(snap.exists ? snap.data() : null) }
})

/**
 * Does this connection work?
 *
 * Hits /api/user/current, which proves the URL resolves and the key is valid
 * without running anybody's query — a test button that executes a warehouse
 * question is a test button people stop pressing.
 *
 * Takes an optional `apiKey` so an admin can verify a key BEFORE saving it.
 * That key is used for this one request and written nowhere.
 *
 * `sourceId` names WHICH instance is being tested, so a row whose key box is
 * empty is tested with the key that instance would actually use — its own if it
 * has one, the shared key otherwise. Without it, testing an unedited row would
 * fall back to the first source's key and report a pass for a credential that
 * instance never uses.
 */
export const metabaseTest = onCall({ region: REGION }, async (request) => {
  const { profile, db } = await metabaseCaller(request, { adminOnly: true })
  const stored = normalizeConfig((await db.doc(configPath(profile.orgId)).get()).data())
  const sourceId = String(request.data?.sourceId || '')
  const source = stored.sources.find((s) => s.id === sourceId) || stored.sources[0] || null

  const url = checkBaseUrl(request.data?.baseUrl || source?.baseUrl)
  if (!url.ok) return { ok: false, message: url.reason }
  const apiKey = String(request.data?.apiKey || '') || source?.apiKey || stored.apiKey
  if (!apiKey) return { ok: false, message: 'No API key is saved yet.' }

  try {
    const res = await metabaseFetch(currentUserUrl(url.origin), apiKey)
    if (!res.ok) return { ok: false, message: metabaseFailure(res.status) }
    const me = await res.json()
    return {
      ok: true,
      // Which account the key acts as. An admin who has just connected the
      // wrong instance recognises it here and nowhere else.
      message: `Connected as ${me?.common_name || me?.email || 'an API user'}.`,
    }
  } catch (e) {
    logger.warn('metabaseTest: unreachable', { orgId: profile.orgId, error: e?.message || String(e) })
    return {
      ok: false,
      message: e?.name === 'AbortError'
        ? `Metabase did not answer within ${Math.round(METABASE_TIMEOUT_MS / 1000)} seconds.`
        : 'Could not reach that address. Check the URL, and that the instance resolves publicly.',
    }
  }
})

/**
 * Run one configured saved question and hand back its rows.
 *
 * Open to every approved member, because the dashboard is. What bounds it is
 * that the caller chooses a DATASET NAME, not a card id and not a URL: the only
 * questions reachable through here are the ones an admin of that same
 * organization put in the settings. A caller cannot point this at card 913 and
 * read the finance question.
 */
// 300s, not 120s. The Metabase wait is 100s and a 5xx is retried once, so the
// worst honest case is a little over 200s; a 120s budget would kill the retry
// that exists precisely to rescue that case.
export const metabaseQuery = onCall({ region: REGION, timeoutSeconds: 300 }, async (request) => {
  const { uid, profile, db } = await metabaseCaller(request)

  const dataset = String(request.data?.dataset || '')
  // The window to run the question over, bound to whatever date variables the
  // saved question declares. Clamped rather than refused — this is a dashboard
  // filter, and a date picker that errors is worse than one that quietly
  // returns the last year. See safeRange and buildDateParams.
  const range = safeRange({ from: request.data?.from, to: request.data?.to }, Date.now(), DEFAULT_RANGE_DAYS)
  const config = normalizeConfig((await db.doc(configPath(profile.orgId)).get()).data())
  const ready = readiness(config, dataset)
  if (!ready.ok) {
    // A reason, not a bare refusal: "nobody has connected Metabase yet" and
    // "the audits question is not set" are different screens in the tab, and
    // the member reading either needs to know which one to ask an admin for.
    return { ok: false, reason: ready.reason, dataset }
  }

  // Every instance that has this question, asked at once. In parallel because
  // they are independent hosts and the slowest one should set the wait, not the
  // sum of them.
  const targets = sourcesFor(config, dataset)
  // Metabase's own words about a failure reach an ADMIN and nobody else. They
  // are the only thing that makes a broken question diagnosable — "server
  // error" names no field, no parameter and no permission — and they can quote
  // the question's SQL, which is a warehouse's schema and not something an
  // ordinary member reading a safety dashboard should be shown.
  const detailed = profile.role === 'admin'
  const results = await Promise.all(targets.map((s) => querySource(s, dataset, profile.orgId, detailed, range)))

  const answered = results.filter((r) => r.ok)
  if (answered.length === 0) {
    // Everything failed. The first failure's reason is returned so the tab can
    // still show a specific screen, with every source's own outcome beside it.
    const first = results[0] || { reason: 'unreachable' }
    logger.warn('metabaseQuery: every source failed', { orgId: profile.orgId, dataset, sources: results.length })
    return {
      ok: false, reason: first.reason, message: first.message, dataset,
      ...(first.detail ? { detail: first.detail } : {}),
      sources: outcomes(results),
    }
  }

  // Merged, then capped — the cap is on what the browser is sent, and applying
  // it per source would let a two-instance tenant receive twice as much as a
  // one-instance tenant before anything said the figures were partial.
  const merged = answered.flatMap((r) => r.rows)
  const { rows, total, capped } = capRows(merged)
  const unmapped = [...new Set(answered.flatMap((r) => r.unmapped))]
  // Columns that mapped onto a field another column had already filled. Carried
  // separately from `unmapped` because the fix differs: an unmapped column needs
  // a name ODIN knows, a shadowed one already has it and is losing a fight.
  const shadowed = [...new Set(answered.flatMap((r) => r.shadowed || []))]

  logger.info('metabaseQuery: ok', {
    uid, orgId: profile.orgId, dataset, rows: rows.length, capped,
    sources: `${answered.length}/${results.length}`,
  })
  return {
    ok: true,
    dataset,
    // The window that actually ran, and which of the question's parameters it
    // was bound to. The tab prints the window; an admin whose figure disagrees
    // with Metabase needs the binding, because the usual cause is the two
    // having been asked different questions.
    range,
    bound: answered.flatMap((r) => r.bound || []),
    rows,
    unmapped,
    shadowed,
    total,
    capped,
    // Per source, always — including when they all succeeded. "These numbers
    // are from two of your three instances" is a caveat the dashboard has to be
    // able to print, and it cannot if only failures are reported.
    sources: outcomes(results),
    fetchedAt: new Date().toISOString(),
  }
})

/** What the client is told about each instance. Never a URL it did not configure. */
const outcomes = (results) => results.map((r) => ({
  id: r.id, label: r.label, ok: r.ok, rows: r.rows?.length ?? 0, reason: r.reason, message: r.message,
  // Present only for an admin — querySource decides, this just carries it.
  ...(r.detail ? { detail: r.detail } : {}),
}))

/**
 * One instance, one question.
 *
 * Never throws: a source that is down is a RESULT, because the whole point of
 * running several is that one of them failing does not take the dashboard with
 * it. Rows come back tagged with where they came from, so a figure on the
 * dashboard can be traced to the instance that produced it.
 */
async function querySource(source, dataset, orgId, detailed = false, range = null) {
  const tag = { id: source.id, label: source.label || source.baseUrl }
  // Metabase's own account of a failure, for an admin only. `detail` is what
  // turns "server error" into something fixable — a missing required
  // parameter, a column that no longer exists, a permission on the underlying
  // database rather than on the question.
  const withDetail = async (base, response) => {
    if (!detailed || !response) return base
    try {
      const body = await response.text()
      if (!body) return base
      let text = body
      try {
        const j = JSON.parse(body)
        text = j?.message || j?.error || j?.error_message || body
      } catch { /* not JSON — the raw body is what there is */ }
      const detail = String(text).replace(/\s+/g, ' ').trim().slice(0, 500)
      return detail ? { ...base, detail } : base
    } catch {
      return base
    }
  }

  const url = checkBaseUrl(source.baseUrl)
  if (!url.ok) return { ...tag, ok: false, reason: 'bad-url', message: url.reason }

  // ── The date range ─────────────────────────────────────────────────────────
  //
  // Discovering the question's parameters costs one extra request, and skipping
  // it is not an option: a question that declares required date variables — as
  // both of the ones this was built against do — answers a bare POST with
  // "missing required parameters" and nothing else. So the shape is fetched,
  // cached for the life of this instance, and the range bound to it.
  //
  // A failure here is NOT fatal. If the question cannot be described, the query
  // runs the way it always did; a question with no date parameters is
  // unaffected either way, and one that needs them will report its own error
  // in a moment, which is a better message than anything invented here.
  const cardId = source.cards[dataset]
  let bound = []
  let parameters = []
  if (range) {
    try {
      const card = await describeCard(url.origin, cardId, source.apiKey)
      if (card) ({ parameters, bound } = buildDateParams(card, range))
    } catch (e) {
      logger.warn('metabaseQuery: could not describe card', { orgId, dataset, source: source.id, error: e?.message || String(e) })
    }
  }

  // ── One retry, and only on a 5xx ───────────────────────────────────────────
  //
  // A big warehouse question does not fail cleanly. Both of these come back
  // with "Encountered too many errors talking to a worker node" — a Trino
  // worker falling over under load — perhaps one run in five, and the identical
  // request succeeds moments later. Surfacing that as "Metabase returned a
  // server error" is technically true and leaves a dashboard randomly blank.
  //
  // Only 5xx is retried. A 401 is an expired key and a 404 is a deleted
  // question: both fail the same way twice, and retrying them doubles the wait
  // before the reader is told something they need to act on.
  const post = () => metabaseFetch(cardQueryUrl(url.origin, cardId), source.apiKey, {
    method: 'POST',
    // Only when there is something to send. An empty body is what this always
    // sent, and a question with no parameters must keep behaving identically.
    ...(parameters.length ? { body: { parameters } } : {}),
  })

  let res
  try {
    res = await post()
    if (res.status >= 500) {
      logger.info('metabaseQuery: retrying after a server error', { orgId, dataset, source: source.id, status: res.status })
      res = await post()
    }
  } catch (e) {
    logger.warn('metabaseQuery: unreachable', { orgId, dataset, source: source.id, error: e?.message || String(e) })
    return {
      ...tag,
      ok: false,
      reason: 'unreachable',
      // Naming the window matters: the usual cause is a range too wide for the
      // question, and "did not answer in time" alone sends people to look at
      // the network instead of at the date pickers.
      message: e?.name === 'AbortError'
        ? `Metabase did not answer within ${Math.round(METABASE_TIMEOUT_MS / 1000)} seconds${range ? ` for ${range.from} to ${range.to}` : ''}. Try a shorter date range.`
        : 'Could not reach Metabase.',
    }
  }
  if (!res.ok) {
    logger.warn('metabaseQuery: refused', { orgId, dataset, source: source.id, status: res.status })
    return withDetail({ ...tag, ok: false, reason: 'refused', message: metabaseFailure(res.status) }, res)
  }

  let payload
  try {
    payload = await res.json()
  } catch {
    return { ...tag, ok: false, reason: 'query-failed', message: 'Metabase did not return JSON.' }
  }
  // /query/json answers with an array of row objects on success. Anything else
  // is Metabase reporting a failed query inside a 200, which it does.
  if (!Array.isArray(payload)) {
    logger.warn('metabaseQuery: query error', { orgId, dataset, source: source.id })
    // The generic line for everyone; Metabase's own words only for an admin.
    // This used to hand that text to every caller, which is the schema leak the
    // rest of this function is careful about.
    const base = { ...tag, ok: false, reason: 'query-failed', message: 'Metabase could not run that question.' }
    const detail = String(payload?.error || payload?.message || '').replace(/\s+/g, ' ').trim().slice(0, 500)
    return detailed && detail ? { ...base, detail } : base
  }

  const mapped = normalizeRows(payload)
  return {
    ...tag,
    ok: true,
    rows: mapped.rows.map((r) => ({ ...r, sourceId: tag.id, sourceLabel: tag.label })),
    unmapped: mapped.unmapped,
    shadowed: mapped.shadowed,
    bound: bound.map((x) => ({ ...x, source: tag.id })),
  }
}

/**
 * A saved question's shape — its parameters, mostly — cached per instance.
 *
 * The parameters of a saved question change when somebody edits the question,
 * which is rare, and a Cloud Function instance lives minutes to hours. Caching
 * for that lifetime turns one extra round trip per dashboard load into one per
 * cold start; an edit is picked up the next time an instance starts, and the
 * worst case in between is a query refused for a parameter that moved, which
 * reports itself.
 *
 * Null on any failure — never throws, because a question that cannot be
 * described can still very often be run.
 */
const cardShapeCache = new Map()
async function describeCard(origin, cardId, apiKey) {
  const key = `${origin}#${cardId}`
  if (cardShapeCache.has(key)) return cardShapeCache.get(key)
  let card = null
  try {
    const res = await metabaseFetch(cardUrl(origin, cardId), apiKey)
    if (res.ok) {
      const body = await res.json()
      // Only the parameters are kept. The rest of a card document is the query
      // itself — the warehouse's schema — and there is no reason to hold it.
      card = { parameters: Array.isArray(body?.parameters) ? body.parameters : [] }
    }
  } catch { /* described below by not being described */ }
  cardShapeCache.set(key, card)
  return card
}

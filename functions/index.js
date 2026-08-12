// ─────────────────────────────────────────────────────────────────────────────
// Cloud Functions entry point.
//
// package.json has named this file as `main` since the tier was written, but it
// never existed — everything under lib/ was library code with nothing calling
// it. That is why `firebase deploy --only functions` had nothing to deploy.
//
// The first thing here was the smallest change that closes SECURITY.md S-01:
// putting the caller's organization onto their ID token so Cloud Storage rules
// can read it. Storage rules cannot query Firestore, so without a claim they
// have no way to tell one tenant from another — which is exactly why any
// signed-in user could reach any org's files.
//
// The notification tier follows it: a trigger per action-carrying collection,
// and one scheduled digest. Both are thin — every decision they make lives in
// lib/notify.js, which is where the tenant scoping is enforced and tested.
// ─────────────────────────────────────────────────────────────────────────────
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'
import { claimsFor, claimsChanged, mergeClaims } from './lib/claims.js'
import { planBackfill } from './lib/docVisibility.js'
import { classifyLocks } from './lib/defectLocks.js'
import { createMailer } from './lib/email.js'
import {
  onActionWrite,
  runDailyDigest,
  mailConfigFromEnv,
  appConfigFromEnv,
  DIGEST_TZ,
} from './lib/notify.js'

initializeApp()

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

// ── Notifications ────────────────────────────────────────────────────────────

/**
 * The mailer, built on first use rather than at module load.
 *
 * createMailer throws on a provider name it does not recognise. At module scope
 * that would be a typo in MAIL_PROVIDER taking down every function in this file
 * — including the claims trigger, which has nothing to do with email. Built
 * lazily and defaulted to console output, a misconfiguration costs the mail and
 * a log line, nothing else.
 *
 * With no MAIL_PROVIDER set at all, createMailer selects the console provider
 * and sends nothing: deploying this does not start mailing anyone until
 * MAIL_PROVIDER and MAIL_API_KEY are both present.
 */
let mailer = null
function getMailer() {
  if (!mailer) {
    try {
      mailer = createMailer(mailConfigFromEnv(process.env))
    } catch (err) {
      logger.error('notify: mail configuration is invalid — falling back to console output', {
        error: String(err?.message || err),
      })
      mailer = createMailer({})
    }
    logger.info('notify: mail provider', { provider: mailer.provider })
  }
  return mailer
}

/**
 * One trigger per collection that carries corrective actions.
 *
 * Deliberately five narrow paths rather than one wildcard on
 * organizations/{orgId}/{col}/{docId}. A wildcard would fire on every write in
 * the product — audit logs, activity, counters — to discard nearly all of them,
 * and it would also match the notifications ledger that lib/notify.js writes to,
 * so each email sent would trigger the function that sends emails.
 *
 * retry is on because the handler rethrows for a provider outage; lib/notify.js
 * stops rethrowing once the event is older than its retry window, which is what
 * keeps a bad day from becoming 24 hours of billed attempts.
 */
const actionTrigger = (collection) =>
  onDocumentWritten(
    { document: `organizations/{orgId}/${collection}/{docId}`, region: REGION, retry: true },
    (event) =>
      onActionWrite({
        db: getFirestore(),
        mailer: getMailer(),
        collection,
        event,
        config: appConfigFromEnv(process.env),
        log: logger,
      })
  )

// Named one by one because ESM exports cannot be generated in a loop, and the
// deploy tooling discovers functions by enumerating this module's exports.
// A new source collection in lib/actionSources.js needs a line here too.
export const notifyIncidentActions = actionTrigger('incidents')
export const notifyIllnessActions = actionTrigger('illnesses')
export const notifyDrillActions = actionTrigger('mockDrills')
export const notifyAuditFindingActions = actionTrigger('auditFindings')
export const notifyConsultationActions = actionTrigger('consultations')

/**
 * The daily digest of what is overdue, per organization.
 *
 * 07:00 in the timezone the digest measures "today" in, so the mail lands before
 * the shift it is about. retryCount is 0 on purpose: the handler never throws —
 * it logs a failing org and carries on — so a retry would only re-read every
 * tenant to send nothing, and tomorrow's run covers anything missed anyway.
 */
export const dailyDigest = onSchedule(
  { schedule: '0 7 * * *', timeZone: DIGEST_TZ, region: REGION, retryCount: 0, timeoutSeconds: 540 },
  () =>
    runDailyDigest({
      db: getFirestore(),
      mailer: getMailer(),
      config: appConfigFromEnv(process.env),
      log: logger,
    })
)

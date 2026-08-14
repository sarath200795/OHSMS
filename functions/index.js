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
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'
import { claimsFor, claimsChanged, mergeClaims, revokesAccess } from './lib/claims.js'
import { planBackfill } from './lib/docVisibility.js'
import { classifyLocks } from './lib/defectLocks.js'
import { PURGEABLE, PURGE_AFTER_DAYS, MAX_PURGES_PER_RUN, planPurge } from './lib/retention.js'

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

// The timezone a scheduled run's clock time means. A retention sweep pinned to
// UTC would move around the working day twice a year for everyone reading the
// logs, and "03:30" is chosen to be the quiet part of THEIR night.
const SCHEDULE_TZ = 'Asia/Kolkata'

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

let bucket = null
const getBucket = () => (bucket ||= getStorage().bucket())

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
        if (path) {
          const ctx = { orgId, collection: spec.collection, docId: id }
          if (await purgeStoredFile(store || getBucket(), path, ctx)) files += 1
        }
        await kid.ref.delete()
      }
    }

    // The public QR mirror lives outside the org path, keyed by token. Leaving
    // it behind means a world-readable record of equipment that no longer
    // exists, reachable by anyone who photographed the label.
    if (spec.qrMirror && row?.data?.qrToken) {
      await db.collection('qr').doc(String(row.data.qrToken)).delete().catch(() => {})
    }

    await ref.delete()
  }

  return { purged: purge.length, kept: keep.length, files }
}

export const purgeSoftDeleted = onSchedule(
  { schedule: '30 3 * * *', timeZone: SCHEDULE_TZ, region: REGION, retryCount: 0, timeoutSeconds: 540 },
  async () => {
    const db = getFirestore()
    const now = Date.now()
    const orgs = await db.collection('organizations').get()
    let total = 0
    let totalFiles = 0

    for (const org of orgs.docs) {
      for (const spec of PURGEABLE) {
        try {
          const { purged, kept, files } = await purgeOrgCollection(db, org.id, spec, now)
          total += purged
          totalFiles += files
          if (purged > 0) {
            logger.info('retention: purged', { orgId: org.id, collection: spec.collection, purged, kept, files })
          }
        } catch (e) {
          // One bad collection must not stop the rest, and must not retry the
          // whole sweep — the next run covers it.
          logger.error('retention: skipped', {
            orgId: org.id, collection: spec.collection, error: e?.message || String(e),
          })
        }
      }
    }

    logger.info('retention: run complete', { organizations: orgs.size, purged: total, files: totalFiles })
  }
)

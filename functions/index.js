// ─────────────────────────────────────────────────────────────────────────────
// Cloud Functions entry point.
//
// package.json has named this file as `main` since the tier was written, but it
// never existed — everything under lib/ was library code with nothing calling
// it. That is why `firebase deploy --only functions` had nothing to deploy.
//
// What is here now is the smallest thing that closes SECURITY.md S-01: putting
// the caller's organization onto their ID token so Cloud Storage rules can read
// it. Storage rules cannot query Firestore, so without a claim they have no way
// to tell one tenant from another — which is exactly why any signed-in user can
// currently reach any org's files.
//
// The notification triggers and the scheduled digest are NOT here yet. The
// templates, recipient matching and action extraction under lib/ are ready for
// them, and they belong in this same file when they land.
// ─────────────────────────────────────────────────────────────────────────────
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'
import { claimsFor, claimsChanged, mergeClaims } from './lib/claims.js'

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
  let skipped = 0
  const failed = []

  for (const doc of members.docs) {
    const uid = doc.id
    try {
      const record = await getAuth().getUser(uid)
      const existing = record.customClaims || {}
      const next = claimsFor(doc.data())
      if (!claimsChanged(existing, next)) {
        skipped += 1
        continue
      }
      await getAuth().setCustomUserClaims(uid, mergeClaims(existing, next))
      updated += 1
    } catch (err) {
      // One missing auth user must not abandon the rest of the org half-done.
      if (err?.code === 'auth/user-not-found') {
        skipped += 1
        continue
      }
      failed.push(uid)
      logger.error('claims: backfill failed for one user', { uid, code: err?.code })
    }
  }

  logger.info('claims: backfill complete', { orgId: caller.orgId, updated, skipped, failed: failed.length })
  return { orgId: caller.orgId, total: members.size, updated, skipped, failed }
})

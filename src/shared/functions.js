// ─────────────────────────────────────────────────────────────────────────────
// Callable Cloud Functions.
//
// Pinned to the region the functions are deployed in. Firebase defaults
// callables to us-central1, and a mismatch fails with a CORS error rather than
// anything naming the region — so this is the one place that knows, and callers
// never pass it.
//
// Loaded lazily. The maintenance screen is the only caller, an admin opens it
// rarely, and firebase/functions is dead weight in every other bundle.
// ─────────────────────────────────────────────────────────────────────────────
import app from './firebase'

// Must match REGION in functions/index.js.
export const FUNCTIONS_REGION = 'asia-south1'

async function callable(name) {
  const { getFunctions, httpsCallable } = await import('firebase/functions')
  return httpsCallable(getFunctions(app, FUNCTIONS_REGION), name)
}

/**
 * Stamp `visibility` onto documents written before site scoping existed.
 * Reports without writing unless `dryRun: false`.
 */
export async function backfillDocumentVisibility({ dryRun = true } = {}) {
  const fn = await callable('backfillDocumentVisibility')
  return (await fn({ dryRun })).data
}

/**
 * Stamp orgId onto QR mirrors written before the field existed.
 *
 * Those mirrors cannot be updated by anyone: the rule reads
 * resource.data.orgId directly, an absent field raises, and a raising rule
 * denies. Since the bulk extinguisher import writes each asset and its mirror
 * in one batch, a single stale mirror refuses the entire upload.
 *
 * Reports without writing unless `dryRun: false`. Read `foreign` before
 * committing — a mirror naming another org is a token collision, and this
 * deliberately refuses to rewrite one.
 */
export async function backfillQrMirrors({ dryRun = true } = {}) {
  const fn = await callable('backfillQrMirrors')
  return (await fn({ dryRun })).data
}

/**
 * Remove medical detail from incident documents that still carry it.
 *
 * Every field was written twice: once to /injuries, which is manager-only, and
 * once onto the incident, which every member and the external auditor can list.
 * New records no longer do that. This is the history.
 *
 * Reports without writing unless `dryRun: false`. It refuses to strip a field
 * it cannot first find in the matching /injuries record — losing an injury
 * record is worse than the exposure being closed — and reports those as
 * `blocked` for a human.
 */
export async function stripIncidentMedicalDetail({ dryRun = true } = {}) {
  const fn = await callable('stripIncidentMedicalDetail')
  return (await fn({ dryRun })).data
}

/** Put orgId on every member's ID token, so Storage rules can read it. */
export async function backfillClaims() {
  const fn = await callable('backfillClaims')
  return (await fn()).data
}

/**
 * Delete defect locks whose fault no longer exists, so the unit can be reported
 * again. Reports without deleting unless `dryRun: false`.
 */
export async function clearOrphanedDefectLocks({ dryRun = true } = {}) {
  const fn = await callable('clearOrphanedDefectLocks')
  return (await fn({ dryRun })).data
}

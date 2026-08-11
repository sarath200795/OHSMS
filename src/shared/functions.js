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

/** Put orgId on every member's ID token, so Storage rules can read it. */
export async function backfillClaims() {
  const fn = await callable('backfillClaims')
  return (await fn()).data
}

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
 * The signed-in member's encryption keys, as their role entitles them.
 *
 * Takes no argument on purpose: the organization, the role and therefore the
 * key classes are all read from the caller's own /users profile server-side, so
 * there is nothing in the request to tamper with.
 *
 * Returns `{ general?: {keyId, key}, medical?: {keyId, publicKey, privateKey?} }`
 * with every key base64URL-encoded. A half the caller is not entitled to is
 * ABSENT rather than null — most importantly `medical.privateKey`, which only
 * admin and manager receive, mirroring the isManagerOf gate on /injuries.
 *
 * Called once per session by shared/crypto/keyring.js, which holds the result in
 * memory only. Nothing persists these to localStorage or IndexedDB: a key in
 * site storage outlives the tab, the sign-out and the browser restart, which
 * would make the session-scoped auth persistence this app deliberately chose
 * (browserSessionPersistence, shared/firebase.js) meaningless for the data.
 */
export async function getDataKeys() {
  const fn = await callable('getDataKeys')
  return (await fn()).data
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
 * Give equipment the siteId it was created without.
 *
 * Extinguishers, AEDs and FAS devices imported before sites were first-class
 * carry a free-text centre name and no site link, so every join through the
 * site registry — the display fill-in, the analytics roll-ups, the site
 * filters — sees nothing for them. This matches the name against the registry
 * and writes the id. It never writes a name, in either direction: the centre
 * name is printed on the equipment.
 *
 * Reports without writing unless `dryRun: false`. Read `ambiguousTotal` and
 * `conflictingTotal` before committing — a name that resolves to two sites, and
 * a record whose existing link disagrees with its name, are both reported and
 * neither is guessed at. Filing equipment at the wrong site is the failure this
 * exists to fix.
 */
export async function linkEquipmentSites({ dryRun = true } = {}) {
  const fn = await callable('linkEquipmentSites')
  return (await fn({ dryRun })).data
}

/**
 * Copy medical detail from incidents INTO the injury records that are missing
 * it. Step one of two; it removes nothing.
 *
 * stripIncidentMedicalDetail below refuses to remove a field it cannot first
 * find in /injuries, and a record existing is not the same as a record being
 * complete — a real run reported `injuries: 1` and `blocked: 1` at once.
 * Nothing in the app closes that gap, so the strip alone would report the same
 * blocked row forever.
 *
 * Reports without writing unless `dryRun: false`. Creates the missing record
 * and fills empty fields only: it never overwrites an answer /injuries already
 * holds, never touches a verified or deleted record, and never invents a
 * document id for a row that names no person. Those come back in `blocked`.
 */
export async function seedInjuryRecords({ dryRun = true } = {}) {
  const fn = await callable('seedInjuryRecords')
  return (await fn({ dryRun })).data
}

/**
 * Remove medical detail from incident documents that still carry it. Step two
 * of two — run seedInjuryRecords first.
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

/**
 * Move the medical record FILES out of the incident photo album.
 *
 * The strip above confined the injury fields. The attached documents stayed in
 * incidents/{id}/photos, which every member and the external auditor can list —
 * so a GP letter, a fit note or a discharge summary came back with its filename
 * and a permanent download URL. They now live under the injury record, and their
 * bytes under a Storage prefix only managers can read.
 *
 * Moves the pointer AND the file, in that order and never the reverse: the new
 * copy is written and read back before anything old is deleted, so an
 * interrupted run leaves the record in both places rather than neither.
 *
 * Reports without moving anything unless `dryRun: false`. Read `blockedTotal`
 * first — a record on an incident that injured more than one person cannot be
 * attributed from what was stored, and this refuses to guess whose it is.
 *
 * What it cannot do: a download URL already handed out is a bearer link that no
 * rule is consulted for. This deletes the file it names, which stops that link
 * working — but nothing recalls a copy somebody has already downloaded.
 */
export async function confineMedicalRecords({ dryRun = true } = {}) {
  const fn = await callable('confineMedicalRecords')
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

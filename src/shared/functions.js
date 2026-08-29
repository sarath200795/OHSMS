// ─────────────────────────────────────────────────────────────────────────────
// Callable Cloud Functions.
//
// Pinned to the region the functions are deployed in. Firebase defaults
// callables to us-central1, and a mismatch fails with a CORS error rather than
// anything naming the region — so this is the one place that knows, and callers
// never pass it.
//
// Loaded lazily: firebase/functions is dead weight in every bundle that never
// calls one, and most of them do not. The maintenance screen was once the only
// caller; the ODIN analytics tab is the other one, and it is why the emulator
// wiring below had to exist at all.
// ─────────────────────────────────────────────────────────────────────────────
import app, { emulatorFunctions } from './firebase'

// Must match REGION in functions/index.js.
export const FUNCTIONS_REGION = 'asia-south1'

// The Functions instance, built once. The emulator connection has to happen
// HERE rather than in firebase.js because this SDK is loaded lazily — and until
// it did, every callable in local development quietly went to the DEPLOYED
// production functions instead of the ones running on the developer's machine.
// The suite would start, register the functions, log nothing, and the app would
// report a bare "internal".
let functionsPromise = null
async function getFns() {
  if (!functionsPromise) {
    functionsPromise = import('firebase/functions').then((mod) => {
      const fns = mod.getFunctions(app, FUNCTIONS_REGION)
      if (emulatorFunctions) {
        mod.connectFunctionsEmulator(fns, emulatorFunctions.host, emulatorFunctions.port)
      }
      return { mod, fns }
    })
  }
  return functionsPromise
}

async function callable(name) {
  const { mod, fns } = await getFns()
  return mod.httpsCallable(fns, name)
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

/**
 * Encrypt the objects already sitting in the bucket.
 *
 * Sealing new uploads left every photo, drill evidence shot and attachment
 * uploaded before the switch lying in Cloud Storage in the clear. This is the
 * history — the counterpart to the Firestore backfill, which re-writes
 * documents and never touches bytes.
 *
 * Reports without touching anything unless `dryRun: false`. Read `failedTotal`
 * before believing a run finished: the ordering is write, verify, re-point,
 * THEN delete, so a failure leaves the original readable rather than the file
 * corrupt in one place and gone from the other.
 *
 * Capped per run — each object is six network operations on payloads up to ten
 * megabytes — so a large estate is a series of finished runs. `remaining` says
 * how many are left.
 *
 * What it cannot undo: a getDownloadURL handed out before an object was sealed
 * is a bearer link no rule is consulted for. Deleting the plaintext stops that
 * link working, but nothing recalls a copy somebody already downloaded.
 */
export async function sealStoredObjects({ dryRun = true } = {}) {
  const fn = await callable('sealStoredObjects')
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

/**
 * Delete one stored file, with the caller's standing checked against their LIVE
 * profile instead of their ID token.
 *
 * `storage.rules` refuses client deletes outright, so this is the only route.
 * It exists because a Storage rule can only read the org and role a token
 * CLAIMS, and a token stays valid for up to an hour after the account behind it
 * is suspended, demoted or moved — an hour in which the evidence could still be
 * destroyed. See SECURITY.md S-19.
 *
 * Called by shared/storage removeFile(), which stays best-effort: an orphaned
 * object is a cost, a failed delete is not a correctness bug.
 */
export async function deleteOrgFile(path) {
  const fn = await callable('deleteOrgFile')
  return (await fn({ path })).data
}

/**
 * Everything this organization holds about one person — a subject access request.
 *
 * Manager-only server-side, and scoped to the caller's own organization: the
 * subject must be a member of it, because a uid is not a secret and an export
 * keyed on one would otherwise reach across tenants.
 *
 * Read what comes back carefully, because it has two halves that mean different
 * things. `records` is COMPLETE — everything joined by a key. `mentions` is a
 * list of PLACES TO LOOK, not results: a person's name is also free text inside
 * array objects (`affectedPersonnel[].name`, `attendees[].name`), which
 * Firestore cannot query. Presenting those as "none found" would make an
 * incomplete response look authoritative.
 *
 * Pass `encryptionOn` so the reply can say whether a scan of those fields could
 * have read anything at all — over sealed data it would return zero matches,
 * which is indistinguishable from a person who is genuinely not mentioned.
 */
export async function exportSubjectData({ uid, personId, encryptionOn } = {}) {
  const fn = await callable('exportSubjectData')
  return (await fn({ uid, personId, encryptionOn })).data
}

// ── ODIN / Metabase ─────────────────────────────────────────────────────────
//
// Everything here goes through a callable rather than fetching Metabase from
// the browser, for two reasons that both have to hold.
//
// The API key is a bearer credential for the whole analytics warehouse. Handing
// it to a browser hands it to everyone who can open a tab, and no Firestore
// rule can take it back — so it stays server-side, and none of these functions
// can return it. metabaseSettings() reads the connection back for an admin with
// the key REMOVED (functions/lib/metabase.js redactConfig), not masked.
//
// The second reason is duller and just as binding: a browser cannot call a
// self-hosted Metabase at all unless that instance sets CORS headers for this
// origin, which is an operator's problem in somebody else's infrastructure.

/** The connection settings for the admin screen — never the key. */
export async function metabaseSettings() {
  const fn = await callable('metabaseConfig')
  return (await fn()).data
}

/**
 * Try the connection and say what happened, in words an admin can act on.
 *
 * Pass `{ baseUrl, apiKey }` to test a key BEFORE saving it — that value is
 * used for the one request and written nowhere. Pass `sourceId` to say WHICH
 * configured instance is being tested, so a row whose key box is empty is
 * tested with the key that instance would actually use. Pass nothing to test
 * the first stored source.
 *
 * Resolves either way: `{ ok, message }`. A failed connection test is an
 * ANSWER, not an exception — it is the entire output of pressing the button.
 */
export async function metabaseTestConnection({ baseUrl, apiKey, sourceId } = {}) {
  const fn = await callable('metabaseTest')
  return (await fn({ baseUrl, apiKey, sourceId })).data
}

/**
 * Run one of the configured saved questions.
 *
 * `dataset` is a NAME ('findings' | 'audits'), never a card id: the only
 * questions reachable are the ones an admin of this organization put in the
 * settings, so a caller cannot point this at another question in the instance.
 *
 * Resolves to `{ ok: true, rows, unmapped, total, capped, sources, fetchedAt }`,
 * or to `{ ok: false, reason, message, sources }` — 'not-configured',
 * 'no-card', 'unreachable', 'refused', 'query-failed'. Those are different
 * screens in the tab, and the person reading one needs to know which thing to
 * ask an admin for, so they come back as data rather than as one
 * undifferentiated throw.
 *
 * When more than one instance is configured, the rows are MERGED and each
 * carries `sourceId`/`sourceLabel`. `sources` reports each instance's outcome
 * whether it succeeded or not, so "these figures are from two of your three
 * instances" is a caveat the dashboard can actually print. `ok` is true when at
 * least one answered: a single instance being down must not blank a dashboard
 * the others can fill.
 */
export async function metabaseQuery(dataset) {
  const fn = await callable('metabaseQuery')
  return (await fn({ dataset })).data
}

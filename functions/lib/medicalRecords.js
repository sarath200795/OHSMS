// ─────────────────────────────────────────────────────────────────────────────
// Moving the medical record FILES out of the photo album.
//
// stripIncidentMedicalDetail confined the injury FIELDS to /injuries. The
// documents were left where they were: incidents/{id}/photos, carrying
// kind: 'medical_record' beside a photograph of a damaged guard rail
// (addIncidentPhoto, src/modules/incidents/lib/incidents.js). The generic
// {sub=**} at the foot of firestore.rules grants read — get AND list — on that
// subtree to every approved member and to the external auditor, so one getDocs
// returned the filename, caption, size and download URL of every medical
// document in the tenant. A GP letter, a fit note, a discharge summary IS the
// record; the fields were confined and the scan of the same information was not.
//
// A `kind` field could never have closed it, because rules cannot filter WHICH
// documents a list returns. The collection had to differ, and it now does:
// injuries/{injuryId}/records/{recordId}, manager-only on both surfaces
// (firestore.rules, storage.rules). Closing the WRITE path closes nothing
// already stored, and what is already stored is the exposure — every record
// filed before that change still answers the query. Same reasoning already
// recorded for the visibility backfill and the medical strip: the migration is a
// PREREQUISITE of the rules change, not a tidy-up after it.
//
// Two things move, because a pointer nobody can read is worth nothing while the
// file behind it is readable by anyone in the tenant:
//
//   · the POINTER, from incidents/{id}/photos into injuries/{id}/records;
//   · the OBJECT, from the `incident-photos` Storage prefix to
//     `medical-records`. storage.rules excludes that one prefix from its generic
//     `allow read: if inOrg(orgId)` and grants it to managers underneath, so a
//     record whose bytes stay under the photo prefix is byte-identical to a
//     scene photo and indistinguishable to any rule. Leaving them there would
//     make the storage rule decorative for every record that already exists.
//
// What no migration can undo is in index.js beside the callable, and in the
// Maintenance card: a getDownloadURL handed out before today is a bearer link
// that answers to no rule, and anything already downloaded is simply gone.
//
// Pure planning only. Nothing here reads or writes Firestore or Storage;
// index.js does that with what these functions decide, which is what makes the
// decisions testable without a database — and, here, what keeps the ordering
// that protects the data (write, verify, THEN delete) in one readable place.
// ─────────────────────────────────────────────────────────────────────────────
import { injuryDocId } from './incidentMedical.js'

/** The label the old shape filed these under, inside the shared subcollection. */
export const LEGACY_KIND = 'medical_record'

/**
 * The Storage prefix the bytes move to.
 *
 * MUST stay identical to the literal in storage.rules, which excludes this
 * exact string from its generic read. Two copies of one string, in two
 * deployable units that cannot import from each other — the same seam, and the
 * same duty to stay in step, as REGION.
 *
 * There was a third copy in src/modules/incidents/lib/medicalRecords.js. That
 * file was superseded by this one and by the confineMedicalRecords callable,
 * and had stopped being imported by anything, so it was removed rather than
 * left to drift out of step unnoticed.
 */
export const MEDICAL_RECORD_KIND = 'medical-records'

/**
 * Fields that must NOT survive the move.
 *
 * `url` is the whole point. getDownloadURL mints a permanent unauthenticated
 * bearer link: it works from any browser, signed in or not, forever, and keeps
 * working after the holder leaves the organization, because no rule is ever
 * consulted. A pointer carrying one IS the access, so confining the pointer
 * while copying its url forward would move the document and leave the door.
 * Readers resolve `path` through getBlob instead, an authenticated request
 * storage.rules actually decides on.
 *
 * `kind` goes because the collection is the boundary now. A label on a row in a
 * shared collection is exactly the thing that did not work.
 */
export const DROPPED_FIELDS = ['url', 'kind']

/**
 * The fields whose safe arrival licences the DELETE.
 *
 * Deliberately not "every field": a carried-over extra could be a Timestamp,
 * which no cheap comparison survives, and a false mismatch here does not lose
 * data — it stalls the record in both places forever. These are the ones that
 * ARE the record: the file it names, what it is called, and the person it
 * belongs to.
 */
export const VERIFIED_FIELDS = [
  'name', 'type', 'size', 'path', 'dataUrl', 'caption', 'incidentId', 'personId',
]

/**
 * How many records one run may move.
 *
 * Each one is six round trips — copy, confirm, write, read back, delete the
 * object, delete the pointer — and they are sequential by necessity, because the
 * ordering IS the safety property. The cap keeps a run inside the 540s budget
 * and makes a large estate a series of finished runs rather than one that dies
 * half-way and reports nothing. Whatever is left over comes back as `remaining`.
 */
export const MAX_MOVES_PER_RUN = 200

const norm = (v) => String(v ?? '').trim()
const isBlank = (v) => v == null || String(v).trim() === ''

/**
 * Where an object moves to, or null if it must not be touched.
 *
 * Only the KIND segment changes. The filename keeps storagePath()'s eight random
 * bytes (src/shared/storage/index.js), so two records called `scan.pdf` cannot
 * collide at the destination and a re-run computes the same answer as the first
 * — which is what makes an interrupted move resumable rather than duplicated.
 *
 * Returns null for anything not under this org's own prefix, and for anything
 * containing '..', mirroring ownedByOrg() in index.js. `path` is a
 * CLIENT-WRITABLE field and this runs with Admin SDK privileges that never
 * consult storage.rules: a pointer naming another tenant's object would
 * otherwise have this job copy that object into this org and then delete the
 * original. Refused, and reported.
 *
 * A path already under this prefix comes back unchanged, so the caller sees
 * from === to and copies nothing. That is the resumed run.
 */
export function movedStoragePath(path, orgId) {
  const p = norm(path)
  const prefix = `orgs/${norm(orgId)}/`
  if (!p || !orgId || !p.startsWith(prefix) || p.includes('..')) return null

  const rest = p.slice(prefix.length)
  const cut = rest.indexOf('/')
  const file = cut < 0 ? '' : rest.slice(cut + 1)
  // Exactly three segments, as storagePath() always writes. Anything deeper was
  // not written by this app, and this job does not get to guess at its shape.
  if (cut <= 0 || !file || file.includes('/')) return null

  return `${prefix}${MEDICAL_RECORD_KIND}/${file}`
}

/**
 * Decide what moves where.
 *
 * @param incidents [{ id, refNo, injuryReports, photos: [{ id, ...data }] }]
 * @param injuries  Map<injuryDocId, data|null> — existence and deletedAt only
 * @param orgId     the org whose Storage prefix the objects must sit under
 *
 * The hard part is WHOSE record each file is, and the old shape did not record
 * it. StepInjuryReports passes `personId` into onAddPhoto, and addIncidentPhoto
 * writes ten named fields that do not include it — so the attribution was
 * dropped on the floor at upload time, for every record already stored.
 *
 * Two ways out of that, and only two:
 *
 *   · the pointer names a person itself (a later writer, or a hand fix) — used;
 *   · the incident names exactly ONE injured person, in which case the file can
 *     belong to nobody else. That is a deduction, not a guess: these are
 *     attached from the per-person control in Step 1a, so the file belongs to
 *     one of the people listed, and when the list has one entry the answer is
 *     forced.
 *
 * Anything else is reported and left alone. Filing one colleague's discharge
 * summary under another colleague's name is a worse outcome than the exposure
 * staying open one more day, and it is the kind of error nobody re-checks after
 * a migration reports success.
 */
export function planMedicalRecordMove(incidents = [], injuries = new Map(), orgId = '', { cap = MAX_MOVES_PER_RUN } = {}) {
  const all = []
  const blocked = []
  let photos = 0
  let records = 0
  let urlsDropped = 0
  let inlineRecords = 0
  let underDeletedInjury = 0

  for (const inc of incidents) {
    const list = Array.isArray(inc?.photos) ? inc.photos : []
    photos += list.length

    // Everyone this incident's records could belong to. Deduped, because the
    // same person appearing twice in injuryReports is not two candidates.
    const people = [...new Set(
      (Array.isArray(inc?.injuryReports) ? inc.injuryReports : [])
        .map((r) => norm(r?.personId))
        .filter(Boolean),
    )]

    for (const photo of list) {
      if (norm(photo?.kind) !== LEGACY_KIND) continue
      records += 1

      // FILENAMES ARE NEVER REPORTED, here or anywhere below. "MRI-left-knee —
      // A Kumar.pdf" is the record. A migration report that named the files it
      // declined to move would be one more copy of the thing being confined, in
      // a function response and in whatever logs it — the same rule
      // planMedicalStrip follows for values. The incident, its reference and the
      // document id are enough to find any row and carry nothing clinical.
      const row = { incidentId: inc.id, refNo: norm(inc.refNo) || inc.id, photoId: photo.id }
      const block = (reason) => blocked.push({ ...row, reason })

      const personId = norm(photo?.personId) || (people.length === 1 ? people[0] : '')
      if (!personId) { block(people.length > 1 ? 'several-people' : 'no-person-id'); continue }

      const injuryId = injuryDocId(inc.id, personId)
      const injury = injuries.get(injuryId)
      if (injury == null) {
        // The parent injury document is the join every other reader uses:
        // purgeIncidentMedicalRecords finds these by querying /injuries for the
        // incident, so a record filed under an injury that does not exist
        // survives the purge of the incident it documents, in a collection no
        // query in the product can reach. seedInjuryRecords creates the missing
        // record; that is why it runs first.
        block('no-injury-record')
        continue
      }

      const fromPath = norm(photo?.path)
      let toPath = ''
      if (fromPath) {
        toPath = movedStoragePath(fromPath, orgId)
        if (!toPath) { block('foreign-path'); continue }
      }

      // Rebuilt by REMOVAL, never by allow-list — the rule planMedicalStrip
      // records for the same reason. An allow-list would silently drop any field
      // added to a pointer after this was written, and dropping a field during a
      // migration is the data loss the ordering below exists to prevent.
      const doc = { ...photo }
      delete doc.id
      for (const f of DROPPED_FIELDS) delete doc[f]
      // A key holding undefined makes the Admin SDK reject the whole write, and
      // the write is what everything below is sequenced behind. Firestore never
      // hands one back, so this only bites on a hand-built row — but a migration
      // that dies on the first record because of a shape it did not expect is
      // exactly the failure the ordering exists to make impossible.
      for (const [k, v] of Object.entries(doc)) if (v === undefined) delete doc[k]
      doc.path = toPath
      // Both denormalised although the path already carries them, matching what
      // addMedicalRecord writes today: a purge or a retention sweep reads the
      // document, not the path it was found at.
      doc.incidentId = inc.id
      doc.personId = personId

      if (!isBlank(photo?.url)) urlsDropped += 1
      if (!fromPath) inlineRecords += 1
      const deletedInjury = !isBlank(injury?.deletedAt)
      if (deletedInjury) underDeletedInjury += 1

      all.push({
        ...row,
        personId,
        injuryId,
        doc,
        fromPath,
        toPath,
        // A pointer with no uploadedAt is invisible to the only reader there is:
        // subscribeMedicalRecords orders by it, and Firestore drops documents
        // missing the ordered field. index.js stamps one — a pure function
        // cannot mint a server timestamp — because a record sorted wrongly is
        // recoverable and a record on no screen is not.
        needsUploadedAt: photo?.uploadedAt == null,
        underDeletedInjury: deletedInjury,
      })
    }
  }

  const capped = all.length > cap
  const moves = capped ? all.slice(0, cap) : all

  return {
    photos,
    records,
    moves,
    capped,
    remaining: capped ? all.length - cap : 0,
    // Bytes still sitting under a prefix every member of the tenant can read.
    // Zero of these is what makes the storage rule mean anything for history.
    filesToMove: moves.filter((m) => m.toPath && m.toPath !== m.fromPath).length,
    inlineRecords,
    urlsDropped,
    underDeletedInjury,
    blocked,
    blockedReasons: blocked.reduce((acc, b) => ({ ...acc, [b.reason]: (acc[b.reason] || 0) + 1 }), {}),
  }
}

/**
 * Did the new pointer land intact?
 *
 * This predicate is the whole safety property of the migration. Nothing is
 * deleted until it has answered true against a document read back out of
 * Firestore, so a crash — or a rules refusal, or a bad minute in the network —
 * between the write and the delete leaves the record in BOTH places rather than
 * neither. Losing a medical record is worse than the exposure being closed.
 *
 * Compared as trimmed strings so a size stored as a number in one place and as
 * '4096' in the other is recognised as the same answer, exactly as preservedIn
 * does it for the clinical fields.
 */
export function landedIntact(expected = {}, actual = null) {
  if (!actual || typeof actual !== 'object') return false
  return VERIFIED_FIELDS.every((f) => {
    if (!(f in expected)) return true
    return norm(expected[f]) === norm(actual[f])
  })
}

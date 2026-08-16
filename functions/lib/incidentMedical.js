// ─────────────────────────────────────────────────────────────────────────────
// Removing medical detail from incident documents that already carry a copy.
//
// /injuries is gated on isManagerOf rather than isElevatedOf (firestore.rules)
// specifically to keep the external auditor out of colleagues' health records.
// That gate was decorative. The same detail was ALSO written onto the parent
// incident as injuryReports[], and /incidents falls through to the generic read
// — every approved member, plus the auditor. One getDocs on the incident
// collection returned bodyParts, injuryType, medication, firstAidDetail and
// daysToReturnToWork for every injured person in the tenant. That is ISO 27001
// audit MEDIUM-31, and the manager-only rule never touched it.
//
// Closing the write path closes nothing already stored, and what is already
// stored IS the exposure — every incident filed before the fix still answers
// that query. Same reasoning already recorded in firestore.rules for the
// visibility backfill: the data migration is a PREREQUISITE of the rules and UI
// change, not a tidy-up after it.
//
// The constraint that shapes everything below: /injuries is about to become the
// ONLY copy. A field removed from an incident whose injury record does not hold
// it is not confined, it is destroyed — and destroying an injury record is a
// worse outcome than the exposure being closed. So no field is removed until it
// is proved present in /injuries, field by field, and anything unproved is kept
// and reported for a human to resolve.
//
// Pure planning only. Nothing here reads or writes Firestore; index.js does
// that with what these functions decide, which is what makes the decision
// testable without a database, as qrMirrors.js does it.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The detail that belongs in /injuries and nowhere else.
 *
 * MUST match MEDICAL_FIELDS in src/modules/incidents/lib/injuries.js, which is
 * what the app now scrubs incident writes against. functions/ deploys as its own
 * package and cannot import from src/, so this is a copy — the same seam, and
 * the same duty to stay in step, as REGION here and FUNCTIONS_REGION there.
 *
 * What deliberately stays on the incident: `personId` (the join key — the
 * injury doc is keyed `${incidentId}__${personId}`), `personName` (already on
 * the incident as affectedPersonnel[].name, so keeping it exposes nothing new
 * and saves the printable report a second lookup) and `firstAidDone`.
 *
 * recordFileIds is on the list although nothing anywhere ever populates it —
 * injuryPayload reads report.recordFileIds and no writer sets it. Removing it
 * here keeps a dead field from being carried into the new shape; because it is
 * always empty it is always removable without proof.
 */
export const MEDICAL_FIELDS = [
  'bodyParts',
  'injuryType',
  'medication',
  'firstAidDetail',
  'daysToReturnToWork',
  'recordFileIds',
]

/**
 * Where the second copy lives.
 *
 * MUST stay identical to injuryId() in src/modules/incidents/lib/injuries.js.
 * The migration and the app have to agree on this string or the proof below
 * looks up nothing, finds nothing, and blocks every record in the tenant —
 * failing safe, but doing no work.
 */
export const injuryDocId = (incidentId, personId) => `${incidentId}__${personId}`

const norm = (v) => String(v ?? '').trim()

/**
 * Nothing to lose: absent, blank, or a list of blanks.
 *
 * Explicitly NOT 0 — a daysToReturnToWork of 0 means the person returned the
 * same day, which is a real clinical answer and has to be proved present like
 * any other value.
 */
function isEmpty(v) {
  if (v == null) return true
  if (Array.isArray(v)) return v.every(isEmpty)
  return String(v).trim() === ''
}

/** Any value as a list of normalised, non-blank strings. */
const asList = (v) => (Array.isArray(v) ? v : [v]).map(norm).filter((s) => s !== '')

/**
 * Does the injury record hold what the incident's copy holds?
 *
 * Containment, not equality: if /injuries lists MORE body parts than the
 * incident does, nothing is lost by removing the incident's shorter list.
 *
 * Compared as trimmed strings so that a 5 stored as a number in one place and
 * as the string '5' in the other is recognised as the same answer — the seed
 * writes a number and injuryPayload passes it straight through, so the two
 * copies of one value legitimately differ in type.
 *
 * Case-sensitive and not fuzzy on purpose. Every comparison this cannot make
 * with confidence has to fail towards keeping the data.
 *
 * @returns 'preserved' | 'missing' | 'differs'
 */
export function preservedIn(incidentValue, injuryValue) {
  if (isEmpty(injuryValue)) return 'missing'
  const have = new Set(asList(injuryValue))
  return asList(incidentValue).every((s) => have.has(s)) ? 'preserved' : 'differs'
}

/**
 * Decide what to remove from each incident.
 *
 * @param incidents [{ id, refNo, injuryReports }] every incident in ONE org
 * @param injuries  Map<injuryDocId, data|null> the /injuries doc, or null
 *
 * Per FIELD, not per record: a person whose bodyParts are safely mirrored but
 * whose medication is not gets the bodyParts removed and the medication kept
 * and reported. All-or-nothing would leave five proved-safe fields exposed
 * because of one unproved sixth, and the exposure is what this exists to close.
 *
 * An entry with no personId cannot be joined to anything — the portal's own
 * report path writes { name, uid, injuryType, bodyParts } and never calls
 * syncIncidentInjuries, so for those the incident is the ONLY copy that has
 * ever existed. They are reported and never touched. Removing those fields
 * would not confine the data, it would delete the injury.
 */
export function planMedicalStrip(incidents = [], injuries = new Map()) {
  const writes = []
  const blocked = []
  let alreadyClean = 0
  let stillExposed = 0
  let confined = 0
  let emptied = 0

  for (const inc of incidents) {
    const reports = Array.isArray(inc?.injuryReports) ? inc.injuryReports : null
    if (!reports || reports.length === 0) {
      alreadyClean += 1
      continue
    }

    let incidentConfined = 0
    let incidentEmptied = 0
    let incidentHeld = 0

    const next = reports.map((report) => {
      // A null or non-object element is somebody else's defect. Rebuild nothing
      // and lose nothing.
      if (!report || typeof report !== 'object') return report

      // Rebuilt by REMOVAL, never by allow-list. An allow-list would silently
      // drop any field added to this shape after this migration was written,
      // which is the same class of data loss the whole function guards against.
      const entry = { ...report }
      const personId = norm(entry.personId)
      const injury = personId ? injuries.get(injuryDocId(inc.id, personId)) : null
      const held = new Map() // reason -> [field]

      for (const field of MEDICAL_FIELDS) {
        if (!(field in entry)) continue

        // Holds nothing, so there is nothing to prove and nothing to lose.
        if (isEmpty(entry[field])) {
          delete entry[field]
          incidentEmptied += 1
          continue
        }

        const hold = (reason) => held.set(reason, [...(held.get(reason) || []), field])

        if (!personId) {
          hold('no-person-id')
        } else if (injury == null) {
          hold('no-injury-record')
        } else if (!isEmpty(injury.deletedAt)) {
          // The injury record is in the Recycle Bin: subscribeInjuries filters
          // it out, so it appears on no screen in the product. Nothing purges
          // /injuries yet (audit MEDIUM-33), but leaning on a soft-deleted
          // document as the sole surviving copy is exactly the cascade that
          // fix is going to add.
          hold('injury-record-deleted')
        } else {
          const verdict = preservedIn(entry[field], injury[field])
          if (verdict === 'preserved') {
            delete entry[field]
            incidentConfined += 1
          } else {
            hold(verdict === 'missing' ? 'missing-in-injury' : 'differs-in-injury')
          }
        }
      }

      for (const [reason, fields] of held) {
        incidentHeld += fields.length
        blocked.push({
          incidentId: inc.id,
          refNo: norm(inc.refNo) || inc.id,
          personId,
          // The portal writes `name` where the wizard writes `personName`;
          // without the fallback its rows — the ones that matter most, having
          // no other copy — arrive unidentifiable.
          personName: norm(entry.personName) || norm(entry.name),
          reason,
          // FIELD NAMES ONLY, never values. A report that quoted the medication
          // it declined to move would be one more copy of the thing being
          // confined, in a function response and in whatever logs it.
          fields,
        })
      }

      return entry
    })

    // An incident that still holds one unproved value is NOT clean, whether it
    // got a partial write or no write at all. Counting those as clean would
    // report the exposure closed while it is still open, which is the one thing
    // a migration report must never do.
    if (incidentHeld > 0) stillExposed += 1
    else if (incidentConfined + incidentEmptied === 0) alreadyClean += 1

    if (incidentConfined + incidentEmptied === 0) continue

    confined += incidentConfined
    emptied += incidentEmptied
    writes.push({
      id: inc.id,
      refNo: norm(inc.refNo) || inc.id,
      patch: { injuryReports: next },
      confined: incidentConfined,
      emptied: incidentEmptied,
    })
  }

  return {
    writes,
    alreadyClean,
    // Incidents that will STILL carry medical detail after this run — the
    // number that says whether the rules and UI change can safely ship.
    stillExposed,
    confined,
    emptied,
    blocked,
    blockedFields: blocked.reduce((n, b) => n + b.fields.length, 0),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Seeding: putting the detail INTO /injuries, so the strip above has something
// to prove against.
//
// planMedicalStrip refuses to remove a field it cannot first find in the
// matching injury record, and on production data that guard fired with an
// injury document already in place:
//
//   incidents: 1  injuries: 1  toWrite: 0  blocked: 1  stillExposed: 1
//
// A record existing is not the same as a record being COMPLETE. The strip
// proves field by field, so a row whose injury document holds nothing (or holds
// only some of it) is held under `no-injury-record` or `missing-in-injury` — and
// no number of re-runs will ever change that, because the strip only ever
// deletes. Nothing in the product fills the gap either: syncIncidentInjuries is
// the sole writer of clinical detail and it runs from the wizard's own form, not
// from what is already stored, which is why index.js records that the strip
// "cannot be done by re-syncing".
//
// So the detail has to be copied out of the incident and into /injuries first.
// That is a WRITE OF MEDICAL DATA, and it is deliberately NOT folded into the
// strip:
//
//   · It is a separate plan and a separate callable, so an admin can seed,
//     open the Injuries page, read what landed, and only then strip. One
//     button doing both would make the copy unreviewable — it would exist for
//     the few milliseconds before the original was deleted.
//   · It never counts towards the strip's `confined`. `confined` means "proved
//     already present in /injuries, then removed"; detail this migration put
//     there itself has not been proved by anything, it has been asserted. The
//     seed run's own `seeded` count is the record of that assertion.
//
// Gap-fill only, in both directions of the word: it writes a field only where
// /injuries has no answer at all, and it writes nothing else. /injuries is the
// system of record and the incident copy is the stale duplicate; where the two
// disagree the duplicate does not win, a human does.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A new /injuries document, built from the incident's own data.
 *
 * MUST stay in step with injuryPayload() in
 * src/modules/incidents/lib/injuries.js. The Injuries page reads these exact
 * keys, and a document written with only the clinical half renders a row with a
 * blank person, blank date and blank reference — a medical record nobody can
 * place. That is why index.js reads incidentDate/type/severity/location off the
 * incident at all; the strip never needed them.
 *
 * Two omissions, both load-bearing:
 *
 * `status` is absent, so injuryStatus() reads it as pending. Seeding is a
 * machine copying a field, not a person reviewing a clinical record, and
 * stamping it verified would forge exactly the sign-off /injuries exists to
 * carry.
 *
 * `updatedAt` is absent because a pure function cannot mint a server timestamp.
 * index.js adds it, and must: subscribeInjuries orders by updatedAt, and
 * Firestore drops documents missing the ordered field — a seeded record without
 * one would be a medical record that appears on no screen in the product.
 */
function seedPayload(inc, entry, personId) {
  return {
    incidentId: inc.id,
    incidentRefNo: norm(inc.refNo),
    personId,
    // The portal wrote `name` where the wizard writes `personName`. Same
    // fallback as the blocked rows above, for the same reason: without it the
    // record names nobody.
    personName: norm(entry.personName) || norm(entry.name),
    firstAidDone: Boolean(entry.firstAidDone),
    firstAidDetail: entry.firstAidDetail || '',
    bodyParts: entry.bodyParts || [],
    injuryType: entry.injuryType || '',
    medication: entry.medication || '',
    // ?? not ||, so a same-day return (0) survives as 0 rather than becoming ''.
    daysToReturnToWork: entry.daysToReturnToWork ?? '',
    recordFileIds: entry.recordFileIds || [],
    incidentDate: inc.incidentDate || '',
    incidentType: inc.type || '',
    severity: inc.severity || '',
    location: inc.location || '',
    deletedAt: null,
  }
}

/**
 * Decide what to write into /injuries so the strip can proceed.
 *
 * @param incidents [{ id, refNo, incidentDate, type, severity, location, injuryReports }]
 * @param injuries  Map<injuryDocId, data|null> the /injuries doc, or null
 *
 * Repairs exactly the two holds that ARE repairable from the incident's own
 * data, and nothing else:
 *
 *   no-injury-record  → create the document at `${incidentId}__${personId}`
 *   missing-in-injury → fill only the fields /injuries has no answer for
 *
 * Everything else is reported for a human, because every alternative is a
 * write this code has no business making:
 *
 *   no-person-id           the doc id is built from the person, so there is no
 *                          id to write to. A name-derived key collides the
 *                          moment two people share a name and joins to nothing
 *                          in the product — and this is a named colleague's
 *                          medical record, not a lookup row.
 *   sign-in-id-only        the legacy portal shape { name, uid, ... }. `uid` is
 *                          the same identity the fixed portal now writes as
 *                          personId, so the key is guessable — which is exactly
 *                          why it is reported instead. Promoting a sign-in id
 *                          to a person id is an identity decision, and it is
 *                          one edit for an admin who can see the incident.
 *   injury-record-verified both app writers decline to touch a verified record
 *                          (syncIncidentInjuries and updateInjury). Adding
 *                          unreviewed fields underneath somebody's sign-off
 *                          would make the sign-off cover data nobody signed off.
 *   injury-record-deleted  writing into a soft-deleted record makes a Recycle
 *                          Bin document the sole surviving copy, and clearing
 *                          deletedAt un-deletes what a human deleted.
 *   differs-in-injury      two copies disagree and only a human knows which is
 *                          right. Overwriting /injuries would destroy the value
 *                          a manager corrected on the Injuries page.
 */
export function planInjurySeed(incidents = [], injuries = new Map()) {
  const writes = []
  const blocked = []
  // docId -> the write being assembled for it, plus the values that document
  // will hold once it lands. Two rows naming one person in one incident are a
  // defect in their own right, but they must not produce two conflicting writes
  // to one document in one batch — the second row is judged against what the
  // first one already planned, so it either agrees or is reported.
  const byDoc = new Map()
  const claimed = new Set()
  const scanned = new Set()
  let alreadyHeld = 0
  let alreadyComplete = 0

  for (const inc of incidents) {
    const reports = Array.isArray(inc?.injuryReports) ? inc.injuryReports : null
    if (!reports || reports.length === 0) continue
    scanned.add(inc.id)

    const refNo = norm(inc.refNo) || inc.id

    for (const report of reports) {
      // A null or non-object element is somebody else's defect. Read nothing
      // out of it and invent nothing to replace it.
      if (!report || typeof report !== 'object') continue

      const personId = norm(report.personId)
      const personName = norm(report.personName) || norm(report.name)
      const hold = (reason, fields, extra) =>
        blocked.push({ incidentId: inc.id, refNo, personId, personName, reason, fields, ...extra })

      // Only what the incident actually exposes. A field that is absent, or
      // present and blank, is not medical detail in need of a home — the strip
      // drops those with no proof required — so seeding them would write blanks
      // into the system of record and call it work done.
      const present = MEDICAL_FIELDS.filter((f) => f in report && !isEmpty(report[f]))
      if (present.length === 0) { alreadyComplete += 1; continue }

      if (!personId) {
        hold(norm(report.uid) ? 'sign-in-id-only' : 'no-person-id', present)
        continue
      }

      const id = injuryDocId(inc.id, personId)
      claimed.add(id)

      let state = byDoc.get(id)
      if (!state) {
        const doc = injuries.get(id)
        if (doc != null && !isEmpty(doc.deletedAt)) { hold('injury-record-deleted', present); continue }
        // Anything that is not the string 'verified' is pending, matching
        // injuryStatus() in the app. A record with no status at all — every
        // record this job creates — is pending.
        if (doc != null && norm(doc.status) === 'verified') { hold('injury-record-verified', present); continue }
        state = { create: doc == null, held: doc ? { ...doc } : {}, row: null }
        byDoc.set(id, state)
      }

      const fill = []
      const differ = []
      for (const field of present) {
        // The SAME comparison the strip will make afterwards. Deciding what to
        // seed with anything else would let the two drift, and a seed that does
        // not satisfy the strip's proof is a copy of a medical record made for
        // no reason at all.
        const verdict = preservedIn(report[field], state.held[field])
        if (verdict === 'preserved') { alreadyHeld += 1; continue }
        if (verdict === 'differs') { differ.push(field); continue }
        // 'missing': /injuries has no answer here, so writing one takes nothing
        // away. This is the only case that writes.
        fill.push(field)
        state.held[field] = report[field]
      }

      if (differ.length) hold('differs-in-injury', differ)
      if (fill.length === 0) {
        if (differ.length === 0) alreadyComplete += 1
        continue
      }

      if (state.row) {
        state.row.fields.push(...fill)
        for (const f of fill) state.row.patch[f] = report[f]
        continue
      }

      state.row = {
        id,
        incidentId: inc.id,
        refNo,
        personId,
        personName,
        create: state.create,
        // A new document gets the whole shape, defaulted, because nothing is
        // being overwritten and a half-built record is unreadable. An existing
        // one gets ONLY the gaps: /injuries is the system of record, and this
        // job's licence extends to filling silence, never to correcting an
        // answer.
        patch: state.create
          ? seedPayload(inc, report, personId)
          : Object.fromEntries(fill.map((f) => [f, report[f]])),
        // FIELD NAMES ONLY, never values — the same rule the blocked rows
        // follow. A report that quoted the medication it copied would be one
        // more copy of the thing being confined.
        fields: [...fill],
      }
      writes.push(state.row)
    }
  }

  // An injury document for an incident that HAS rows, which none of those rows
  // names. Almost always a key mismatch: the wizard keys on affectedPersonnel.id
  // and the portal keyed on the auth uid, so one person can end up with a record
  // under one id and a row under another — which is how a run reports
  // `injuries: 1` and `blocked: 1` at the same time and looks contradictory.
  //
  // Reported, never reconciled. Merging a row into a document keyed to a
  // different person writes one colleague's clinical detail into another's
  // record, which is the same refusal planQrBackfill makes for a mirror naming
  // another tenant.
  //
  // Incidents with no rows at all are deliberately out of scope: a record whose
  // person was removed from the incident is a normal outcome (syncIncidentInjuries
  // keeps verified ones on purpose) and would drown the signal.
  const orphanInjuries = []
  for (const [id, doc] of injuries) {
    if (!doc || claimed.has(id)) continue
    if (!scanned.has(norm(doc.incidentId))) continue
    if (!isEmpty(doc.deletedAt)) continue
    orphanInjuries.push({ injuryId: id, incidentId: norm(doc.incidentId), personId: norm(doc.personId) })
  }

  return {
    writes,
    // Split because they are different acts. `created` is a medical record that
    // did not exist until this run; `completed` is one that did, gaining the
    // answers it was missing.
    created: writes.filter((w) => w.create).length,
    completed: writes.filter((w) => !w.create).length,
    // Fields this run would COPY. Never added to the strip's `confined`, which
    // claims proof this has not got.
    seeded: writes.reduce((n, w) => n + w.fields.length, 0),
    // Fields already in /injuries — the strip can take these today.
    alreadyHeld,
    alreadyComplete,
    blocked,
    blockedFields: blocked.reduce((n, b) => n + b.fields.length, 0),
    orphanInjuries,
  }
}

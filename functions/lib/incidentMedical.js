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

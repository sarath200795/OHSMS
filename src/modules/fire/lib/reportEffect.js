// ─────────────────────────────────────────────────────────────────────────────
// What approving a report does to the extinguisher it names.
//
// Pure and separate, because the transaction that applies it has to compute the
// change from the state it just READ rather than from a copy the caller was
// holding — and that was the defect. approveReport used to getExtinguisher(),
// build a Set of physicalDefects, and write the whole array back. Two approvers
// clearing the pending queue — the normal way that screen is used — each read
// the same array and each wrote their own version, so one reported fault was
// silently dropped and `status` might never flip to TO_BE_REFILLED.
//
// arrayUnion() would fix the array on its own but not the rest: the caller
// derives the QR mirror payload and the stats delta from a locally merged
// object, and a sentinel passed through those would poison both. So the merge
// stays a plain object and the freshness comes from the transaction.
// ─────────────────────────────────────────────────────────────────────────────
import { STATUS, REFILL_DEFECT_KEYS } from './constants'

/**
 * The fields to write on `ext` for an approved `report`.
 *
 * @param ext    the extinguisher AS JUST READ, not as the screen last saw it
 * @param report the report being approved
 * @returns a plain updates object — possibly empty, never a sentinel
 */
export function reportEffect(ext, report) {
  const updates = {}
  if (!ext || !report) return updates

  if (report.kind === 'defect' && report.defectType) {
    // A Set over the JUST-READ array, so a defect another approver added a
    // moment ago is in it and survives.
    const defects = new Set(ext.physicalDefects || [])
    defects.add(report.defectType)
    updates.physicalDefects = Array.from(defects)
    // A closed unit has been refilled and is back in service; sending it to
    // TO_BE_REFILLED again on a defect approved late would put a working
    // extinguisher back in the refill queue.
    if (REFILL_DEFECT_KEYS.includes(report.defectType) && ext.status !== STATUS.CLOSED) {
      updates.status = STATUS.TO_BE_REFILLED
    }
  } else if (report.kind === 'status_change' && report.newStatus) {
    updates.status = report.newStatus
  }

  return updates
}

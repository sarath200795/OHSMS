// ─────────────────────────────────────────────────────────────────────────────
// One open report per defect, per extinguisher.
//
// The same discharged extinguisher gets scanned by five people on the same
// shift. Without this, that is five identical pending reports for an approver
// to work through, and five rows in the defect log for one physical fault.
//
// A defect type is locked for a unit from the moment it is reported until it is
// actually closed — which is not the same as approved. Approval is what makes
// the defect real; closing is refilling the unit or resolving the fault. So the
// lock spans both states, and only a rejection or a genuine close reopens it.
//
// The lock is also a document, `defectLocks/{extId}__{defectType}`. That exists
// for the QR page: a passer-by reporting a fault is not signed in and cannot be
// allowed to read the org's reports, so the client cannot check for a duplicate
// before submitting. Creating a document that already exists fails on its own,
// with no read permission needed anywhere — the write is the check.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deterministic lock id. Firestore ids may not contain `/`, and a defect key or
 * an extinguisher id could in principle carry one, so both sides are escaped
 * rather than trusted.
 */
export function lockId(extId, defectType) {
  return `${esc(extId)}__${esc(defectType)}`
}

const esc = (v) => String(v ?? '').replace(/\//g, '_')

/** Reasons a defect cannot be reported again right now. */
export const LOCK_REASON = {
  pending: 'Already reported — waiting for approval',
  open: 'Already open on this unit — close it first',
}

/**
 * Which defect types are currently locked for `ext`, and why.
 *
 * `reports` may be omitted where the caller cannot read them (the public QR
 * page); the open-defect half of the rule still applies, and the lock document
 * catches the pending half at submit time.
 *
 * @returns Map<defectType, { reason: 'pending'|'open', label, since }>
 */
export function lockedDefects(ext, reports = []) {
  const locked = new Map()
  if (!ext) return locked
  const extId = ext.extId || ext.id

  // Approved and not yet closed. This is the stronger reason, so it is applied
  // last and wins where both are true.
  for (const key of ext.physicalDefects || []) {
    locked.set(key, { reason: 'open', label: LOCK_REASON.open, since: null })
  }

  for (const r of reports) {
    if (r.kind !== 'defect') continue
    if (r.approvalStatus !== 'pending') continue
    if ((r.extId || '') !== extId) continue
    if (!r.defectType) continue
    if (locked.has(r.defectType)) continue // 'open' is the more useful message
    locked.set(r.defectType, { reason: 'pending', label: LOCK_REASON.pending, since: r.reportedAt || null })
  }

  return locked
}

/**
 * The error a duplicate submission produces.
 *
 * Firestore reports a rejected create as `permission-denied`, which is the same
 * code an unauthorised write gives. That ambiguity is acceptable here because
 * the lock is created in the same batch as the report: if the batch fails and
 * the reporter was allowed to report at all, a duplicate is overwhelmingly the
 * reason. The message says what to do about it either way.
 */
export function duplicateDefectMessage(defectLabel) {
  // Hedged on purpose. The caller reaches here on ANY permission-denied, and a
  // duplicate is only the most likely cause — an expired QR code or a rules
  // change produces the identical error, and the client cannot tell them apart
  // because a public reporter is not allowed to read the report queue.
  //
  // Stating "already under progress" as fact is the dangerous reading: someone
  // standing in front of a discharged extinguisher is told it is handled, and
  // walks away. So say what is probable, then give them the way out.
  return (
    `${defectLabel} looks like it has already been reported for this unit, so it was not logged again. ` +
    `If nobody is dealing with it, tell your safety team directly — do not rely on this report.`
  )
}

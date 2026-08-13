// Procedure lifecycle status.
export const PROCEDURE_STATUS = {
  DRAFT: 'draft',
  PENDING_APPROVAL: 'pending_approval',
  APPROVED: 'approved',
  REJECTED: 'rejected',
}

export const PROCEDURE_STATUS_META = {
  [PROCEDURE_STATUS.DRAFT]: {
    label: 'Draft',
    accent: 'border-steel-600 bg-steel-800 text-steel-300',
  },
  [PROCEDURE_STATUS.PENDING_APPROVAL]: {
    label: 'Pending approval',
    accent: 'border-amber-300 bg-amber-100 text-amber-800',
  },
  [PROCEDURE_STATUS.APPROVED]: {
    label: 'Approved',
    accent: 'border-safe/40 bg-safe/15 text-safe',
  },
  [PROCEDURE_STATUS.REJECTED]: {
    label: 'Rejected',
    accent: 'border-danger/40 bg-danger/15 text-danger',
  },
}

// Aggregate lock state across a procedure's isolation points.
export const LOCK_STATUS = {
  UNLOCKED: 'unlocked',
  PARTIAL: 'partial',
  LOCKED: 'locked',
}

export const LOCK_STATUS_META = {
  [LOCK_STATUS.UNLOCKED]: {
    label: 'Unlocked',
    accent: 'border-steel-600 bg-steel-800 text-steel-300',
  },
  [LOCK_STATUS.PARTIAL]: {
    label: 'Partially locked',
    accent: 'border-amber-300 bg-amber-100 text-amber-800',
  },
  [LOCK_STATUS.LOCKED]: {
    label: 'Equipment locked',
    accent: 'border-danger/40 bg-danger/15 text-danger',
  },
}

/**
 * Compute aggregate lock summary from isolation points. An active group lock
 * (technicians still holding their locks) keeps the equipment "Equipment locked"
 * even if individual point locks have been swapped/removed.
 */
export function computeLockSummary(isolationPoints = [], groupLock = null) {
  const total = isolationPoints.length
  const lockedCount = isolationPoints.filter((p) => p.lockState?.locked).length
  const groupActive = Boolean(groupLock?.active && (groupLock.members?.length || 0) > 0)
  let status = LOCK_STATUS.UNLOCKED
  if (lockedCount > 0 && lockedCount < total) status = LOCK_STATUS.PARTIAL
  else if (total > 0 && lockedCount === total) status = LOCK_STATUS.LOCKED
  if (groupActive) status = LOCK_STATUS.LOCKED
  return { total, lockedCount, status, groupActive }
}

/**
 * Carry a live lockout across a revision.
 *
 * A revision replaces the isolation points wholesale with what the editor form
 * submitted, and those points carry no lockState — the form never had one. So
 * revising a procedure while its equipment was locked used to erase the record
 * of the locks while the physical padlocks stayed on the machine, which is the
 * worst direction for this to be wrong in: the system says safe, the equipment
 * is not.
 *
 * Matching is by `key`, the stable id each point has carried since points were
 * introduced. A point the revision DELETES cannot carry its lock anywhere, so
 * those are reported rather than silently dropped — the caller refuses the
 * revision, because deleting a locked point is someone editing away a lockout
 * that people are working behind.
 *
 * Returns { points, droppedLocked } — pure, so the decision is the caller's and
 * both halves are testable without a database.
 */
export function mergeRevisedPoints(incoming = [], current = []) {
  const byKey = new Map((current || []).filter((p) => p?.key).map((p) => [p.key, p]))
  const seen = new Set()

  const points = (incoming || []).map((p) => {
    if (!p?.key) return p
    seen.add(p.key)
    const was = byKey.get(p.key)
    // Only fill in what the form could not know. An incoming point that
    // already carries lockState is deliberate and is left alone.
    if (!was?.lockState || p.lockState) return p
    return { ...p, lockState: was.lockState }
  })

  const droppedLocked = (current || [])
    .filter((p) => p?.key && p.lockState?.locked && !seen.has(p.key))
    .map((p) => p.pointId || p.key)

  return { points, droppedLocked }
}

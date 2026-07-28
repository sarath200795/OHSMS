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

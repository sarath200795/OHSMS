// ─────────────────────────────────────────────────────────────────────────────
// Which defect locks no longer describe anything.
//
// A lock — defectLocks/{extId}__{defectType} — exists so five people scanning
// the same discharged extinguisher on one shift file one report rather than
// five. It is meant to live exactly as long as the fault does.
//
// It outlived the fault whenever a defect was resolved from the Action Tracker,
// which removed it from the unit without releasing the lock. That path is fixed,
// but the locks it already left behind are still there, and nothing in the app
// can reach them: the defect is gone from the extinguisher, so there is nothing
// left to resolve. The next person to scan that unit for that fault is told it
// has already been reported — permanently.
//
// WHEN A LOCK IS LEGITIMATE. The lock spans two states, because approval is not
// the same as closure:
//   1. a report for that unit and defect is still awaiting approval, or
//   2. the defect is approved and still open on the extinguisher.
// Anything else is a lock describing a fault that no longer exists.
//
// Deliberately conservative: anything it cannot resolve is KEPT. Deleting a live
// lock re-opens the duplicate flood this mechanism exists to prevent, while
// keeping a stale one costs one more run of this job.
// ─────────────────────────────────────────────────────────────────────────────

const str = (v) => String(v ?? '').trim()

/** The key a lock and a defect agree on. */
export const lockKey = (extId, defectType) => `${str(extId)}__${str(defectType)}`

/**
 * Split locks into those that still describe a live fault and those that do not.
 *
 * @param locks         [{ id, extId, defectType }]
 * @param extinguishers [{ id, physicalDefects: [] , deletedAt }]
 * @param reports       [{ kind, extId, defectType, approvalStatus }]
 */
export function classifyLocks({ locks = [], extinguishers = [], reports = [] } = {}) {
  // Defects currently open on a unit — approved and not yet resolved.
  const openOnUnit = new Set()
  extinguishers.forEach((e) => {
    if (!e || e.deletedAt) return
    ;(Array.isArray(e.physicalDefects) ? e.physicalDefects : []).forEach((d) => {
      openOnUnit.add(lockKey(e.id, d))
    })
  })

  // Reports still waiting for a decision.
  const awaitingApproval = new Set()
  reports.forEach((r) => {
    if (!r || r.kind !== 'defect') return
    if (str(r.approvalStatus) !== 'pending') return
    awaitingApproval.add(lockKey(r.extId, r.defectType))
  })

  const orphaned = []
  const live = []

  locks.forEach((l) => {
    if (!l || !l.id) return
    const extId = str(l.extId)
    const defectType = str(l.defectType)

    // A lock whose own fields are missing cannot be matched against anything,
    // and a lock nobody can explain is not one to delete automatically.
    if (!extId || !defectType) {
      live.push({ ...l, reason: 'unreadable — kept for a human to look at' })
      return
    }

    const key = lockKey(extId, defectType)
    if (awaitingApproval.has(key)) {
      live.push({ ...l, reason: 'a report is still awaiting approval' })
    } else if (openOnUnit.has(key)) {
      live.push({ ...l, reason: 'the defect is still open on the unit' })
    } else {
      orphaned.push({ ...l, key })
    }
  })

  return { orphaned, live }
}

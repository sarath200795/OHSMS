// ─────────────────────────────────────────────────────────────────────────────
// What starting and returning a permit does to its procedure — as pure
// functions, so the part that decides whether equipment is isolated is testable
// without Firestore.
//
// Everything here produces VALUES. The transaction in services/permitActions.js
// writes them to the permit and the procedure in one commit, which is the only
// way the two can agree.
// ─────────────────────────────────────────────────────────────────────────────
import { computeLockSummary } from '../constants/procedures'
import { PERMIT_STATUS, RETURN_CHECKS, MIN_REASON_LENGTH } from '../constants/permits'
import { toMs } from './permitWindow'

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x))

/**
 * Everything that stops a permit starting, as readable sentences. Empty means
 * go. `permit` and `procedure` are the documents as just READ INSIDE the
 * transaction — never the copies on screen, which can be minutes old.
 */
export function startProblems({ permit, procedure, scans = {}, nowMs = Date.now() }) {
  const out = []
  if (!permit) return ['The permit no longer exists.']
  if (permit.status !== PERMIT_STATUS.APPROVED) {
    out.push(`This permit is ${permit.status}, not approved — it cannot be started.`)
  }
  if (!(toMs(permit.windowEnd) > nowMs)) out.push('The permit window has ended. Raise a new permit.')

  const keys = permit.pointKeys || []
  if (keys.length === 0) return out // a permit with nothing to isolate has nothing more to check

  const missingScan = keys.filter((k) => !scans[k])
  if (missingScan.length) {
    out.push(`Scan the tag on every isolation point first (${missingScan.length} still to scan).`)
  }

  if (!procedure) return [...out, 'The LOTO procedure no longer exists.']
  if (procedure.status !== 'approved') out.push('The procedure is no longer approved.')
  if ((procedure.revision ?? 0) !== (permit.procedureRevision ?? 0)) {
    out.push('The procedure was revised after this permit was raised. Raise a new permit.')
  }
  if (procedure.activePermit) {
    out.push(`This equipment is already isolated under permit ${procedure.activePermit.permitNo || procedure.activePermit.id}.`)
  }
  const points = procedure.isolationPoints || []
  if (!sameSet(points.map((p) => p.key), keys)) {
    out.push('The procedure’s isolation points no longer match this permit.')
  }
  const alreadyLocked = points.filter((p) => p.lockState?.locked)
  if (alreadyLocked.length) {
    out.push('Some isolation points are already locked. Clear them from Operations first.')
  }
  if (procedure.groupLock?.active) out.push('A group lockout is active on this equipment.')

  const locks = permit.locks || []
  if (keys.some((k) => !String(locks.find((l) => l.pointKey === k)?.lockNo ?? '').trim())) {
    out.push('Every isolation point needs a lock on the permit.')
  }
  if (keys.length > 1 && locks.some((l) => l.lockType !== 'department')) {
    out.push('Several isolation points need a Department lock on each one.')
  }
  return out
}

/**
 * The lockState a permit start writes onto each point, from the permit's lock
 * plan. Same shape setPointLock writes, so every screen that reads a point's
 * lock (operations, public mirror, PDF) shows it without knowing a permit was
 * involved.
 */
export function applyPermitLocks(procedure, permit, { user, atIso }) {
  const plan = new Map((permit.locks || []).map((l) => [l.pointKey, l]))
  const points = (procedure.isolationPoints || []).map((p) => {
    const l = plan.get(p.key)
    return {
      ...p,
      lockState: {
        locked: true,
        lockedBy: user.id,
        lockedByName: user.displayName,
        lockedAt: atIso,
        techId: l?.techId || null,
        techName: l?.techName || null,
        techLockNo: l?.lockNo || null,
        lockType: l?.lockType || null,
        unlockedBy: null,
        unlockedByName: null,
        unlockedAt: null,
      },
    }
  })
  const first = (permit.locks || [])[0]
  return {
    points,
    lockSummary: computeLockSummary(points, procedure.groupLock),
    primaryTech: procedure.primaryTech || (first
      ? { techId: first.techId || null, name: first.techName || null, lockNo: first.lockNo, lockType: first.lockType }
      : null),
  }
}

/** Lock numbers the permit will put on the equipment, for claiming. */
export const permitLockNos = (permit) => (permit.locks || []).map((l) => l.lockNo).filter(Boolean)

/** The checklist as the rules expect it: every item a boolean. */
export function checksFrom(ticked = {}) {
  return Object.fromEntries(RETURN_CHECKS.map((c) => [c.key, ticked[c.key] === true]))
}

export const allChecked = (ticked = {}) => RETURN_CHECKS.every((c) => ticked[c.key] === true)

/** Why a return cannot go ahead, or [] — `confirmed` is the per-lock confirmation set. */
export function returnProblems({ permit, procedure, ticked = {}, confirmed = [] }) {
  const out = []
  if (!permit) return ['The permit no longer exists.']
  if (permit.status !== PERMIT_STATUS.ACTIVE) out.push(`This permit is ${permit.status}, not active.`)
  if (!allChecked(ticked)) out.push('Tick every item of the pre-energise checklist.')
  const keys = permit.pointKeys || []
  const missing = keys.filter((k) => !confirmed.includes(k))
  if (missing.length) out.push(`Confirm each lock has been removed (${missing.length} still to confirm).`)
  out.push(...heldProblems({ permit, procedure }))
  return out
}

/** The procedure must still be held by THIS permit before it is released. */
export function heldProblems({ permit, procedure }) {
  if ((permit.pointKeys || []).length === 0) return []
  if (!procedure) return ['The LOTO procedure no longer exists.']
  if (procedure.activePermit?.id !== permit.id) {
    return ['The equipment is not held by this permit any more. Refresh and check Operations.']
  }
  return []
}

/** The reason/attestation an emergency removal needs. */
export function emergencyProblems({ permit, procedure, reason, attest = {} }) {
  const out = []
  if (!permit) return ['The permit no longer exists.']
  if (permit.status !== PERMIT_STATUS.ACTIVE) out.push(`This permit is ${permit.status}, not active.`)
  if (String(reason || '').trim().length < MIN_REASON_LENGTH) {
    out.push(`Give the reason for the emergency removal (at least ${MIN_REASON_LENGTH} characters).`)
  }
  if (!(attest.ownerUnavailable && attest.equipmentInspected && attest.ownerWillBeTold)) {
    out.push('Confirm every attestation.')
  }
  out.push(...heldProblems({ permit, procedure }))
  return out
}

/**
 * Every lock off the equipment. Mirrors setPointLock's unlock: the last lock
 * state is kept (who/what/when) with the unlock recorded beside it, and a fully
 * unlocked procedure drops its primary technician and group lock.
 */
export function releasePermitLocks(procedure, { user, atIso }) {
  const released = []
  const points = (procedure.isolationPoints || []).map((p) => {
    const prev = p.lockState || {}
    if (!prev.locked) return p
    if (prev.techLockNo) released.push(prev.techLockNo)
    return {
      ...p,
      lockState: {
        locked: false,
        lockedBy: prev.lockedBy || null,
        lockedByName: prev.lockedByName || null,
        lockedAt: prev.lockedAt || null,
        techId: prev.techId || null,
        techName: prev.techName || null,
        techLockNo: prev.techLockNo || null,
        lockType: prev.lockType || null,
        unlockedBy: user.id,
        unlockedByName: user.displayName,
        unlockedAt: atIso,
      },
    }
  })
  const groupLock = { active: false, method: null, members: [] }
  return {
    points,
    released,
    groupLock,
    lockSummary: computeLockSummary(points, groupLock),
  }
}

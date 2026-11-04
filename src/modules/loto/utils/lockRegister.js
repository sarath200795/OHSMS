// Lock register checks that do not need Firestore.
//
// An issued lock is on exactly one open permit. Out of service is not issued.
// Trace answers "who holds this lock, tag or equipment" from the same lists.

const OPEN = ['requested', 'approved', 'active']
const norm = (v) => String(v || '').trim().toLowerCase()

export function lockOnPermit(permit, lock) {
  const no = norm(lock?.lockNo)
  const tag = norm(lock?.tagNo)
  return (permit?.locks || []).some((l) => norm(l.lockNo) === no || (tag && norm(l.lockNo) === tag))
}

export function openPermitsForLock(lock, permits = []) {
  return (permits || []).filter((p) => OPEN.includes(p.status) && lockOnPermit(p, lock))
}

/** Every issued lock is on exactly one open permit, and every such permit lock is issued. */
export function lockIntegrity(locks = [], permits = []) {
  const problems = []
  for (const lock of locks) {
    const open = openPermitsForLock(lock, permits)
    const status = lock.serviceStatus || 'available'
    if (status === 'out_of_service' && open.length) {
      problems.push(`${lock.lockNo} is out of service but listed on ${open.map((p) => p.permitNo || p.id).join(', ')}`)
    }
    if (status === 'issued' && open.length !== 1) {
      problems.push(`${lock.lockNo} is issued but on ${open.length} open permit${open.length === 1 ? '' : 's'}`)
    }
    if (status === 'available' && open.some((p) => p.status === 'active')) {
      problems.push(`${lock.lockNo} is available but an active permit still lists it`)
    }
  }
  return problems
}

export function derivedUseCount(lock, permits = []) {
  return (permits || []).filter((p) => lockOnPermit(p, lock)).length
}

/**
 * One result for a typed or scanned query: a lock number, a tag number, or
 * equipment. `permits` should already be the ones the viewer can read.
 */
export function traceQuery(raw, { locks = [], permits = [] } = {}) {
  const q = norm(raw)
  if (!q) return { kind: 'empty' }
  const lock = locks.find((l) => norm(l.lockNo) === q || norm(l.tagNo) === q)
  if (lock) {
    const history = [...(permits || [])]
      .filter((p) => lockOnPermit(p, lock))
      .sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0))
    return {
      kind: 'lock',
      lock,
      now: openPermitsForLock(lock, permits),
      history,
      useCount: history.length,
    }
  }
  const equipment = (permits || []).filter((p) => norm(p.equipment) === q || norm(p.procedureCode) === q)
  if (equipment.length) {
    return { kind: 'equipment', equipment: equipment.sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0)) }
  }
  return { kind: 'none' }
}

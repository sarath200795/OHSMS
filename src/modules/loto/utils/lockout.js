import { numberIsolationPoints } from './codes'
import { pointDeviceKeys } from '../constants/energySources'

// Device hardware contributed by a group lockout, per the org's rules:
//  - Group LOTO Box: 1st additional tech => +2 padlocks + 1 box;
//                    each later tech    => +1 padlock.  (N members => N+1 padlocks, 1 box)
//  - Hasp:           1st additional tech => +1 hasp + 1 padlock;
//                    each later tech    => +1 padlock.  (N members => N padlocks, 1 hasp)
export function groupLockDevices(groupLock) {
  const res = {}
  const members = groupLock?.active ? groupLock.members || [] : []
  const n = members.length
  if (!n) return res
  if (groupLock.method === 'box') {
    res.safety_padlock = n + 1
    res.group_loto_box = 1
  } else if (groupLock.method === 'hasp') {
    res.hasp = 1
    res.safety_padlock = n
  }
  return res
}

/**
 * Set of lock numbers currently applied across the given procedures — locked
 * isolation points + active group-lock members. Used to keep a lock from being
 * selectable elsewhere until it is removed.
 */
export function collectInUseLockNos(procedures = []) {
  const set = new Set()
  procedures.forEach((p) => {
    ;(p.isolationPoints || []).forEach((pt) => {
      if (pt.lockState?.locked && pt.lockState.techLockNo) set.add(pt.lockState.techLockNo)
    })
    if (p.groupLock?.active) {
      ;(p.groupLock.members || []).forEach((m) => {
        // Hasp model: per-point map. Box model: single padlock on the box.
        Object.values(m.locks || {}).forEach((no) => no && set.add(no))
        if (m.boxLock) set.add(m.boxLock)
        if (m.lockNo) set.add(m.lockNo) // legacy single-lock members
      })
    }
  })
  return set
}

/**
 * Map of lock number → where it is currently applied, across all procedures:
 *   lockNo => { equipment, site, label, techName }
 * For locked isolation points `label` is the point id (E-1, M-2, …); for group
 * members it is "Group lock". First writer wins (a physical lock is in one place).
 */
export function collectLockUsage(procedures = []) {
  const map = new Map()
  procedures.forEach((p) => {
    const numbered = numberIsolationPoints(p.isolationPoints || [])
    numbered.forEach((pt) => {
      const no = pt.lockState?.techLockNo
      if (pt.lockState?.locked && no && !map.has(no)) {
        map.set(no, {
          equipment: p.equipment || '',
          site: p.site || '',
          label: pt.pointId || 'Point',
          techName: pt.lockState.techName || '',
        })
      }
    })
    if (p.groupLock?.active) {
      const byKey = {}
      numbered.forEach((pt) => {
        byKey[pt.key] = pt.pointId
      })
      ;(p.groupLock.members || []).forEach((m) => {
        // Hasp: per-point group locks.
        Object.entries(m.locks || {}).forEach(([key, no]) => {
          if (no && !map.has(no)) {
            map.set(no, {
              equipment: p.equipment || '',
              site: p.site || '',
              label: `${byKey[key] || 'Point'} · group`,
              techName: m.name || '',
            })
          }
        })
        // Box: single padlock on the group LOTO box.
        if (m.boxLock && !map.has(m.boxLock)) {
          map.set(m.boxLock, {
            equipment: p.equipment || '',
            site: p.site || '',
            label: 'Group box',
            techName: m.name || '',
          })
        }
        // Legacy single-lock member.
        if (m.lockNo && !map.has(m.lockNo)) {
          map.set(m.lockNo, {
            equipment: p.equipment || '',
            site: p.site || '',
            label: 'Group lock',
            techName: m.name || '',
          })
        }
      })
    }
  })
  return map
}

/**
 * Devices currently "in use" for a procedure: the isolation device on each
 * LOCKED point, plus group-lockout hardware. In the per-point model each group
 * technician applies one padlock per point; a point holding more than one lock
 * needs a hasp, and a Group LOTO Box adds one box. Returns { [deviceKey]: count }.
 */
export function lockoutDeviceTally(procedure) {
  const tally = {}
  ;(procedure.isolationPoints || []).forEach((p) => {
    if (p.lockState?.locked) {
      pointDeviceKeys(p).forEach((key) => {
        tally[key] = (tally[key] || 0) + 1
      })
    }
  })

  const group = procedure.groupLock
  if (group?.active && (group.members?.length || 0) > 0) {
    const members = group.members
    if (group.method === 'box') {
      // Box model: the point locks are already counted above. The group adds one
      // personal padlock per technician added to the box, plus the box itself.
      tally.safety_padlock = (tally.safety_padlock || 0) + members.length
      tally.group_loto_box = (tally.group_loto_box || 0) + 1
    } else {
      // Hasp model: each member adds a padlock per point; a point holding more
      // than one lock needs a hasp to stack them.
      const pointsWithGroup = new Set()
      let groupPadlocks = 0
      members.forEach((m) => {
        const entries = Object.entries(m.locks || {})
        if (entries.length) {
          entries.forEach(([key, no]) => {
            if (no) {
              groupPadlocks += 1
              pointsWithGroup.add(key)
            }
          })
        } else if (m.lockNo) {
          groupPadlocks += 1
        }
      })
      if (groupPadlocks) tally.safety_padlock = (tally.safety_padlock || 0) + groupPadlocks
      if (pointsWithGroup.size) tally.hasp = (tally.hasp || 0) + pointsWithGroup.size
    }
  }
  return tally
}

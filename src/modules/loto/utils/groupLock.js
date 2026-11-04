// Group lockout on a permit.
//
// The shape is hecp-loto's groupLock: method box or hasp, and one personal
// lock per member. The primary is members[0]. Everyone else comes off before
// the primary. The permit closes when the primary — the last lock — comes off.
// Device count matches lockout.js: one padlock per member, plus the box, or a
// hasp when more than one lock is stacked.

export function groupDeviceCount(groupLock) {
  const members = groupLock?.members || []
  if (!groupLock?.active || members.length === 0) return {}
  const tally = { safety_padlock: members.length }
  if (groupLock.method === 'box') tally.group_loto_box = 1
  else if (groupLock.method === 'hasp' && members.length > 1) tally.hasp = 1
  return tally
}

export function groupProblems(group, { personnelUids = [] } = {}) {
  if (!group) return []
  const errors = []
  if (group.method !== 'box' && group.method !== 'hasp') errors.push('Choose a group lock box or a hasp.')
  if (!/^[A-Za-z0-9-]{1,40}$/.test(String(group.groupNo || '').trim())) {
    errors.push('Choose a group lockout number.')
  }
  const members = Array.isArray(group.members) ? group.members : []
  if (members.length < 2) {
    errors.push('A group lockout needs at least two people, each with their own personal lock.')
  }
  const uids = members.map((m) => m?.uid).filter(Boolean)
  if (new Set(uids).size !== members.length) errors.push('Each person is on the group once.')
  const locks = members.map((m) => String(m?.lockNo || '').trim().toLowerCase())
  if (locks.some((n) => !n)) errors.push('Each member needs their own personal lock.')
  else if (new Set(locks).size !== locks.length) errors.push('Each member needs a different personal lock.')
  const allowed = new Set(personnelUids.filter(Boolean))
  if (members.some((m) => m?.uid && !allowed.has(m.uid))) {
    errors.push('Every group member must be named on the permit.')
  }
  if (!group.primaryUid || members[0]?.uid !== group.primaryUid) {
    errors.push('The primary is the first member and comes off last.')
  }
  return errors
}

/**
 * May this person take their lock off now?
 * `closes` means they are the primary and everyone else is already off, so
 * the permit closes with this removal.
 */
export function canRemoveOwnLock(group, removedUids = [], uid) {
  if (!group?.active) return { ok: false, reason: 'This permit has no group lockout.' }
  const members = group.members || []
  if (!members.some((m) => m.uid === uid)) return { ok: false, reason: 'You can only remove your own lock.' }
  if ((removedUids || []).includes(uid)) return { ok: false, reason: 'Your lock is already off.' }
  const others = members.filter((m) => m.uid !== group.primaryUid).map((m) => m.uid)
  if (uid === group.primaryUid && others.some((id) => !(removedUids || []).includes(id))) {
    return { ok: false, reason: 'Everyone else comes off before the primary lock.' }
  }
  const stillOn = members.filter((m) => m.uid !== uid && !(removedUids || []).includes(m.uid))
  return { ok: true, closes: stillOn.length === 0 }
}

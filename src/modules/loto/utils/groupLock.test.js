import { describe, expect, it } from 'vitest'
import { canRemoveOwnLock, groupDeviceCount, groupProblems } from './groupLock'

const group = {
  active: true,
  method: 'box',
  groupNo: 'GL-1',
  primaryUid: 'p',
  members: [
    { uid: 'p', name: 'Primary', lockNo: 'P-1' },
    { uid: 'a', name: 'Asha', lockNo: 'P-2' },
  ],
}

describe('groupDeviceCount', () => {
  it('counts one padlock per member and the box', () => {
    expect(groupDeviceCount(group)).toEqual({ safety_padlock: 2, group_loto_box: 1 })
  })
  it('counts a hasp when locks are stacked', () => {
    expect(groupDeviceCount({ ...group, method: 'hasp' })).toEqual({ safety_padlock: 2, hasp: 1 })
  })
})

describe('groupProblems', () => {
  it('accepts two named members with their own locks', () => {
    expect(groupProblems(group, { personnelUids: ['p', 'a'] })).toEqual([])
  })
  it('refuses a single member and a shared lock', () => {
    expect(groupProblems({ ...group, members: [group.members[0]] }, { personnelUids: ['p'] }).join(' ')).toMatch(/at least two/)
    const shared = { ...group, members: [group.members[0], { ...group.members[1], lockNo: 'P-1' }] }
    expect(groupProblems(shared, { personnelUids: ['p', 'a'] }).join(' ')).toMatch(/different/)
  })
})

describe('canRemoveOwnLock', () => {
  it('lets a member off and holds the primary until they are', () => {
    expect(canRemoveOwnLock(group, [], 'a')).toEqual({ ok: true, closes: false })
    expect(canRemoveOwnLock(group, [], 'p').ok).toBe(false)
    expect(canRemoveOwnLock(group, ['a'], 'p')).toEqual({ ok: true, closes: true })
  })
  it('refuses someone who is not on the group', () => {
    expect(canRemoveOwnLock(group, [], 'z').ok).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import { stampNewAssignees } from './stampAssignee.js'

const row = (id, ownerUid, extra = {}) => ({ id, ownerUid, description: 'Fix', ...extra })

describe('stampNewAssignees', () => {
  it('stamps a new owner and a changed owner', () => {
    const next = stampNewAssignees(
      [row('a1', 'u1', { assignedByUid: 'old' })],
      [row('a1', 'u2'), row('a2', 'u3')],
      'editor'
    )
    expect(next[0].assignedByUid).toBe('editor')
    expect(next[1].assignedByUid).toBe('editor')
  })

  it('leaves the original assigner in place when the owner did not change', () => {
    const next = stampNewAssignees(
      [row('a1', 'u1', { assignedByUid: 'original' })],
      [row('a1', 'u1', { assignedByUid: 'original', dueDate: '2026-12-01' })],
      'someone-else'
    )
    expect(next[0].assignedByUid).toBe('original')
  })

  it('does not mark a row that has no id', () => {
    const item = { ownerUid: 'u1', description: 'Fix' }
    expect(stampNewAssignees([], [item], 'editor')[0]).toEqual(item)
  })

  it('returns the array untouched when there is no actor', () => {
    const next = [row('a1', 'u1')]
    expect(stampNewAssignees([], next, '')).toBe(next)
    expect(stampNewAssignees([], next, null)).toBe(next)
  })
})

import { LOCK_STATUS, computeLockSummary, mergeRevisedPoints } from './procedures'

describe('computeLockSummary', () => {
  it('reports unlocked when no points are locked', () => {
    const s = computeLockSummary([{ lockState: { locked: false } }])
    expect(s.status).toBe(LOCK_STATUS.UNLOCKED)
    expect(s.lockedCount).toBe(0)
  })

  it('reports partial when some points are locked', () => {
    const s = computeLockSummary([
      { lockState: { locked: true } },
      { lockState: { locked: false } },
    ])
    expect(s.status).toBe(LOCK_STATUS.PARTIAL)
    expect(s.lockedCount).toBe(1)
    expect(s.total).toBe(2)
  })

  it('reports locked when all points are locked', () => {
    const s = computeLockSummary([{ lockState: { locked: true } }])
    expect(s.status).toBe(LOCK_STATUS.LOCKED)
  })

  it('an active group lock keeps the equipment locked even if points are not', () => {
    const s = computeLockSummary([{ lockState: { locked: false } }], {
      active: true,
      members: [{ techId: 't1' }],
    })
    expect(s.status).toBe(LOCK_STATUS.LOCKED)
    expect(s.groupActive).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Revising a procedure while its equipment is locked.
//
// The form that submits a revision has no lockState on its points — it never
// had one — so a naive replace erases the record of a lockout while the
// padlocks stay on the machine. That is the worst direction for this to fail
// in: the system reads safe, the equipment is not.
// ─────────────────────────────────────────────────────────────────────────────
describe('carrying a lockout across a revision', () => {
  const locked = { key: 'p1', pointId: 'E-1', lockState: { locked: true, techName: 'R. Osei' } }
  const open = { key: 'p2', pointId: 'M-1', lockState: { locked: false } }

  it('keeps the live lock on a point the revision edited', () => {
    const { points } = mergeRevisedPoints(
      [{ key: 'p1', pointId: 'E-1', isolationDetails: 'Reworded step' }],
      [locked],
    )
    expect(points[0].lockState).toEqual(locked.lockState)
    expect(points[0].isolationDetails).toBe('Reworded step')
  })

  it('leaves a genuinely new point unlocked', () => {
    const { points } = mergeRevisedPoints([{ key: 'new', pointId: 'H-1' }], [locked])
    expect(points[0].lockState).toBeUndefined()
  })

  it('does not overwrite a lockState the caller supplied deliberately', () => {
    const explicit = { locked: false, unlockedAt: 'now' }
    const { points } = mergeRevisedPoints([{ key: 'p1', lockState: explicit }], [locked])
    expect(points[0].lockState).toBe(explicit)
  })

  // Deleting a locked point is editing away a lockout people are working
  // behind. Reported, so the caller refuses the whole revision.
  it('reports a locked point the revision would delete', () => {
    const { droppedLocked } = mergeRevisedPoints([{ key: 'p2' }], [locked, open])
    expect(droppedLocked).toEqual(['E-1'])
  })

  it('says nothing about deleting a point that was not locked', () => {
    const { droppedLocked } = mergeRevisedPoints([{ key: 'p1' }], [locked, open])
    expect(droppedLocked).toEqual([])
  })

  it('copes with points that have no key, and with nothing at all', () => {
    expect(() => mergeRevisedPoints([{}], [{}])).not.toThrow()
    expect(mergeRevisedPoints()).toEqual({ points: [], droppedLocked: [] })
  })
})

// The other half of the same bug: the summary is what the public QR page and
// every dashboard read, and revise was the one writer that computed it as
// though an active group lockout had gone home.
describe('the summary a revision writes', () => {
  it('still reads LOCKED while a group lockout is active', () => {
    const group = { active: true, method: 'box', members: [{ techId: 't2', name: 'Sam' }] }
    const points = [{ key: 'p1', lockState: { locked: true } }]
    expect(computeLockSummary(points, group).status).toBe(LOCK_STATUS.LOCKED)
    // …and the shape the bug produced, for contrast: no group argument, so a
    // partially-locked set reads as merely partial.
    expect(computeLockSummary([...points, { key: 'p2' }]).status).toBe(LOCK_STATUS.PARTIAL)
    expect(computeLockSummary([...points, { key: 'p2' }], group).status).toBe(LOCK_STATUS.LOCKED)
  })
})

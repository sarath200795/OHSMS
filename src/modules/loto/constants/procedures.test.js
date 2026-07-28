import { LOCK_STATUS, computeLockSummary } from './procedures'

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

import { describe, it, expect } from 'vitest'
import { classifyLocks, lockKey } from './defectLocks.js'

const lock = (extId, defectType) => ({ id: lockKey(extId, defectType), extId, defectType })

describe('lockKey', () => {
  it('matches the id createReport writes', () => {
    expect(lockKey('ext1', 'empty')).toBe('ext1__empty')
  })

  it('tolerates padding on either side', () => {
    expect(lockKey(' ext1 ', ' empty ')).toBe('ext1__empty')
  })
})

describe('classifyLocks', () => {
  // The case this job exists for: the Action Tracker resolved the defect, so it
  // is gone from the unit and no report is pending — but the lock remains.
  it('finds a lock whose defect no longer exists anywhere', () => {
    const { orphaned, live } = classifyLocks({
      locks: [lock('ext1', 'empty')],
      extinguishers: [{ id: 'ext1', physicalDefects: [] }],
      reports: [{ kind: 'defect', extId: 'ext1', defectType: 'empty', approvalStatus: 'approved' }],
    })
    expect(orphaned.map((l) => l.id)).toEqual(['ext1__empty'])
    expect(live).toEqual([])
  })

  it('keeps a lock while its report is awaiting approval', () => {
    const { orphaned, live } = classifyLocks({
      locks: [lock('ext1', 'empty')],
      extinguishers: [{ id: 'ext1', physicalDefects: [] }],
      reports: [{ kind: 'defect', extId: 'ext1', defectType: 'empty', approvalStatus: 'pending' }],
    })
    expect(orphaned).toEqual([])
    expect(live[0].reason).toMatch(/awaiting approval/)
  })

  it('keeps a lock while the defect is still open on the unit', () => {
    const { orphaned, live } = classifyLocks({
      locks: [lock('ext1', 'empty')],
      extinguishers: [{ id: 'ext1', physicalDefects: ['empty', 'pin'] }],
      reports: [],
    })
    expect(orphaned).toEqual([])
    expect(live[0].reason).toMatch(/still open on the unit/)
  })

  // Approval is not closure — the lock has to span both, which is why a pending
  // report and an open defect are separate reasons to keep it.
  it('keeps it when approved and open, releases it once resolved', () => {
    const approvedAndOpen = classifyLocks({
      locks: [lock('ext1', 'empty')],
      extinguishers: [{ id: 'ext1', physicalDefects: ['empty'] }],
      reports: [{ kind: 'defect', extId: 'ext1', defectType: 'empty', approvalStatus: 'approved' }],
    })
    expect(approvedAndOpen.orphaned).toEqual([])

    const resolved = classifyLocks({
      locks: [lock('ext1', 'empty')],
      extinguishers: [{ id: 'ext1', physicalDefects: [] }],
      reports: [{ kind: 'defect', extId: 'ext1', defectType: 'empty', approvalStatus: 'approved' }],
    })
    expect(resolved.orphaned).toHaveLength(1)
  })

  it('does not let one unit release another unit lock', () => {
    const { orphaned } = classifyLocks({
      locks: [lock('ext1', 'empty')],
      extinguishers: [{ id: 'ext2', physicalDefects: ['empty'] }],
      reports: [],
    })
    expect(orphaned).toHaveLength(1)
  })

  it('does not let one defect type release another', () => {
    const { orphaned } = classifyLocks({
      locks: [lock('ext1', 'empty')],
      extinguishers: [{ id: 'ext1', physicalDefects: ['pin'] }],
      reports: [],
    })
    expect(orphaned).toHaveLength(1)
  })

  // A deleted extinguisher cannot hold a live defect, so its locks are orphans.
  it('treats a deleted unit defects as gone', () => {
    const { orphaned } = classifyLocks({
      locks: [lock('ext1', 'empty')],
      extinguishers: [{ id: 'ext1', physicalDefects: ['empty'], deletedAt: '2026-01-01' }],
      reports: [],
    })
    expect(orphaned).toHaveLength(1)
  })

  // Conservative on purpose: deleting a live lock re-opens the duplicate flood.
  it('keeps a lock it cannot read rather than guessing', () => {
    const { orphaned, live } = classifyLocks({
      locks: [{ id: 'weird', extId: '', defectType: '' }],
      extinguishers: [],
      reports: [],
    })
    expect(orphaned).toEqual([])
    expect(live[0].reason).toMatch(/unreadable/)
  })

  it('ignores non-defect reports when deciding', () => {
    const { orphaned } = classifyLocks({
      locks: [lock('ext1', 'empty')],
      extinguishers: [{ id: 'ext1', physicalDefects: [] }],
      reports: [{ kind: 'status_change', extId: 'ext1', defectType: 'empty', approvalStatus: 'pending' }],
    })
    expect(orphaned).toHaveLength(1)
  })

  it('copes with nothing at all', () => {
    expect(classifyLocks()).toEqual({ orphaned: [], live: [] })
    expect(classifyLocks({ locks: [] })).toEqual({ orphaned: [], live: [] })
  })
})

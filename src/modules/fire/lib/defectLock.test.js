import { describe, it, expect } from 'vitest'
import { lockId, lockedDefects, LOCK_REASON } from './defectLock'

const pending = (extId, defectType, extra = {}) => ({
  id: `r-${extId}-${defectType}`, kind: 'defect', approvalStatus: 'pending', extId, defectType, ...extra,
})

describe('lockId', () => {
  it('is stable for the same unit and defect', () => {
    expect(lockId('ext1', 'leakage')).toBe(lockId('ext1', 'leakage'))
  })

  it('separates units and defects', () => {
    expect(lockId('ext1', 'leakage')).not.toBe(lockId('ext2', 'leakage'))
    expect(lockId('ext1', 'leakage')).not.toBe(lockId('ext1', 'damaged_hose'))
  })

  it('never produces a slash, which Firestore would read as a path separator', () => {
    expect(lockId('a/b', 'c/d')).not.toContain('/')
  })

  it('does not collide across the escape', () => {
    expect(lockId('a/b', 'c')).not.toBe(lockId('a', 'b/c'))
  })
})

describe('lockedDefects', () => {
  it('locks a defect that is open on the unit', () => {
    const ext = { id: 'ext1', physicalDefects: ['leakage'] }
    const m = lockedDefects(ext, [])
    expect(m.get('leakage')).toMatchObject({ reason: 'open', label: LOCK_REASON.open })
  })

  it('locks a defect that has been reported but not yet approved', () => {
    const ext = { id: 'ext1', physicalDefects: [] }
    const m = lockedDefects(ext, [pending('ext1', 'leakage')])
    expect(m.get('leakage')).toMatchObject({ reason: 'pending', label: LOCK_REASON.pending })
  })

  it('leaves every other defect type reportable', () => {
    const ext = { id: 'ext1', physicalDefects: ['leakage'] }
    const m = lockedDefects(ext, [pending('ext1', 'damaged_hose')])
    expect(m.has('missing_seal')).toBe(false)
    expect(m.size).toBe(2)
  })

  it('reopens once the defect is closed on the unit', () => {
    // Closing is what clears physicalDefects; the approved report stays as history.
    const approved = { kind: 'defect', approvalStatus: 'approved', extId: 'ext1', defectType: 'leakage' }
    expect(lockedDefects({ id: 'ext1', physicalDefects: [] }, [approved]).has('leakage')).toBe(false)
  })

  it('reopens after a rejection', () => {
    const rejected = { kind: 'defect', approvalStatus: 'rejected', extId: 'ext1', defectType: 'leakage' }
    expect(lockedDefects({ id: 'ext1', physicalDefects: [] }, [rejected]).has('leakage')).toBe(false)
  })

  it('does not let one unit lock another', () => {
    const ext = { id: 'ext2', physicalDefects: [] }
    const m = lockedDefects(ext, [pending('ext1', 'leakage')])
    expect(m.size).toBe(0)
  })

  it('prefers the open reason when a defect is somehow both', () => {
    // An approver could approve one report while a second is still queued.
    const ext = { id: 'ext1', physicalDefects: ['leakage'] }
    const m = lockedDefects(ext, [pending('ext1', 'leakage')])
    expect(m.get('leakage').reason).toBe('open')
  })

  it('ignores status-change requests, which are not defects', () => {
    const ext = { id: 'ext1', physicalDefects: [] }
    const statusReq = { kind: 'status_change', approvalStatus: 'pending', extId: 'ext1', newStatus: 'closed' }
    expect(lockedDefects(ext, [statusReq]).size).toBe(0)
  })

  it('matches a unit addressed by extId as the QR page does', () => {
    const m = lockedDefects({ extId: 'ext1', physicalDefects: [] }, [pending('ext1', 'leakage')])
    expect(m.get('leakage').reason).toBe('pending')
  })

  it('still applies the open half when reports cannot be read at all', () => {
    // The public QR page has no read access to reports; it passes none.
    const m = lockedDefects({ extId: 'ext1', physicalDefects: ['leakage'] })
    expect(m.get('leakage').reason).toBe('open')
  })

  it('survives a unit with no defect array and no unit at all', () => {
    expect(lockedDefects({ id: 'ext1' }, []).size).toBe(0)
    expect(lockedDefects(null, [pending('ext1', 'leakage')]).size).toBe(0)
  })

  it('carries when a pending report was raised, so the UI can say since when', () => {
    const m = lockedDefects({ id: 'ext1' }, [pending('ext1', 'leakage', { reportedAt: '2026-08-01' })])
    expect(m.get('leakage').since).toBe('2026-08-01')
  })
})

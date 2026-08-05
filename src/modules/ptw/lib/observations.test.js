import { describe, it, expect } from 'vitest'
import { openUnsafeByPermit, isOpen, observationsForPermit } from './observations'
import { derivePermitStatus, STATUS, dashboardBuckets } from './permitStatus'

const scan = (over = {}) => ({
  permitId: 'p1', type: 'unsafe', approvalStatus: 'pending', source: 'qr', at: '2026-08-05T10:00:00.000Z', ...over,
})

const approvedPermit = (over = {}) => ({
  id: 'p1',
  engineering: { status: 'approved' },
  operations: { status: 'approved' },
  validTo: '2099-01-01T00:00:00.000Z',
  ...over,
})

describe('openUnsafeByPermit', () => {
  it('counts pending unsafe reports against their permit', () => {
    const m = openUnsafeByPermit([scan(), scan(), scan({ permitId: 'p2' })])
    expect(m.get('p1')).toBe(2)
    expect(m.get('p2')).toBe(1)
  })

  it('ignores safe observations — those are not a problem', () => {
    expect(openUnsafeByPermit([scan({ type: 'safe' })]).size).toBe(0)
  })

  it('ignores portal observations, which already closed the permit', () => {
    // A portal observation carries no approvalStatus; it acted at the time.
    expect(openUnsafeByPermit([scan({ approvalStatus: undefined, source: 'portal' })]).size).toBe(0)
  })

  it('stops counting once one has been dealt with', () => {
    expect(openUnsafeByPermit([scan({ approvalStatus: 'approved' })]).size).toBe(0)
    expect(openUnsafeByPermit([scan({ approvalStatus: 'rejected' })]).size).toBe(0)
  })

  it('drops an observation that names no permit rather than counting it', () => {
    expect(openUnsafeByPermit([scan({ permitId: '' }), scan({ permitId: undefined })]).size).toBe(0)
  })

  it('survives junk', () => {
    expect(openUnsafeByPermit().size).toBe(0)
    expect(openUnsafeByPermit([null, undefined, {}]).size).toBe(0)
  })
})

describe('isOpen', () => {
  it('is true only while pending', () => {
    expect(isOpen({ approvalStatus: 'pending' })).toBe(true)
    expect(isOpen({ approvalStatus: 'approved' })).toBe(false)
    expect(isOpen({})).toBe(false)
    expect(isOpen(null)).toBe(false)
  })
})

describe('observationsForPermit', () => {
  it('returns that permit only, newest first', () => {
    const list = [
      scan({ at: '2026-08-01T00:00:00.000Z', note: 'old' }),
      scan({ permitId: 'p2', note: 'other' }),
      scan({ at: '2026-08-04T00:00:00.000Z', note: 'new' }),
    ]
    expect(observationsForPermit(list, 'p1').map((o) => o.note)).toEqual(['new', 'old'])
  })

  it('handles a Firestore timestamp as readily as a string', () => {
    const ts = (ms) => ({ toMillis: () => ms })
    const list = [scan({ at: ts(1000), note: 'a' }), scan({ at: ts(9000), note: 'b' })]
    expect(observationsForPermit(list, 'p1').map((o) => o.note)).toEqual(['b', 'a'])
  })
})

describe('the flag reaches the permit status', () => {
  it('flags a live permit with an unanswered unsafe report', () => {
    const p = { ...approvedPermit(), openUnsafeCount: 1 }
    expect(derivePermitStatus(p)).toBe(STATUS.OPEN_WITH_OBSERVATIONS)
  })

  it('leaves a permit with none alone', () => {
    expect(derivePermitStatus({ ...approvedPermit(), openUnsafeCount: 0 })).toBe(STATUS.IN_PROGRESS)
    expect(derivePermitStatus(approvedPermit())).toBe(STATUS.IN_PROGRESS)
  })

  it('outranks the lifecycle states, including an expired window', () => {
    const expired = { ...approvedPermit({ validTo: '2020-01-01T00:00:00.000Z' }), openUnsafeCount: 1 }
    expect(derivePermitStatus(expired)).toBe(STATUS.OPEN_WITH_OBSERVATIONS)
    const draft = { id: 'p1', openUnsafeCount: 1 }
    expect(derivePermitStatus(draft)).toBe(STATUS.OPEN_WITH_OBSERVATIONS)
  })

  it('does not override a permit already closed for non-compliance', () => {
    // That decision has been taken; the flag would understate it.
    const p = { ...approvedPermit(), closedDueToObservation: { at: 'x' }, openUnsafeCount: 2 }
    expect(derivePermitStatus(p)).toBe(STATUS.CLOSED_NONCOMPLIANCE)
  })

  it('does not reopen a closed permit', () => {
    const p = {
      ...approvedPermit(),
      closure: { engineering: { status: 'approved' }, operations: { status: 'approved' } },
      openUnsafeCount: 1,
    }
    expect(derivePermitStatus(p)).toBe(STATUS.CLOSED)
  })

  it('gets its own dashboard bucket instead of counting as awaiting approval', () => {
    const c = dashboardBuckets([
      { ...approvedPermit(), openUnsafeCount: 1 },
      approvedPermit({ id: 'p2' }),
      { id: 'p3' }, // draft
    ])
    expect(c.withObservations).toBe(1)
    expect(c.inProgress).toBe(1)
    expect(c.open).toBe(1)
  })
})

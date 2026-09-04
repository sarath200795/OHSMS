import { describe, it, expect } from 'vitest'
import { stretcherCondition, stretcherColor, stretcherIncomplete, stretcherSummary } from './assetLogic'
import { STRETCHER_STATUS } from './constants'

const TODAY = new Date('2026-06-01T00:00:00Z')
const inDays = (n) => new Date(TODAY.getTime() + n * 86400000).toISOString().slice(0, 10)

const str = (over = {}) => ({
  assetId: 'STR-0001', centerName: 'A', status: STRETCHER_STATUS.READY, nextInspection: inDays(200), ...over,
})

describe('stretcherCondition', () => {
  it('is ok while the inspection is far off and the status is Ready', () => {
    expect(stretcherCondition(str(), TODAY)).toEqual({ expired: false, due: false, ok: true })
  })

  it('falls due within the shared 30-day window', () => {
    expect(stretcherCondition(str({ nextInspection: inDays(10) }), TODAY)).toMatchObject({ due: true, ok: false })
  })

  it('is expired once the inspection date has passed', () => {
    expect(stretcherCondition(str({ nextInspection: inDays(-1) }), TODAY)).toMatchObject({ expired: true, ok: false })
  })

  // The status a person set by hand outranks the dates: somebody who marked a
  // stretcher out of service has seen it, and a future inspection date must not
  // paint it green over their head.
  it('honours a hand-set status over a healthy date', () => {
    expect(stretcherCondition(str({ status: STRETCHER_STATUS.OUT_OF_SERVICE }), TODAY)).toMatchObject({ expired: true })
    expect(stretcherCondition(str({ status: STRETCHER_STATUS.SERVICE_DUE }), TODAY)).toMatchObject({ due: true })
  })

  // A missing or unparseable date is not a pass and not a crash: it simply
  // contributes nothing, and stretcherIncomplete is what reports it.
  it('degrades to ok on a missing or corrupt date rather than throwing', () => {
    expect(stretcherCondition(str({ nextInspection: '' }), TODAY).ok).toBe(true)
    expect(stretcherCondition(str({ nextInspection: 'not a date' }), TODAY).ok).toBe(true)
  })
})

describe('stretcherColor', () => {
  it('maps the three conditions onto the shared palette', () => {
    expect(stretcherColor(str(), TODAY)).toBe('#16a34a')
    expect(stretcherColor(str({ nextInspection: inDays(10) }), TODAY)).toBe('#f59e0b')
    expect(stretcherColor(str({ nextInspection: inDays(-1) }), TODAY)).toBe('#dc2626')
  })
})

describe('stretcherIncomplete', () => {
  // The inspection date is the only date on the record. Without it the unit can
  // never fall due, so it would read as ready forever — whether it was checked
  // yesterday or never — which is exactly the state worth flagging.
  it('flags a record with no site or no next inspection', () => {
    expect(stretcherIncomplete(str())).toBe(false)
    expect(stretcherIncomplete(str({ centerName: '' }))).toBe(true)
    expect(stretcherIncomplete(str({ nextInspection: '' }))).toBe(true)
    expect(stretcherIncomplete(undefined)).toBe(true)
  })
})

describe('stretcherSummary', () => {
  it('buckets each unit exactly once', () => {
    const s = stretcherSummary([
      str(),
      str({ assetId: 'STR-0002', nextInspection: inDays(10) }),
      str({ assetId: 'STR-0003', nextInspection: inDays(-5) }),
      str({ assetId: 'STR-0004', status: STRETCHER_STATUS.OUT_OF_SERVICE }),
    ], TODAY)
    expect(s.total).toBe(4)
    expect(s.ready + s.due + s.outOfService).toBe(4)
    expect(s).toMatchObject({ ready: 1, due: 2, outOfService: 1 })
  })

  it('counts inspections falling due inside the window, overdue included', () => {
    const s = stretcherSummary([
      str({ nextInspection: inDays(10) }),
      str({ assetId: 'STR-0002', nextInspection: inDays(-5) }),
      str({ assetId: 'STR-0003', nextInspection: inDays(200) }),
    ], TODAY)
    expect(s.inspectionDue).toBe(2)
  })

  it('counts records still missing their key details', () => {
    expect(stretcherSummary([str(), str({ assetId: 'STR-0002', nextInspection: '' })], TODAY).incomplete).toBe(1)
  })

  it('returns zeroes for an empty register', () => {
    expect(stretcherSummary([], TODAY)).toEqual({ total: 0, ready: 0, due: 0, outOfService: 0, inspectionDue: 0, incomplete: 0 })
  })
})

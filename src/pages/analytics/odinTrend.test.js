// ─────────────────────────────────────────────────────────────────────────────
// ODIN — the time-series and estate-dimension arithmetic.
//
// Separate from odinAnalytics.test.js because it covers a distinct surface:
// how rows are bucketed into periods, how a warehouse's centre id is joined to
// this app's own site register, and the remediation cuts a ticket dump makes
// possible. The aggregation those feed is tested next door.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest'
import {
  bucketOf, passTrend, ticketTrend, countBy, toDateOf, isBreach,
  dimensionsPresent, joinQuality, resolveOdinRows, filterOdinRows,
  GRANULARITY_KEYS, PASS_MARK,
} from './odinAnalytics'

/** The shape functions/lib/metabase.js hands back, with the fields these tests need. */
const row = (over = {}) => ({
  siteId: '', site: 'Plant 2', region: 'South', entity: 'Retail',
  status: 'open', rawStatus: 'Open', category: '', subCategory: '',
  city: '', ownership: '', businessLine: '', centerType: '', auditType: '', auditor: '',
  priority: '', sla: '', checkpoint: '', tatHours: null,
  auditDate: '2026-03-14', closedDate: '', lat: null, lng: null, count: 1,
  passPct: null, passPctN7: null, passPctToDate: null,
  checksPassed: null, checksTotal: null, extra: {},
  ...over,
})

const audit = (over = {}) => row({ status: 'closed', passPct: 90, passPctN7: 96, ...over })

// ── Time buckets ─────────────────────────────────────────────────────────────

describe('bucketOf', () => {
  it('offers the six grains the filter bar does', () => {
    expect(GRANULARITY_KEYS).toEqual(['day', 'week', 'month', 'quarter', 'half', 'year'])
  })

  it('puts a date in the right bucket at every grain', () => {
    const d = '2026-03-14'   // a Saturday
    expect(bucketOf(d, 'day')).toEqual({ key: '2026-03-14', label: '14 Mar' })
    expect(bucketOf(d, 'week')).toEqual({ key: '2026-03-09', label: 'w/c 9 Mar' })
    expect(bucketOf(d, 'month')).toEqual({ key: '2026-03', label: 'Mar 26' })
    expect(bucketOf(d, 'quarter')).toEqual({ key: '2026-Q1', label: 'Q1 26' })
    expect(bucketOf(d, 'half')).toEqual({ key: '2026-H1', label: 'H1 2026' })
    expect(bucketOf(d, 'year')).toEqual({ key: '2026', label: '2026' })
  })

  it('starts a week on Monday, including when the date already is one', () => {
    expect(bucketOf('2026-03-09', 'week').key).toBe('2026-03-09')
    expect(bucketOf('2026-03-15', 'week').key).toBe('2026-03-09')   // Sunday still belongs to it
    expect(bucketOf('2026-03-16', 'week').key).toBe('2026-03-16')   // the next Monday
  })

  it('keys sort chronologically as plain strings, which the charts rely on', () => {
    const keys = ['2026-01-05', '2025-11-30', '2026-10-02']
      .map((d) => bucketOf(d, 'quarter').key).sort()
    expect(keys).toEqual(['2025-Q4', '2026-Q1', '2026-Q4'])
  })

  it('refuses a row with no usable date rather than inventing a bucket', () => {
    expect(bucketOf('', 'month')).toBe(null)
    expect(bucketOf('not a date', 'month')).toBe(null)
    expect(bucketOf('2026-03', 'month')).toBe(null)
  })

  it('crosses a half-year and a year boundary on the right side', () => {
    expect(bucketOf('2026-06-30', 'half').key).toBe('2026-H1')
    expect(bucketOf('2026-07-01', 'half').key).toBe('2026-H2')
    expect(bucketOf('2025-12-31', 'year').key).toBe('2025')
  })
})

describe('passTrend', () => {
  it('rates each bucket against the pass mark and says how many audits it saw', () => {
    const { series } = passTrend([
      audit({ auditDate: '2026-03-02', passPctN7: 95 }),
      audit({ auditDate: '2026-03-20', passPctN7: 80 }),
      audit({ auditDate: '2026-04-04', passPctN7: 91 }),
    ], 'month')
    expect(series.map((s) => s.key)).toEqual(['2026-03', '2026-04'])
    expect(series[0]).toMatchObject({ n7: 50, n7N: 2, pass: 1, fail: 1, audits: 2 })
    expect(series[1]).toMatchObject({ n7: 100, n7N: 1, pass: 1, fail: 0 })
  })

  it('leaves a period with no audits out rather than drawing it as zero', () => {
    const { series } = passTrend([
      audit({ auditDate: '2026-01-10' }),
      audit({ auditDate: '2026-03-10' }),
    ], 'month')
    expect(series.map((s) => s.key)).toEqual(['2026-01', '2026-03'])
  })

  it('counts undated audits aside instead of bucketing them somewhere wrong', () => {
    const { series, undated } = passTrend([
      audit({ auditDate: '' }),
      audit({ auditDate: '2026-03-10' }),
    ], 'month')
    expect(series).toHaveLength(1)
    expect(undated).toBe(1)
  })

  it('treats a score exactly at the mark as a pass, matching the question', () => {
    expect(PASS_MARK).toBe(90)
    const { series } = passTrend([audit({ auditDate: '2026-03-10', passPctN7: PASS_MARK })], 'month')
    expect(series[0].n7).toBe(100)
  })

  it('carries all three readings side by side', () => {
    const { series } = passTrend([
      audit({ auditDate: '2026-03-10', passPct: 80, passPctN7: 95, passPctToDate: 100 }),
    ], 'month')
    expect(series[0]).toMatchObject({ day0: 0, n7: 100, toDate: 100 })
  })
})

describe('ticketTrend', () => {
  it('splits each bucket by where the ticket stands and whether SLA held', () => {
    const { series } = ticketTrend([
      row({ auditDate: '2026-03-02', status: 'open', sla: 'open-SLA-Breached' }),
      row({ auditDate: '2026-03-09', status: 'closed', sla: 'Closed- Within SLA' }),
      row({ auditDate: '2026-03-11', status: 'in_progress', sla: 'open-within-SLA' }),
    ], 'month')
    expect(series[0]).toMatchObject({ total: 3, open: 2, closed: 1, breached: 1 })
  })

  it('reads a breach out of whatever wording the warehouse used', () => {
    expect(isBreach('open-SLA-Breached')).toBe(true)
    expect(isBreach('Closed- SLA Breached')).toBe(true)
    expect(isBreach('Closed- Within SLA')).toBe(false)
    expect(isBreach('')).toBe(false)
  })
})

describe('countBy', () => {
  it('ranks a free-text column and counts what is still open beside it', () => {
    const out = countBy([
      row({ priority: 'Code_red', status: 'open' }),
      row({ priority: 'Code_red', status: 'closed' }),
      row({ priority: 'Low', status: 'open' }),
    ], 'priority')
    expect(out[0]).toEqual({ name: 'Code_red', value: 2, open: 1 })
    expect(out[1]).toEqual({ name: 'Low', value: 1, open: 1 })
  })

  it('names the blank rather than dropping those rows into nothing', () => {
    expect(countBy([row({ priority: '' })], 'priority')[0].name).toBe('(not stated)')
  })

  it('honours a limit, for a league table that has to fit on screen', () => {
    const rows = ['a', 'b', 'c'].map((c) => row({ checkpoint: c }))
    expect(countBy(rows, 'checkpoint', { limit: 2 })).toHaveLength(2)
  })
})

describe('toDateOf', () => {
  it('is only the to-date column, never inferred from the other two', () => {
    expect(toDateOf({ passPctToDate: 100 })).toBe(100)
    expect(toDateOf({ passPct: 90, passPctN7: 96 })).toBe(null)
  })
})

// ── Joining the warehouse to this app's own site register ────────────────────

describe('the centre-id join', () => {
  const CODED = [
    { id: 'abc123', name: 'Cult Pitampura', region: 'North', entity: 'Fitness', lat: 28.7, lng: 77.1, attributes: { centerId: '201' } },
    { id: 'def456', name: 'Fast Fit Gym', region: 'South', entity: 'Partner', code: '50' },
  ]

  it('matches the warehouse centre id against a code held in attributes', () => {
    const [r] = resolveOdinRows([row({ siteId: '201', site: 'CULT PITAMPURA (renamed)', region: '' })], CODED)
    expect(r.matchedBy).toBe('id')
    expect(r.region).toBe('North')
    expect(r.lat).toBe(28.7)
  })

  it('matches a code held on the site document itself', () => {
    expect(resolveOdinRows([row({ siteId: '50', site: '' })], CODED)[0].matchedBy).toBe('id')
  })

  it('still falls back to the name when there is no code to match', () => {
    const [r] = resolveOdinRows([row({ siteId: '', site: 'Fast Fit Gym', entity: '' })], CODED)
    expect(r.matchedBy).toBe('name')
    expect(r.entity).toBe('Partner')
  })

  it('prefers the id over the name, because a name is not a key', () => {
    // The id says Pitampura, the name says Fast Fit. The id decides.
    const [r] = resolveOdinRows([row({ siteId: '201', site: 'Fast Fit Gym', region: '' })], CODED)
    expect(r.region).toBe('North')
  })

  it('reports how the estate joined, so a thin map is diagnosable', () => {
    const rows = resolveOdinRows([
      row({ siteId: '201', site: 'x' }),
      row({ siteId: '', site: 'Fast Fit Gym' }),
      row({ siteId: '999', site: 'Nowhere' }),
    ], CODED)
    expect(joinQuality(rows)).toEqual({ byId: 1, byName: 1, unmatched: 1, total: 3 })
  })
})

describe('dimensionsPresent', () => {
  it('offers only the dimensions the data can actually be grouped by', () => {
    const keys = dimensionsPresent([row({ city: 'Pune', businessLine: '', ownership: '' })]).map((d) => d.key)
    expect(keys).toContain('region')
    expect(keys).toContain('city')
    expect(keys).not.toContain('businessLine')
    expect(keys).not.toContain('ownership')
  })
})

describe('filterOdinRows, on the estate dimensions', () => {
  const POP = [
    row({ city: 'Pune', ownership: 'COCO', businessLine: 'ELITE', auditDate: '2026-03-14' }),
    row({ city: 'Bangalore', ownership: 'FOFO', businessLine: 'PRO', auditDate: '2026-05-02' }),
  ]

  it('cuts by each of the new dimensions', () => {
    expect(filterOdinRows(POP, { city: 'Pune' })).toHaveLength(1)
    expect(filterOdinRows(POP, { ownership: 'FOFO' })[0].city).toBe('Bangalore')
    expect(filterOdinRows(POP, { businessLine: 'ELITE' })[0].city).toBe('Pune')
  })

  it('takes a day-precision range as well as the month it used to take', () => {
    expect(filterOdinRows(POP, { from: '2026-03-15' })).toHaveLength(1)
    expect(filterOdinRows(POP, { from: '2026-03', to: '2026-03' })).toHaveLength(1)
    expect(filterOdinRows(POP, { from: '2026-03-14', to: '2026-05-02' })).toHaveLength(2)
  })

  it('keeps an undated row rather than hiding it the moment a range is set', () => {
    expect(filterOdinRows([row({ auditDate: '' })], { from: '2026-01-01', to: '2026-01-31' })).toHaveLength(1)
  })
})

import { describe, it, expect } from 'vitest'
import {
  incidentAnalytics, resolveIncidents, filterIncidents, headline, byMonth, monthOf, facets,
} from './incidentAnalytics'

const SITES = [
  { id: 's1', name: 'Plant 2', region: 'South', entity: 'COCO' },
  { id: 's2', name: 'Depot Chennai', region: 'East', entity: 'FOFO' },
]

const inc = (o) => ({ type: 'near_miss', incidentDate: '2026-03-04', ...o })

describe('resolveIncidents', () => {
  it('takes region and entity from the linked site when the incident has none', () => {
    const [r] = resolveIncidents([inc({ siteId: 's1' })], SITES)
    expect(r).toMatchObject({ siteId: 's1', region: 'South', entity: 'COCO' })
  })

  it('prefers what the incident itself records', () => {
    const [r] = resolveIncidents([inc({ siteId: 's1', region: 'North' })], SITES)
    expect(r.region).toBe('North')
  })

  it('matches a legacy incident by the site name in its location', () => {
    // Most historical incidents predate the site link; without this they drop
    // out of every breakdown.
    const [r] = resolveIncidents([inc({ location: 'By the gate, Depot Chennai' })], SITES)
    expect(r.siteId).toBe('s2')
    expect(r.region).toBe('East')
  })

  it('labels what it cannot place rather than dropping it', () => {
    const [r] = resolveIncidents([inc({ location: 'Somewhere else' })], SITES)
    expect(r).toMatchObject({ siteId: '', siteName: 'Unassigned', region: 'Unassigned' })
  })

  it('ignores soft-deleted incidents', () => {
    expect(resolveIncidents([inc({ deletedAt: new Date() })], SITES)).toHaveLength(0)
  })
})

describe('monthOf', () => {
  it('reads YYYY-MM from the incident date', () => {
    expect(monthOf({ incidentDate: '2026-03-04' })).toBe('2026-03')
  })
  it('returns empty for a missing or malformed date', () => {
    expect(monthOf({})).toBe('')
    expect(monthOf({ incidentDate: 'last tuesday' })).toBe('')
  })
})

describe('filterIncidents', () => {
  const rows = resolveIncidents([
    inc({ siteId: 's1', incidentDate: '2026-01-10' }),
    inc({ siteId: 's2', incidentDate: '2026-03-10' }),
    inc({ siteId: 's2', incidentDate: '2026-06-10' }),
    inc({ siteId: 's1', incidentDate: '' }),
  ], SITES)

  it('narrows by site, region and entity', () => {
    expect(filterIncidents(rows, { siteId: 's2' })).toHaveLength(2)
    expect(filterIncidents(rows, { region: 'South' })).toHaveLength(2)
    expect(filterIncidents(rows, { entity: 'FOFO' })).toHaveLength(2)
  })

  it('applies an inclusive month range', () => {
    const r = filterIncidents(rows, { from: '2026-03', to: '2026-06' })
    expect(r.filter((x) => x.month).map((x) => x.month)).toEqual(['2026-03', '2026-06'])
  })

  it('keeps undated incidents visible under a date range', () => {
    // An undated record is a data-quality problem to surface, not one to hide
    // by making it invisible whenever a range is set.
    const r = filterIncidents(rows, { from: '2026-05', to: '2026-05' })
    expect(r.some((x) => x.month === '')).toBe(true)
  })

  it('combines filters', () => {
    expect(filterIncidents(rows, { siteId: 's2', from: '2026-06' })).toHaveLength(1)
  })
})

describe('headline', () => {
  const rows = resolveIncidents([
    inc({ type: 'near_miss' }),
    inc({ type: 'near_miss' }),
    inc({ type: 'first_aid' }),
    inc({ type: 'lost_time', category: 'fire_explosion' }),
    inc({ type: 'reportable' }),
  ], SITES)

  it('counts each injury type', () => {
    expect(headline(rows)).toMatchObject({
      nearMiss: 2, firstAid: 1, lostTime: 1, reportable: 1, total: 5,
    })
  })

  it('counts fire by category, overlapping the types on purpose', () => {
    // A fire that caused a lost-time injury is both. Presenting the five as
    // exclusive buckets would misreport it.
    const h = headline(rows)
    expect(h.fire).toBe(1)
    expect(h.nearMiss + h.firstAid + h.lostTime + h.reportable).toBe(5)
  })
})

describe('byMonth', () => {
  it('returns months oldest first with per-type splits', () => {
    const rows = resolveIncidents([
      inc({ incidentDate: '2026-03-01', type: 'near_miss' }),
      inc({ incidentDate: '2026-01-01', type: 'first_aid' }),
      inc({ incidentDate: '2026-03-20', type: 'near_miss' }),
    ], SITES)
    const m = byMonth(rows)
    expect(m.map((r) => r.month)).toEqual(['2026-01', '2026-03'])
    expect(m[1]).toMatchObject({ total: 2, near_miss: 2, first_aid: 0 })
  })

  it('omits undated incidents from the trend', () => {
    expect(byMonth(resolveIncidents([inc({ incidentDate: '' })], SITES))).toEqual([])
  })
})

describe('incidentAnalytics', () => {
  const incidents = [
    inc({ siteId: 's1', type: 'near_miss', category: 'slip_trip_fall', lifecycle: 'closed' }),
    inc({ siteId: 's1', type: 'first_aid', category: 'fire_explosion', lifecycle: 'capa' }),
    inc({ siteId: 's2', type: 'reportable', category: 'slip_trip_fall', lifecycle: 'closed' }),
  ]

  it('breaks down by status, category, region, entity and site', () => {
    const a = incidentAnalytics(incidents, SITES)
    expect(a.byStatus.find((r) => r.key === 'closed').value).toBe(2)
    expect(a.byCategory[0]).toMatchObject({ key: 'slip_trip_fall', value: 2 })
    expect(a.byRegion.find((r) => r.key === 'South').value).toBe(2)
    expect(a.byEntity.find((r) => r.key === 'FOFO').value).toBe(1)
    expect(a.bySite.find((r) => r.key === 'Plant 2').value).toBe(2)
  })

  it('labels and colours each slice from the module constants', () => {
    const a = incidentAnalytics(incidents, SITES)
    expect(a.byCategory[0].name).toBe('Slip, Trip or Fall (same level)')
    expect(a.byStatus.find((r) => r.key === 'closed').color).toBe('#22c55e')
  })

  it('applies the filters to every breakdown at once', () => {
    const a = incidentAnalytics(incidents, SITES, { siteId: 's2' })
    expect(a.headline.total).toBe(1)
    expect(a.byRegion).toHaveLength(1)
    expect(a.byRegion[0].key).toBe('East')
  })

  it('returns empty breakdowns rather than throwing on no data', () => {
    const a = incidentAnalytics([], SITES)
    expect(a.headline.total).toBe(0)
    expect(a.byMonth).toEqual([])
    expect(a.bySite).toEqual([])
  })
})

describe('facets', () => {
  it('offers only values the viewer can actually see, and hides Unassigned', () => {
    const rows = resolveIncidents([
      inc({ siteId: 's1', incidentDate: '2026-02-01' }),
      inc({ location: 'nowhere', incidentDate: '2026-04-01' }),
    ], SITES)
    const f = facets(rows)
    expect(f.regions).toEqual(['South'])
    expect(f.months).toEqual(['2026-02', '2026-04'])
  })
})

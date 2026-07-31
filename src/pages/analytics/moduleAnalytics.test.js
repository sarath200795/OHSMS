import { describe, it, expect } from 'vitest'
import {
  attachSites, applyFilters, drillAnalytics, committeeAnalytics, equipmentAnalytics, monthOf,
} from './moduleAnalytics'

const SITES = [
  { id: 's1', name: 'Plant 2', region: 'South', entity: 'COCO', lat: 11, lng: 77 },
  { id: 's2', name: 'Depot Chennai', region: 'East', entity: 'FOFO', lat: 13, lng: 80 },
  { id: 's3', name: 'Unmapped Yard', region: 'East', entity: 'FOCO' },
]

describe('attachSites', () => {
  it('reads region and entity off the resolved site', () => {
    const [r] = attachSites([{ siteId: 's1', date: '2026-03-04' }], SITES)
    expect(r).toMatchObject({ siteId: 's1', region: 'South', entity: 'COCO', month: '2026-03' })
  })

  it('falls back to the centre name when there is no siteId', () => {
    const [r] = attachSites([{ centerName: 'Depot Chennai' }], SITES)
    expect(r.siteId).toBe('s2')
  })

  it('labels what it cannot place instead of dropping it', () => {
    const [r] = attachSites([{ centerName: 'Nowhere' }], SITES)
    expect(r).toMatchObject({ siteId: '', region: 'Unassigned', entity: 'Unassigned' })
  })

  it('ignores soft-deleted records', () => {
    expect(attachSites([{ siteId: 's1', deletedAt: new Date() }], SITES)).toHaveLength(0)
  })
})

describe('monthOf', () => {
  it('reads YYYY-MM, and nothing from junk', () => {
    expect(monthOf('2026-03-04')).toBe('2026-03')
    expect(monthOf('')).toBe('')
    expect(monthOf('soon')).toBe('')
  })
})

describe('applyFilters', () => {
  const rows = attachSites([
    { siteId: 's1', date: '2026-01-05' },
    { siteId: 's2', date: '2026-05-05' },
    { siteId: 's1', date: '' },
  ], SITES)

  it('narrows by site, region and entity', () => {
    expect(applyFilters(rows, { siteId: 's2' })).toHaveLength(1)
    expect(applyFilters(rows, { region: 'South' })).toHaveLength(2)
    expect(applyFilters(rows, { entity: 'FOFO' })).toHaveLength(1)
  })

  it('keeps undated records under a month range', () => {
    const r = applyFilters(rows, { from: '2026-03', to: '2026-03' })
    expect(r.some((x) => x.month === '')).toBe(true)
  })
})

describe('drillAnalytics', () => {
  const drills = [
    { id: 'd1', siteId: 's1', date: '2026-02-10', eventType: 'Mock Drill', scenario: 'Fire Emergency', outcome: 'Pass', docId: 'MD-1', capa: [{ status: 'Open' }, { status: 'Closed' }] },
    { id: 'd2', siteId: 's2', date: '2026-02-20', eventType: 'Mock Drill', scenario: 'Medical Emergency', outcome: 'Fail', docId: 'MD-2', capa: [{ status: 'In Progress' }] },
    { id: 'd3', siteId: 's1', date: '2026-03-01', eventType: 'Real Emergency', scenario: 'Fire Emergency', outcome: 'Pass', docId: 'ER-1', capa: [] },
  ]

  it('separates real emergencies from drills', () => {
    // They share a collection, but an emergency is the thing drills prepare for
    // and must not be counted as one.
    const a = drillAnalytics(drills, SITES)
    expect(a).toMatchObject({ total: 3, drills: 2, emergencies: 1 })
  })

  it('counts by scenario, site, region and entity', () => {
    const a = drillAnalytics(drills, SITES)
    expect(a.byScenario[0]).toMatchObject({ key: 'Fire Emergency', value: 2 })
    expect(a.bySite.find((r) => r.key === 'Plant 2').value).toBe(2)
    expect(a.byRegion.find((r) => r.key === 'East').value).toBe(1)
    expect(a.byEntity.find((r) => r.key === 'COCO').value).toBe(2)
  })

  it('tallies observations into the three fixed states', () => {
    const a = drillAnalytics(drills, SITES)
    expect(a.observationTotal).toBe(3)
    expect(a.observations.map((s) => s.value)).toEqual([1, 1, 1])
  })

  it('treats an observation with no status as open', () => {
    const a = drillAnalytics([{ id: 'x', siteId: 's1', capa: [{}] }], SITES)
    expect(a.observations.find((s) => s.key === 'Open').value).toBe(1)
  })

  it('ranks drills by how much follow-up they generated', () => {
    const a = drillAnalytics(drills, SITES)
    expect(a.perDrill.map((d) => d.name)).toEqual(['MD-1', 'MD-2'])
    expect(a.perDrill[0].open).toBe(1)
  })

  it('splits the monthly series by drill and emergency', () => {
    const a = drillAnalytics(drills, SITES)
    expect(a.byMonth.map((m) => m.month)).toEqual(['2026-02', '2026-03'])
    expect(a.byMonth[1]).toMatchObject({ drills: 0, emergencies: 1 })
  })

  it('applies filters to every breakdown', () => {
    const a = drillAnalytics(drills, SITES, { siteId: 's2' })
    expect(a.total).toBe(1)
    expect(a.observationTotal).toBe(1)
  })
})

describe('committeeAnalytics', () => {
  const meetings = [
    { id: 'm1', siteId: 's1', date: '2026-01-15', type: 'HSE Committee Meeting', actions: [{ status: 'Open' }, { status: 'Closed' }] },
    { id: 'm2', siteId: 's1', date: '2026-02-15', type: 'HSE Committee Meeting', actions: [{ status: 'In Progress' }] },
    { id: 'm3', siteId: 's2', date: '2026-02-20', type: 'Toolbox Talk', actions: [] },
  ]

  it('counts meetings per month with their actions by status', () => {
    const a = committeeAnalytics(meetings, SITES)
    expect(a.byMonth.map((m) => m.month)).toEqual(['2026-01', '2026-02'])
    expect(a.byMonth[0]).toMatchObject({ meetings: 1, Open: 1, Closed: 1 })
    expect(a.byMonth[1]).toMatchObject({ meetings: 2, 'In Progress': 1 })
  })

  it('totals actions across every meeting in scope', () => {
    const a = committeeAnalytics(meetings, SITES)
    expect(a.total).toBe(3)
    expect(a.actionTotal).toBe(3)
  })

  it('breaks meetings down by type and site', () => {
    const a = committeeAnalytics(meetings, SITES)
    expect(a.byType.find((r) => r.key === 'Toolbox Talk').value).toBe(1)
    expect(a.bySite.find((r) => r.key === 'Plant 2').value).toBe(2)
  })
})

describe('equipmentAnalytics', () => {
  const base = {
    sites: SITES,
    extinguishers: [
      { id: 'e1', siteId: 's1', physicalDefects: ['pin'] },
      { id: 'e2', siteId: 's1', physicalDefects: [] },
      { id: 'e3', siteId: 's2', physicalDefects: ['stand', 'handle'] },
    ],
    aeds: [
      { id: 'a1', siteId: 's1', status: 'ready' },
      { id: 'a2', siteId: 's2', status: 'out_of_service' },
    ],
    fas: [
      { id: 'f1', siteId: 's1', status: 'operational' },
      { id: 'f2', siteId: 's1', status: 'service_due' },
    ],
  }

  it('counts a defect on any asset kind, not just extinguishers', () => {
    // Counting only extinguisher defects would report a fleet healthy while its
    // defibrillators were out of service.
    const a = equipmentAnalytics(base)
    expect(a.byType.map((t) => t.key)).toEqual(
      expect.arrayContaining(['PIN', 'Stand', 'Handle Damage', 'AED out of service', 'Panel service due'])
    )
  })

  it('measures health in assets, not findings', () => {
    // e3 carries two defects but is one unhealthy asset.
    const a = equipmentAnalytics(base)
    expect(a.total).toBe(7)
    expect(a.faulty).toBe(4)
    expect(a.healthy).toBe(3)
    expect(a.healthPct).toBe(43)
  })

  it('groups defects by site, region and entity', () => {
    const a = equipmentAnalytics(base)
    expect(a.bySite.find((r) => r.key === 'Depot Chennai').value).toBe(3)
    expect(a.byRegion.find((r) => r.key === 'South').value).toBe(2)
    expect(a.byEntity.find((r) => r.key === 'FOFO').value).toBe(3)
  })

  it('narrows to one site', () => {
    const a = equipmentAnalytics({ ...base, siteId: 's2' })
    expect(a.total).toBe(2)
    expect(a.bySite).toHaveLength(1)
  })

  it('filters to one defect type without changing fleet health', () => {
    const a = equipmentAnalytics({ ...base, defectType: 'PIN' })
    expect(a.byType).toHaveLength(1)
    // Health describes the fleet, not the current filter.
    expect(a.faulty).toBe(4)
  })

  it('places a pin only on mapped sites that actually have a defect', () => {
    const a = equipmentAnalytics(base)
    expect(a.pins.map((p) => p.id).sort()).toEqual(['s1', 's2'])
    expect(a.pins.find((p) => p.id === 's2').defects).toBe(3)
  })

  it('reports no health figure for an empty fleet rather than 0%', () => {
    const a = equipmentAnalytics({ sites: SITES })
    expect(a.healthPct).toBeNull()
    expect(a.pins).toEqual([])
  })
})

// A record matching none of the visible sites is only genuinely "Unassigned"
// when the viewer can see every site. For anyone else it is most likely another
// site's, and bucketing it as Unassigned would show them a count they have no
// right to.
describe('scoping records the viewer cannot place', () => {
  const ONE_SITE = [SITES[0]]
  const drills = [
    { id: 'd1', siteId: 's1', date: '2026-02-01', eventType: 'Mock Drill', capa: [{ status: 'Open' }] },
    { id: 'd2', siteId: 's2', date: '2026-02-02', eventType: 'Mock Drill', capa: [{ status: 'Open' }] },
    { id: 'd3', centerName: 'Nowhere', date: '2026-02-03', eventType: 'Mock Drill', capa: [] },
  ]

  it('keeps unplaced records for a viewer who sees every site', () => {
    const a = drillAnalytics(drills, SITES, {}, { keepUnplaced: true })
    expect(a.total).toBe(3)
    // It keeps whatever name the record carried rather than being relabelled —
    // "Nowhere" tells an admin which record to go and fix.
    expect(a.bySite.map((r) => r.key)).toContain('Nowhere')
  })

  it('drops them for a viewer scoped to fewer sites', () => {
    const a = drillAnalytics(drills, ONE_SITE, {}, { keepUnplaced: false })
    expect(a.total).toBe(1)
    expect(a.observationTotal).toBe(1)
    expect(a.bySite.map((r) => r.key)).toEqual(['Plant 2'])
  })

  it('does the same for committee meetings', () => {
    const meetings = [
      { id: 'm1', siteId: 's1', date: '2026-01-01', actions: [{ status: 'Open' }] },
      { id: 'm2', siteId: 's2', date: '2026-01-02', actions: [{ status: 'Open' }] },
    ]
    expect(committeeAnalytics(meetings, ONE_SITE, {}, { keepUnplaced: false }).total).toBe(1)
    expect(committeeAnalytics(meetings, SITES, {}, { keepUnplaced: true }).total).toBe(2)
  })

  it('does not inflate a scoped fleet with other sites’ equipment', () => {
    const args = {
      sites: ONE_SITE,
      extinguishers: [{ id: 'e1', siteId: 's1' }, { id: 'e2', siteId: 's2' }],
      aeds: [{ id: 'a1', siteId: 's2', status: 'out_of_service' }],
    }
    expect(equipmentAnalytics({ ...args, keepUnplaced: false }).total).toBe(1)
    expect(equipmentAnalytics({ ...args, keepUnplaced: false }).faulty).toBe(0)
    // An admin sees all three assets and the defective AED.
    expect(equipmentAnalytics({ ...args, sites: SITES, keepUnplaced: true }).total).toBe(3)
  })
})

// A logged defect is only half of it: an extinguisher whose refill or hydraulic
// test has come due is not fit for purpose either, and nobody ticks a box to
// say so — it is a date passing.
describe('extinguisher refill and HPT dates count as defects', () => {
  const TODAY = new Date('2026-07-31')
  const ONE = (patch) => equipmentAnalytics({
    sites: SITES, today: TODAY,
    extinguishers: [{ id: 'e1', siteId: 's1', physicalDefects: [], ...patch }],
  })

  it('flags an overdue refill', () => {
    const a = ONE({ dateOfNextRefill: '2026-06-01' })
    expect(a.byType.map((t) => t.key)).toEqual(['Refilling Due'])
    expect(a.faulty).toBe(1)
  })

  it('flags an overdue hydraulic test', () => {
    const a = ONE({ dateOfNextHPT: '2026-01-01' })
    expect(a.byType.map((t) => t.key)).toEqual(['HPT Due'])
  })

  it('separates due-soon from overdue', () => {
    // One is a purchase order, the other is a unit that should be off the wall.
    expect(ONE({ dateOfNextRefill: '2026-08-10' }).byType.map((t) => t.key)).toEqual(['Refilling Due in 30'])
    expect(ONE({ dateOfNextHPT: '2026-08-10' }).byType.map((t) => t.key)).toEqual(['HPT Due in 30'])
  })

  it('leaves a unit in date alone', () => {
    const a = ONE({ dateOfNextRefill: '2027-01-01', dateOfNextHPT: '2028-01-01' })
    expect(a.byType).toEqual([])
    expect(a.faulty).toBe(0)
    expect(a.healthPct).toBe(100)
  })

  it('counts a unit that is both damaged and overdue once against health', () => {
    const a = ONE({ physicalDefects: ['pin'], dateOfNextRefill: '2026-06-01' })
    expect(a.byType).toHaveLength(2)
    expect(a.faulty).toBe(1)
  })

  it('stops reporting dates once the unit is refilled and closed', () => {
    const a = ONE({ dateOfNextRefill: '2026-06-01', status: 'closed' })
    expect(a.byType).toEqual([])
  })

  it('offers the date states as filterable defect types', () => {
    const a = equipmentAnalytics({
      sites: SITES, today: TODAY,
      extinguishers: [
        { id: 'e1', siteId: 's1', dateOfNextRefill: '2026-06-01' },
        { id: 'e2', siteId: 's2', dateOfNextHPT: '2026-01-01' },
      ],
    })
    expect(a.defectTypes).toEqual(['HPT Due', 'Refilling Due'])
    const only = equipmentAnalytics({
      sites: SITES, today: TODAY, defectType: 'HPT Due',
      extinguishers: [
        { id: 'e1', siteId: 's1', dateOfNextRefill: '2026-06-01' },
        { id: 'e2', siteId: 's2', dateOfNextHPT: '2026-01-01' },
      ],
    })
    expect(only.byType.map((t) => t.key)).toEqual(['HPT Due'])
    expect(only.bySite.map((s) => s.key)).toEqual(['Depot Chennai'])
  })
})

// The three kinds fail for unrelated reasons and are maintained by different
// people, so a single fleet figure hides which of the three is the problem.
describe('defects segregated by equipment kind', () => {
  const TODAY = new Date('2026-07-31')
  const args = {
    sites: SITES, today: TODAY,
    extinguishers: [
      { id: 'e1', siteId: 's1', physicalDefects: ['pin'] },
      { id: 'e2', siteId: 's1', physicalDefects: [] },
    ],
    aeds: [{ id: 'a1', siteId: 's1', status: 'out_of_service' }],
    fas: [{ id: 'f1', siteId: 's1', status: 'operational' }],
  }

  it('reports health per kind as well as overall', () => {
    const a = equipmentAnalytics(args)
    expect(a.healthPct).toBe(50) // 2 of 4 assets healthy
    const byKind = Object.fromEntries(a.fleetByKind.map((k) => [k.key, k]))
    expect(byKind.Extinguisher).toMatchObject({ total: 2, faulty: 1, healthPct: 50 })
    expect(byKind.AED).toMatchObject({ total: 1, faulty: 1, healthPct: 0 })
    expect(byKind['Fire alarm']).toMatchObject({ total: 1, faulty: 0, healthPct: 100 })
  })

  it('counts defects by kind', () => {
    const a = equipmentAnalytics(args)
    expect(a.byKind).toEqual([
      { key: 'Extinguisher', name: 'Extinguisher', value: 1 },
      { key: 'AED', name: 'AED', value: 1 },
    ])
  })

  it('narrows every figure to one kind', () => {
    const a = equipmentAnalytics({ ...args, kind: 'AED' })
    expect(a.total).toBe(1)
    expect(a.faulty).toBe(1)
    expect(a.byKind.map((k) => k.key)).toEqual(['AED'])
    expect(a.byType.map((t) => t.key)).toEqual(['AED out of service'])
  })

  it('offers only defect types that belong to the chosen kind', () => {
    // Otherwise the filter lists options that would return nothing.
    expect(equipmentAnalytics({ ...args, kind: 'AED' }).defectTypes).toEqual(['AED out of service'])
    expect(equipmentAnalytics({ ...args, kind: 'Extinguisher' }).defectTypes).toEqual(['PIN'])
  })

  it('keeps per-kind health describing the whole kind, not the defect filter', () => {
    const a = equipmentAnalytics({ ...args, defectType: 'PIN' })
    expect(a.byType.map((t) => t.key)).toEqual(['PIN'])
    expect(a.fleetByKind.find((k) => k.key === 'AED').faulty).toBe(1)
  })
})

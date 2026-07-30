import { describe, it, expect } from 'vitest'
import { portalStats, scopeIds } from './portalStats'

const SITES = [
  { id: 's1', name: 'Cult Gym Ameerpet' },
  { id: 's2', name: 'Cult Gym Shaikpet' },
]

// Scoping is the part that can be silently wrong: a count that includes a site
// the viewer has no permission for is a leak, and one that drops a site they
// own is a wrong answer they will act on.
describe('scopeIds', () => {
  it('covers every visible site when nothing is filtered', () => {
    expect([...scopeIds(SITES, 'all')]).toEqual(['s1', 's2'])
  })

  it('narrows to one site', () => {
    expect([...scopeIds(SITES, 's2')]).toEqual(['s2'])
  })

  it('is empty when the id is not one the viewer can see', () => {
    expect(scopeIds(SITES, 'sX').size).toBe(0)
  })
})

describe('portalStats counts', () => {
  const base = {
    sites: SITES,
    extinguishers: [
      { id: 'e1', siteId: 's1' },
      { id: 'e2', centerName: 'Cult Ameerpet' }, // resolves to s1 by normalisation
      { id: 'e3', siteId: 's2' },
      { id: 'e4', siteId: 's1', deletedAt: new Date() },
    ],
    aeds: [{ id: 'a1', siteId: 's1' }, { id: 'a2', siteId: 's2' }],
    fas: [{ id: 'f1', siteId: 's2' }],
  }

  it('counts every accessible site by default', () => {
    const s = portalStats(base)
    expect(s.counts).toMatchObject({ extinguishers: 3, aeds: 2, fas: 1 })
  })

  it('resolves an asset that only has a centre name', () => {
    expect(portalStats({ ...base, siteId: 's1' }).counts.extinguishers).toBe(2)
  })

  it('ignores soft-deleted assets', () => {
    // e4 is deleted, so s1 has e1 + e2 and not three.
    expect(portalStats({ ...base, siteId: 's1' }).counts.extinguishers).toBe(2)
  })

  it('counts nothing for a site outside the viewer’s access', () => {
    const s = portalStats({ ...base, siteId: 'sX' })
    expect(s.counts).toMatchObject({ extinguishers: 0, aeds: 0, fas: 0 })
  })
})

describe('portalStats compliance', () => {
  it('reports signage compliance as a percentage of what is recorded', () => {
    const s = portalStats({
      sites: SITES,
      signages: [
        { id: 'g1', siteId: 's1', condition: 'OK' },
        { id: 'g2', siteId: 's1', condition: 'Faded' },
        { id: 'g3', siteId: 's1', condition: 'Missing' },
        { id: 'g4', siteId: 's1', condition: 'ok' }, // case is not a finding
      ],
    })
    expect(s.signageCompliance).toBe(50)
    expect(s.signageTotal).toBe(4)
  })

  it('returns null rather than zero when there is nothing to measure', () => {
    // "No signage recorded" and "all signage failing" are opposite situations
    // and must not render as the same number.
    const s = portalStats({ sites: SITES })
    expect(s.signageCompliance).toBeNull()
    expect(s.trainingCompliance).toBeNull()
  })

  it('scopes training through the employee’s own site', () => {
    const s = portalStats({
      sites: SITES,
      users: [{ uid: 'u1', siteId: 's1' }, { uid: 'u2', siteId: 's2' }],
      assignments: [
        { employeeUid: 'u1', status: 'completed' },
        { employeeUid: 'u1', status: 'assigned' },
        { employeeUid: 'u2', status: 'assigned' },
      ],
      siteId: 's1',
    })
    expect(s.trainingCompliance).toBe(50)
  })

  it('excludes cancelled assignments from the denominator', () => {
    const s = portalStats({
      sites: SITES,
      users: [{ uid: 'u1', siteId: 's1' }],
      assignments: [
        { employeeUid: 'u1', status: 'completed' },
        { employeeUid: 'u1', status: 'cancelled' },
      ],
    })
    expect(s.trainingCompliance).toBe(100)
  })

  it('reports nothing to a viewer with no sites at all', () => {
    // The "nobody has a siteId yet" fallback must not answer a question about
    // the whole org to someone entitled to none of it.
    const s = portalStats({
      sites: [],
      users: [{ uid: 'u1' }],
      assignments: [{ employeeUid: 'u1', status: 'completed' }],
    })
    expect(s.trainingCompliance).toBeNull()
    expect(s.trainingTotal).toBe(0)
  })

  it('falls back to everyone when no employee has a site yet', () => {
    // Scoping by person would otherwise report 0% for an org that simply has
    // not filled in siteId.
    const s = portalStats({
      sites: SITES,
      users: [{ uid: 'u1' }],
      assignments: [{ employeeUid: 'u1', status: 'completed' }],
    })
    expect(s.trainingCompliance).toBe(100)
  })
})

describe('portalStats charts', () => {
  it('counts incidents by type, commonest first', () => {
    const s = portalStats({
      sites: SITES,
      incidents: [
        { siteId: 's1', type: 'near_miss' },
        { siteId: 's1', type: 'near_miss' },
        { siteId: 's2', type: 'first_aid' },
      ],
    })
    expect(s.incidentsByType[0]).toEqual({ key: 'near_miss', value: 2 })
    expect(s.counts.incidents).toBe(3)
  })

  it('matches a legacy incident by site name when it has no siteId', () => {
    const s = portalStats({
      sites: SITES,
      incidents: [{ location: 'Near the gate, Cult Gym Shaikpet', type: 'near_miss' }],
      siteId: 's2',
    })
    expect(s.counts.incidents).toBe(1)
  })

  it('ranks sites by equipment and drops the empty ones', () => {
    const s = portalStats({
      sites: SITES,
      extinguishers: [{ id: 'e1', siteId: 's2' }, { id: 'e2', siteId: 's2' }],
      aeds: [{ id: 'a1', siteId: 's2' }],
    })
    expect(s.equipmentBySite).toHaveLength(1)
    expect(s.equipmentBySite[0]).toMatchObject({ name: 'Cult Gym Shaikpet', total: 3 })
  })
})

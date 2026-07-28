import { describe, it, expect } from 'vitest'
import { resolveAccessibleSites, regionsOf, entitiesOf, accessSummary } from './access'

const sites = [
  { id: 's1', name: 'North Plant', region: 'North', entity: 'Acme Mfg' },
  { id: 's2', name: 'North Depot', region: 'North', entity: 'Acme Logistics' },
  { id: 's3', name: 'South Whse', region: 'South', entity: 'Acme Mfg' },
]
const ids = (arr) => arr.map((s) => s.id).sort()

describe('resolveAccessibleSites — site/region/entity scoping', () => {
  it('site-only grants access to just that site', () => {
    const u = { role: 'member', access: { sites: ['s1'], regions: [], entities: [] } }
    expect(ids(resolveAccessibleSites(u, sites))).toEqual(['s1'])
  })

  it('region-only grants every site in the region', () => {
    const u = { role: 'member', access: { sites: [], regions: ['North'], entities: [] } }
    expect(ids(resolveAccessibleSites(u, sites))).toEqual(['s1', 's2'])
  })

  it('entity-only grants every site in the entity', () => {
    const u = { role: 'member', access: { sites: [], regions: [], entities: ['Acme Mfg'] } }
    expect(ids(resolveAccessibleSites(u, sites))).toEqual(['s1', 's3'])
  })

  it('multiple selections apply as a union', () => {
    const u = { role: 'member', access: { sites: ['s2'], regions: ['South'], entities: [] } }
    expect(ids(resolveAccessibleSites(u, sites))).toEqual(['s2', 's3'])
  })

  it('admins access every site regardless of grant', () => {
    const u = { role: 'admin', access: {} }
    expect(resolveAccessibleSites(u, sites)).toHaveLength(3)
  })

  it('no grant → no sites', () => {
    const u = { role: 'member', access: { sites: [], regions: [], entities: [] } }
    expect(resolveAccessibleSites(u, sites)).toHaveLength(0)
  })

  it('dropdown option builders return distinct sorted values', () => {
    expect(regionsOf(sites)).toEqual(['North', 'South'])
    expect(entitiesOf(sites)).toEqual(['Acme Logistics', 'Acme Mfg'])
  })

  it('accessSummary describes the scope', () => {
    expect(accessSummary({ sites: ['s1'], regions: [], entities: [] }, sites)).toMatch(/1 site/)
    expect(accessSummary({ sites: [], regions: ['North'], entities: [] })).toMatch(/1 region/)
    expect(accessSummary({ sites: [], regions: [], entities: [] })).toBe('No access')
  })
})

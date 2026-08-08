import { describe, it, expect } from 'vitest'
import {
  siteMeta, matchesScope, filterByScope, narrowSites, reconcileScope, scopeFacets, isScoped, EMPTY_SCOPE,
} from './filters'

const sites = [
  { id: 's1', name: 'Hosur', entity: 'COCO', region: 'South' },
  { id: 's2', name: 'North Plant', entity: 'FOFO', region: 'North' },
  { id: 's3', name: 'Pune', entity: 'COCO', region: 'West' },
]
const meta = siteMeta(sites)

const dev = (id, siteId) => ({ id, siteId })

describe('siteMeta', () => {
  it('indexes sites by id with their attributes', () => {
    expect(meta.get('s1')).toEqual({ id: 's1', name: 'Hosur', entity: 'COCO', region: 'South' })
  })

  it('ignores rows with no id, which could never be matched', () => {
    expect(siteMeta([{ name: 'Ghost' }]).size).toBe(0)
  })
})

describe('matchesScope', () => {
  it('lets everything through when nothing is selected', () => {
    expect(matchesScope('s1', EMPTY_SCOPE, meta)).toBe(true)
    expect(matchesScope('', {}, meta)).toBe(true)
  })

  it('matches on site, entity and region individually', () => {
    expect(matchesScope('s1', { siteId: 's1' }, meta)).toBe(true)
    expect(matchesScope('s2', { siteId: 's1' }, meta)).toBe(false)
    expect(matchesScope('s1', { entity: 'COCO' }, meta)).toBe(true)
    expect(matchesScope('s2', { entity: 'COCO' }, meta)).toBe(false)
    expect(matchesScope('s1', { region: 'South' }, meta)).toBe(true)
    expect(matchesScope('s3', { region: 'South' }, meta)).toBe(false)
  })

  it('requires every selected facet to agree', () => {
    expect(matchesScope('s1', { entity: 'COCO', region: 'South' }, meta)).toBe(true)
    // s3 is COCO but West, so an entity+region pair excludes it.
    expect(matchesScope('s3', { entity: 'COCO', region: 'South' }, meta)).toBe(false)
  })

  // A device that cannot be shown to belong anywhere must not be quietly
  // counted inside a filter — that makes a filtered total wrong in the
  // direction nobody checks.
  it('excludes a device with no site, or one not in the registry, once filtered', () => {
    expect(matchesScope('', { region: 'South' }, meta)).toBe(false)
    expect(matchesScope('deleted-site', { region: 'South' }, meta)).toBe(false)
  })

  it('but still shows those devices when nothing is selected', () => {
    expect(matchesScope('', {}, meta)).toBe(true)
    expect(matchesScope('deleted-site', {}, meta)).toBe(true)
  })
})

describe('filterByScope', () => {
  const rows = [dev('a', 's1'), dev('b', 's2'), dev('c', 's3'), dev('d', '')]

  it('returns the original list untouched when unfiltered', () => {
    expect(filterByScope(rows, EMPTY_SCOPE, meta)).toBe(rows)
  })

  it('narrows by entity across sites', () => {
    expect(filterByScope(rows, { entity: 'COCO' }, meta).map((r) => r.id)).toEqual(['a', 'c'])
  })

  it('narrows by region', () => {
    expect(filterByScope(rows, { region: 'North' }, meta).map((r) => r.id)).toEqual(['b'])
  })

  // The reason siteIdOf exists: a camera's site can come from its DVR, so the
  // id on the document is not always the one to test.
  it('uses the resolved site id when one is supplied', () => {
    const cams = [{ id: 'cam1', siteId: '', resolved: 's2' }]
    expect(filterByScope(cams, { region: 'North' }, meta, (r) => r.resolved).map((r) => r.id)).toEqual(['cam1'])
    // …and would have dropped it using the raw field.
    expect(filterByScope(cams, { region: 'North' }, meta)).toEqual([])
  })
})

describe('narrowSites', () => {
  it('limits the site list to the chosen entity or region', () => {
    expect(narrowSites(sites, { entity: 'COCO' }).map((s) => s.id)).toEqual(['s1', 's3'])
    expect(narrowSites(sites, { region: 'West' }).map((s) => s.id)).toEqual(['s3'])
  })

  it('applies both together', () => {
    expect(narrowSites(sites, { entity: 'COCO', region: 'South' }).map((s) => s.id)).toEqual(['s1'])
  })

  it('returns everything when nothing is chosen', () => {
    expect(narrowSites(sites, {})).toHaveLength(3)
  })
})

describe('reconcileScope', () => {
  // Picking a region after a site can strand the site outside it, and an empty
  // table with two filters set reads as "no cameras" rather than "impossible
  // combination".
  it('drops a site that the newly chosen region excludes', () => {
    expect(reconcileScope({ siteId: 's1', region: 'North' }, sites)).toEqual({ siteId: '', region: 'North' })
  })

  it('drops a site that the chosen entity excludes', () => {
    expect(reconcileScope({ siteId: 's2', entity: 'COCO' }, sites)).toEqual({ siteId: '', entity: 'COCO' })
  })

  it('keeps a site that is still consistent', () => {
    const scope = { siteId: 's1', entity: 'COCO', region: 'South' }
    expect(reconcileScope(scope, sites)).toBe(scope)
  })

  it('is a no-op when no site is chosen', () => {
    const scope = { region: 'South' }
    expect(reconcileScope(scope, sites)).toBe(scope)
  })
})

describe('scopeFacets', () => {
  it('lists distinct entities and regions, sorted', () => {
    expect(scopeFacets(sites)).toEqual({ entities: ['COCO', 'FOFO'], regions: ['North', 'South', 'West'] })
  })

  it('ignores blanks so the dropdown has no empty option', () => {
    expect(scopeFacets([{ entity: '', region: '  ' }, { entity: 'X', region: 'Y' }]))
      .toEqual({ entities: ['X'], regions: ['Y'] })
  })
})

describe('isScoped', () => {
  it('is false only when nothing at all is selected', () => {
    expect(isScoped(EMPTY_SCOPE)).toBe(false)
    expect(isScoped({})).toBe(false)
    expect(isScoped({ region: 'South' })).toBe(true)
    expect(isScoped({ siteId: 's1' })).toBe(true)
  })
})

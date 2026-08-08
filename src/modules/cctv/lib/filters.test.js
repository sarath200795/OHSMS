import { describe, it, expect } from 'vitest'
import {
  siteMeta, matchesScope, filterByScope, narrowSites, reconcileScope, scopeFacets, isScoped, EMPTY_SCOPE,
  scopeEstate,
} from './filters'
import { estateHealth } from './health'

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

describe('scopeEstate', () => {
  const mk = (o = {}) => ({ id: 'm1', name: 'MX-Hosur', siteId: 's1', siteName: 'Hosur', status: 'online', ...o })
  const dv = (o = {}) => ({ id: 'd1', name: 'DVR-1', siteId: 's1', siteName: 'Hosur', status: 'online', ...o })
  const cm = (o = {}) => ({ id: 'c1', name: 'CAM-1', dvrId: 'd1', siteId: 's1', siteName: 'Hosur', status: 'online', defects: [], ...o })

  const build = (over = {}) => {
    const merakis = over.merakis || [mk(), mk({ id: 'm2', name: 'MX-North', siteId: 's2', siteName: 'North Plant' })]
    const dvrs = over.dvrs || [dv(), dv({ id: 'd2', name: 'DVR-2', siteId: 's2', siteName: 'North Plant' })]
    const cameras = over.cameras || [
      cm(), cm({ id: 'c2', name: 'CAM-2' }),
      cm({ id: 'c3', name: 'CAM-3', dvrId: 'd2', siteId: 's2', siteName: 'North Plant' }),
    ]
    return { raw: { cameras, dvrs, merakis }, estate: estateHealth({ cameras, dvrs, merakis }) }
  }

  it('returns the estate untouched when nothing is selected', () => {
    const { estate } = build()
    expect(scopeEstate(estate, EMPTY_SCOPE, meta)).toBe(estate)
  })

  it('narrows every list to the scope', () => {
    const { estate, raw } = build()
    const s = scopeEstate(estate, { region: 'South' }, meta, raw)
    expect(s.cameras.map((c) => c.id)).toEqual(['c1', 'c2'])
    expect(s.dvrs.map((d) => d.id)).toEqual(['d1'])
    expect(s.merakis.map((m) => m.id)).toEqual(['m1'])
  })

  // Estate-wide totals on a scoped page are worse than no totals.
  it('recomputes the summaries from the filtered lists', () => {
    const { estate, raw } = build()
    expect(estate.cameraSummary.total).toBe(3)
    expect(scopeEstate(estate, { region: 'South' }, meta, raw).cameraSummary.total).toBe(2)
  })

  it('recomputes the per-DVR and per-site reports', () => {
    const { estate, raw } = build()
    const s = scopeEstate(estate, { region: 'South' }, meta, raw)
    expect(s.dvrReport).toHaveLength(1)
    expect(s.dvrReport[0]).toMatchObject({ id: 'd1', cameras: 2 })
    expect(s.siteReport.map((r) => r.siteName)).toEqual(['Hosur'])
  })

  // The reason results are filtered rather than inputs: calculating over a
  // filtered set would give the same camera a different explanation depending
  // on which region you were looking at.
  it('keeps a camera’s cause intact even when the blamed device is out of scope', () => {
    // CAM-9 sits in the South but records to a DVR in the North that is down.
    const cameras = [cm({ id: 'c9', name: 'CAM-9', dvrId: 'd2', siteId: 's1', siteName: 'Hosur' })]
    const dvrs = [dv(), dv({ id: 'd2', name: 'DVR-2', siteId: 's2', siteName: 'North Plant', status: 'offline' })]
    const merakis = [mk(), mk({ id: 'm2', siteId: 's2' })]
    const estate = estateHealth({ cameras, dvrs, merakis })
    const s = scopeEstate(estate, { region: 'South' }, meta, { cameras, dvrs, merakis })
    expect(s.cameras[0]).toMatchObject({ id: 'c9', cause: 'dvr', working: false })
    expect(s.cameras[0].orphan).toBe(false)
    expect(s.cameras[0].blamedOn).toMatchObject({ name: 'DVR-2' })
  })

  it('narrows the defect extracts, keeping hand-entered defects', () => {
    const merakis = [mk({ defects: ['degraded'] }), mk({ id: 'm2', siteId: 's2', defects: ['degraded'] })]
    const { estate, raw } = build({ merakis })
    const s = scopeEstate(estate, { region: 'South' }, meta, raw)
    expect(estate.defects.meraki).toHaveLength(2)
    expect(s.defects.meraki).toHaveLength(1)
    expect(s.defects.meraki[0].defects).toEqual(['degraded'])
  })

  it('produces an empty but valid estate when nothing matches', () => {
    const { estate, raw } = build()
    const s = scopeEstate(estate, { region: 'Nowhere' }, meta, raw)
    expect(s.cameras).toEqual([])
    expect(s.cameraSummary).toMatchObject({ total: 0, uptime: 100 })
    expect(s.defects.camera).toEqual([])
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

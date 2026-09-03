import { describe, it, expect } from 'vitest'
import { prelaunchAnalytics, prelaunchFacets, readyColor } from './prelaunchAnalytics'
import { PRE_LAUNCH_ITEMS, PRE_LAUNCH_TOTAL } from '../../modules/documents/lib/prelaunch'
import { sitePanelRows, SITE_ROWS } from './PreLaunchTab'

const sites = [
  { id: 's1', name: 'North Plant', region: 'North', entity: 'Acme Mfg' },
  { id: 's2', name: 'South Depot', region: 'South', entity: 'Acme Logistics' },
]

/** A document that opens, filed against a checklist row for one site. */
const ready = (siteId, key) => ({
  id: `${siteId}-${key}`, siteId, prelaunchKey: key,
  source: 'link', linkUrl: 'https://example.test/a.pdf',
})

/** A record somebody created and never attached anything to. */
const stub = (siteId, key) => ({ id: `${siteId}-${key}`, siteId, prelaunchKey: key, source: 'upload', file: null })

const keys = PRE_LAUNCH_ITEMS.map((i) => i.key)
const wholePack = (siteId) => keys.map((k) => ready(siteId, k))

describe('the denominator', () => {
  // A percentage whose denominator grows as work is done cannot fall, and a
  // readiness figure that cannot fall is not a measurement.
  it('is every site owing the whole schedule, not the documents that exist', () => {
    const a = prelaunchAnalytics([ready('s1', 'fas-01')], sites)
    expect(a.required).toBe(2 * PRE_LAUNCH_TOTAL)
    expect(a.ready).toBe(1)
    expect(a.rows).toHaveLength(2)
    expect(a.rows.every((r) => r.total === PRE_LAUNCH_TOTAL)).toBe(true)
  })

  it('is zero sites, and 0%, when the filter matches none', () => {
    const a = prelaunchAnalytics(wholePack('s1'), sites, { region: 'West' })
    expect(a.sites).toBe(0)
    expect(a.required).toBe(0)
    expect(a.pct).toBe(0)
  })
})

describe('what counts', () => {
  // siteId exactly. A name fallback would attribute a document to a site the
  // security rules never let it near.
  it('ignores a document that names no site, and one that names an unknown one', () => {
    const a = prelaunchAnalytics(
      [{ ...ready('s1', 'fas-01'), siteId: '' }, ready('s9', 'fas-01')],
      sites
    )
    expect(a.ready).toBe(0)
  })

  it('ignores a document filed against no checklist row', () => {
    const a = prelaunchAnalytics([{ id: 'x', siteId: 's1', source: 'link', linkUrl: 'https://a.test/x' }], sites)
    expect(a.ready).toBe(0)
    expect(a.logged).toBe(0)
  })

  it('ignores a deleted document', () => {
    const a = prelaunchAnalytics([{ ...ready('s1', 'fas-01'), deletedAt: 'yesterday' }], sites)
    expect(a.ready).toBe(0)
  })

  // The failure nobody chases: it reads as done on a count of records.
  it('counts a record with nothing attached as logged, never as ready', () => {
    const a = prelaunchAnalytics([stub('s1', 'fas-01'), ready('s1', 'fas-02')], sites)
    expect(a.logged).toBe(2)
    expect(a.ready).toBe(1)
    expect(a.stub).toBe(1)
    expect(a.missing).toBe(2 * PRE_LAUNCH_TOTAL - 2)
  })

  it('does not double-count two documents against one row', () => {
    const a = prelaunchAnalytics([ready('s1', 'fas-01'), { ...ready('s1', 'fas-01'), id: 'other' }], sites)
    expect(a.ready).toBe(1)
  })
})

describe('the site worklist', () => {
  it('reports a complete pack, and only at every row', () => {
    const a = prelaunchAnalytics(wholePack('s1'), sites)
    expect(a.complete).toBe(1)
    expect(a.rows.find((r) => r.siteId === 's1').pct).toBe(100)

    const short = prelaunchAnalytics(wholePack('s1').slice(0, PRE_LAUNCH_TOTAL - 1), sites)
    expect(short.complete).toBe(0)
  })

  it('counts the sites nobody has started', () => {
    const a = prelaunchAnalytics([ready('s1', 'fas-01')], sites)
    expect(a.untouched).toBe(1)
  })

  // A worklist, so the ones that need doing come first.
  it('sorts least ready first', () => {
    const a = prelaunchAnalytics(wholePack('s1'), sites)
    expect(a.rows.map((r) => r.siteId)).toEqual(['s2', 's1'])
  })

  it('says how many sites it left off the panel', () => {
    const rows = Array.from({ length: SITE_ROWS + 3 }, (_, i) => ({ key: `s${i}` }))
    const { shown, hidden } = sitePanelRows(rows)
    expect(shown).toHaveLength(SITE_ROWS)
    expect(hidden).toBe(3)
    expect(sitePanelRows(rows.slice(0, 2)).hidden).toBe(0)
  })
})

describe('the rollups', () => {
  it('splits by category across every site in scope', () => {
    const a = prelaunchAnalytics([ready('s1', 'fas-01'), ready('s2', 'fas-02')], sites)
    const fas = a.byCategory.find((c) => c.key === 'fas')
    expect(fas.total).toBe(16) // eight rows, two sites
    expect(fas.ready).toBe(2)
    expect(a.byCategory.reduce((n, c) => n + c.total, 0)).toBe(a.required)
  })

  it('groups regions and entities by documents owed, not by site count', () => {
    const a = prelaunchAnalytics(wholePack('s1'), sites)
    const north = a.byRegion.find((r) => r.name === 'North')
    expect(north.value).toBe(100)
    expect(north.sites).toBe(1)
    expect(a.byRegion.find((r) => r.name === 'South').value).toBe(0)
  })

  it('files a site with no region or entity under Unassigned, and filters on it', () => {
    const loose = [{ id: 's3', name: 'Nowhere' }]
    const a = prelaunchAnalytics([], loose)
    expect(a.byRegion[0].name).toBe('Unassigned')
    expect(prelaunchAnalytics([], loose, { region: 'Unassigned' }).sites).toBe(1)
  })

  it('offers only the regions and entities that are actually set', () => {
    expect(prelaunchFacets([...sites, { id: 's3', name: 'Nowhere' }])).toEqual({
      regions: ['North', 'South'],
      entities: ['Acme Logistics', 'Acme Mfg'],
    })
  })
})

// Green at 100 and nowhere below it: a bar that goes green at 97% stops anybody
// reading the number beside it, and 34 of 35 is not a handover.
describe('readyColor', () => {
  it('is green only at 100', () => {
    expect(readyColor(100)).toBe('#22c55e')
    expect(readyColor(99)).toBe('#f59e0b')
    expect(readyColor(0)).toBe('#e5e0d8')
  })
})

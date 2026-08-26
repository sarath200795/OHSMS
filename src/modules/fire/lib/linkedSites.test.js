import { describe, it, expect } from 'vitest'
import { summariseLinkedSites, listLinkedAssets, isLinkedToSite, filterByLinkState, siteIdSet } from './linkedSites'

const sites = [
  { id: 's1', name: 'Cult Gym Miyapur', region: 'West', entity: 'COCO' },
  { id: 's2', name: 'Alpha Plant', region: 'North', entity: 'FOCO' },
  { id: 's3', name: 'Quiet Depot', region: 'North', entity: 'FOCO' },
]

const ext = (o = {}) => ({ id: 'e1', serialNo: 'FE-1', siteId: 's1', centerName: 'Cult Gym Miyapur', ...o })
const aed = (o = {}) => ({ id: 'a1', assetId: 'AED-1', siteId: 's1', centerName: 'Cult Gym Miyapur', ...o })
const fas = (o = {}) => ({ id: 'f1', deviceId: 'FAS-1', siteId: 's2', centerName: 'Alpha Plant', ...o })

describe('summariseLinkedSites', () => {
  it('groups every register under the site it links to', () => {
    const r = summariseLinkedSites(
      { extinguishers: [ext(), ext({ id: 'e2' })], aeds: [aed()], fas: [fas()] },
      sites
    )
    expect(r.linked.map((l) => [l.site.id, l.counts])).toEqual([
      ['s1', { ext: 2, aed: 1, fas: 0, sign: 0, total: 3 }],
      ['s2', { ext: 0, aed: 0, fas: 1, sign: 0, total: 1 }],
    ])
  })

  it('orders by equipment count, then by site name', () => {
    const r = summariseLinkedSites(
      { extinguishers: [ext({ siteId: 's2' }), ext({ id: 'e2', siteId: 's1' })] },
      sites
    )
    // Tied at one apiece, so the name decides: Alpha before Cult.
    expect(r.linked.map((l) => l.site.name)).toEqual(['Alpha Plant', 'Cult Gym Miyapur'])
  })

  it('lists sites that carry no equipment at all', () => {
    const r = summariseLinkedSites({ extinguishers: [ext()] }, sites)
    expect(r.empty.map((s) => s.id)).toEqual(['s2', 's3'])
  })

  it('groups unlinked assets by center name, not by site', () => {
    const r = summariseLinkedSites(
      { extinguishers: [ext({ siteId: '', centerName: 'Sunrise Miyapur' })], aeds: [aed({ siteId: '' })] },
      sites
    )
    expect(r.unlinked).toEqual([
      { centerName: 'Cult Gym Miyapur', counts: { ext: 0, aed: 1, fas: 0, sign: 0, total: 1 } },
      { centerName: 'Sunrise Miyapur', counts: { ext: 1, aed: 0, fas: 0, sign: 0, total: 1 } },
    ])
    expect(r.totals.assetsUnlinked).toBe(2)
  })

  it('labels an asset with neither a link nor a name', () => {
    const r = summariseLinkedSites({ extinguishers: [ext({ siteId: '', centerName: '  ' })] }, sites)
    expect(r.unlinked[0].centerName).toBe('(no site name)')
  })

  // The distinction the page exists to make: a siteId pointing at a site that
  // is deleted, or outside this reader's scope, is not coverage.
  it('separates a dangling siteId from a real link', () => {
    const r = summariseLinkedSites({ extinguishers: [ext({ siteId: 'gone' })] }, sites)
    expect(r.linked).toEqual([])
    expect(r.orphaned).toEqual([{ siteId: 'gone', counts: { ext: 1, aed: 0, fas: 0, sign: 0, total: 1 } }])
    expect(r.totals).toMatchObject({ sitesLinked: 0, assetsLinked: 0, assetsOrphaned: 1 })
  })

  it('ignores deleted assets', () => {
    const r = summariseLinkedSites({ extinguishers: [ext(), ext({ id: 'e2', deletedAt: 'x' })] }, sites)
    expect(r.totals.assetsLinked).toBe(1)
  })

  it('survives empty input', () => {
    const r = summariseLinkedSites()
    expect(r.linked).toEqual([])
    expect(r.totals).toEqual({ sitesLinked: 0, sitesTotal: 0, assetsLinked: 0, assetsUnlinked: 0, assetsOrphaned: 0 })
  })
})

describe('listLinkedAssets', () => {
  it('returns one row per linked asset, with its site resolved', () => {
    const rows = listLinkedAssets([ext(), fas()], sites)
    expect(rows.map((r) => [r.label, r.site.name])).toEqual([
      ['FAS-1', 'Alpha Plant'],
      ['FE-1', 'Cult Gym Miyapur'],
    ])
  })

  it('orders by site, then by the asset label within a site', () => {
    const rows = listLinkedAssets(
      [ext({ id: 'b', serialNo: 'FE-9' }), ext({ id: 'a', serialNo: 'FE-2' })],
      sites
    )
    expect(rows.map((r) => r.label)).toEqual(['FE-2', 'FE-9'])
  })

  it('takes the label from whichever id the register uses', () => {
    expect(listLinkedAssets([aed({ serialNo: '' })], sites)[0].label).toBe('AED-1')
  })

  // The counterpart to the orphan bucket: a link the registry cannot resolve is
  // not a row, because there is no site name to put beside it.
  it('drops unlinked, dangling and deleted assets', () => {
    const rows = listLinkedAssets(
      [ext({ siteId: '' }), ext({ id: 'x', siteId: 'gone' }), ext({ id: 'd', deletedAt: 'x' })],
      sites
    )
    expect(rows).toEqual([])
  })
})

describe('isLinkedToSite', () => {
  it('is true only when the id resolves in the registry', () => {
    const ids = siteIdSet(sites)
    expect(isLinkedToSite(ext(), ids)).toBe(true)
    expect(isLinkedToSite(ext({ siteId: '' }), ids)).toBe(false)
  })

  // Matches the orphan rule on the sites page: a link nothing resolves is not
  // a link, because the chip answers "can I find this by site?"
  it('treats a dangling id as not linked', () => {
    expect(isLinkedToSite(ext({ siteId: 'gone' }), siteIdSet(sites))).toBe(false)
  })

  it('accepts a raw site list as well as a prebuilt set', () => {
    expect(isLinkedToSite(ext(), sites)).toBe(true)
  })
})

describe('filterByLinkState', () => {
  const register = [ext(), ext({ id: 'e2', siteId: '' }), ext({ id: 'e3', siteId: 'gone' })]

  it('keeps only linked assets', () => {
    expect(filterByLinkState(register, sites, 'linked').map((e) => e.id)).toEqual(['e1'])
  })

  it('keeps everything a site cannot be found for', () => {
    expect(filterByLinkState(register, sites, 'unlinked').map((e) => e.id)).toEqual(['e2', 'e3'])
  })

  it('passes the register straight through when no state is set', () => {
    expect(filterByLinkState(register, sites, null)).toBe(register)
    expect(filterByLinkState(register, sites, 'anything else')).toBe(register)
  })
})

describe('signage', () => {
  const sign = (o = {}) => ({ id: 'g1', type: 'Fire Exit', location: 'Stairwell A', siteId: 's1', ...o })

  it('counts into its own bucket', () => {
    const r = summariseLinkedSites({ signages: [sign()] }, sites)
    expect(r.linked[0].counts).toEqual({ ext: 0, aed: 0, fas: 0, sign: 1, total: 1 })
  })

  // Signage has no serial, asset id or device id — a column of dashes would
  // make the linked list useless for the one register that most needs it.
  it('is labelled by what it is and where it hangs', () => {
    expect(listLinkedAssets([sign()], sites)[0].label).toBe('Fire Exit · Stairwell A')
  })

  it('falls back to the floor when there is no location', () => {
    expect(listLinkedAssets([sign({ location: '', floor: '2nd' })], sites)[0].label).toBe('Fire Exit · 2nd')
  })

  it('still says something when it carries neither', () => {
    expect(listLinkedAssets([sign({ location: '', floor: '', type: '' })], sites)[0].label).toBe('—')
  })

  it('filters by link state like every other register', () => {
    const register = [sign(), sign({ id: 'g2', siteId: '' })]
    expect(filterByLinkState(register, sites, 'linked').map((x) => x.id)).toEqual(['g1'])
    expect(filterByLinkState(register, sites, 'unlinked').map((x) => x.id)).toEqual(['g2'])
  })
})

import { describe, it, expect } from 'vitest'
import { standardMerakiName, sitesMissingMeraki, standardMerakiPayloads } from './provision'

const site = (o = {}) => ({ id: 's1', name: 'Hosur', region: 'South', entity: 'COCO', ...o })
const mk = (o = {}) => ({ id: 'm1', name: 'MX-Hosur', siteId: 's1', status: 'online', ...o })

describe('standardMerakiName', () => {
  it('prefixes the site name so a search finds site and switch together', () => {
    expect(standardMerakiName(site())).toBe('MX-Hosur')
    expect(standardMerakiName(site({ name: 'Plant 2 — Coimbatore' }))).toBe('MX-Plant 2 — Coimbatore')
  })

  it('falls back through name → siteName → id', () => {
    expect(standardMerakiName({ id: 'x', siteName: 'Pune' })).toBe('MX-Pune')
    expect(standardMerakiName({ id: 'abc' })).toBe('MX-abc')
  })

  it('returns nothing when there is nothing to name it after', () => {
    expect(standardMerakiName({})).toBe('')
    expect(standardMerakiName(null)).toBe('')
    expect(standardMerakiName({ name: '   ' })).toBe('')
  })
})

describe('sitesMissingMeraki', () => {
  it('returns sites that have none', () => {
    const out = sitesMissingMeraki([site(), site({ id: 's2', name: 'Pune' })], [mk()])
    expect(out.map((s) => s.id)).toEqual(['s2'])
  })

  // Pressing the button twice must not give a site two switches.
  it('is idempotent — a covered site is never returned again', () => {
    const sites = [site(), site({ id: 's2', name: 'Pune' })]
    const first = standardMerakiPayloads(sites, [])
    expect(first).toHaveLength(2)
    // Simulate them having been created, then run again.
    const created = first.map((p, i) => ({ id: `new${i}`, ...p }))
    expect(sitesMissingMeraki(sites, created)).toEqual([])
  })

  // A rename must not look like a new site.
  it('matches on siteId, not on name', () => {
    const renamed = [site({ name: 'Hosur Plant (renamed)' })]
    expect(sitesMissingMeraki(renamed, [mk()])).toEqual([])
  })

  it('leaves a site alone once it has any Meraki, whatever it is called', () => {
    expect(sitesMissingMeraki([site()], [mk({ name: 'core-switch-01' })])).toEqual([])
  })

  it('tops up only the new sites when more are added later', () => {
    const sites = [site(), site({ id: 's2', name: 'Pune' }), site({ id: 's3', name: 'Delhi' })]
    const out = sitesMissingMeraki(sites, [mk(), mk({ id: 'm2', siteId: 's2' })])
    expect(out.map((s) => s.id)).toEqual(['s3'])
  })

  // A blank-named site still gets one. An ugly "MX-<id>" is visible and can be
  // renamed; a site silently missing its switch is where the cascade stops
  // working and a network outage reads as every camera failing on its own.
  it('still provisions a site whose name is blank, falling back to its id', () => {
    expect(sitesMissingMeraki([{ id: 's9', name: '  ' }], []).map((s) => s.id)).toEqual(['s9'])
    expect(standardMerakiPayloads([{ id: 's9', name: '  ' }], [])[0].name).toBe('MX-s9')
  })

  it('skips a site with no id — it could never be matched again', () => {
    expect(sitesMissingMeraki([{ name: 'Ghost' }], [])).toEqual([])
  })

  it('ignores Meraki records that name no site', () => {
    expect(sitesMissingMeraki([site()], [mk({ siteId: '' })]).map((s) => s.id)).toEqual(['s1'])
  })

  it('survives empty input', () => {
    expect(sitesMissingMeraki()).toEqual([])
    expect(sitesMissingMeraki([], [])).toEqual([])
  })
})

describe('standardMerakiPayloads', () => {
  it('builds a complete, writable document per missing site', () => {
    const [p] = standardMerakiPayloads([site()], [])
    expect(p).toMatchObject({ name: 'MX-Hosur', siteId: 's1', siteName: 'Hosur', status: 'unknown' })
    expect(p.defects).toEqual([])
  })

  // Nothing has checked these switches; a green number nobody verified is worse
  // than an honest "not reported".
  it('does not claim the device is online', () => {
    expect(standardMerakiPayloads([site()], [])[0].status).toBe('unknown')
  })

  it('never emits undefined, which Firestore rejects', () => {
    const [p] = standardMerakiPayloads([{ id: 's1', name: 'Bare' }], [])
    expect(Object.values(p).every((v) => v !== undefined)).toBe(true)
  })

  it('says why the record exists, so a blank IP is not read as missing data', () => {
    expect(standardMerakiPayloads([site()], [])[0].notes).toMatch(/standard Meraki/i)
  })
})

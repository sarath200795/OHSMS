import { describe, it, expect } from 'vitest'
import { resolveSite, planSiteLinks, indexSites, suggestSite, linkImportRows, SITE_NAME_OVERRIDES, planAllSiteLinks, EQUIPMENT_KINDS } from './siteLink'

// Names below are real values from the Cult site master and the Fire Marshal
// export, so these cases reflect the data rather than invented shapes.
const site = (id, name, entity = 'COCO') => ({ id, name, entity })

const SITES = [
  site('s1', 'Cult Gym Ameerpet', 'FOCO'),
  site('s2', 'Cult Gym Shaikpet', 'COCO'),
  site('s3', 'Cult neo gym Alwal', 'FOFO'),
  site('s4', 'Stark Fitness Studio (Sainikpuri)', 'Marketplace'),
  site('s5', 'G8 Fitness', 'Marketplace'),
  site('s6', 'Stark Fitness Studio (Hydernagar)', 'Marketplace'),
  site('s7', 'Stark Fitness Studio', 'Marketplace'),
  site('s8', 'Cult Gym Suchitra Road (Suchitra)', 'FOFO'),
  site('s9', 'Cult Gym Somajiguda - Hybrid', 'FOFO'),
  site('s10', 'Pilates Circle - Banjara Hills', 'Pilate'),
  site('s11', 'Raptor Fitness (Addagutta)', 'Marketplace'),
  site('s12', 'Raptor Fitness (Bowenpally)', 'Marketplace'),
]

describe('resolveSite', () => {
  it('matches an exact name', () => {
    const r = resolveSite('Cult Gym Shaikpet', SITES)
    expect(r.site.id).toBe('s2')
    expect(r.how).toBe('exact')
  })

  it('ignores casing differences', () => {
    expect(resolveSite('Cult Neo Gym Alwal', SITES).site.id).toBe('s3')
  })

  it('matches when only the word "Gym" differs', () => {
    // The systematic difference between the two systems.
    const r = resolveSite('Cult Ameerpet', SITES)
    expect(r.site.id).toBe('s1')
    expect(r.how).toBe('normalised')
  })

  it('uses an override for a brand clash at the same locality', () => {
    // Similarity scoring pairs this with Stark (Sainikpuri) — a different business.
    const r = resolveSite('G8 Fitness Studio - Sainikpuri', SITES)
    expect(r.site.id).toBe('s5')
    expect(r.how).toBe('override')
  })

  it('uses an override for a locality clash within one brand', () => {
    expect(resolveSite('Stark fitness studio (Hyder Nagar)', SITES).site.id).toBe('s6')
    expect(resolveSite('Raptor Fitness (Addaguta)', SITES).site.id).toBe('s11')
  })

  it('does not send Suchitra equipment to the Somajiguda site', () => {
    expect(resolveSite('Cult Suchitra Hybrid', SITES).site.id).toBe('s8')
  })

  it('returns null rather than guessing when nothing matches', () => {
    expect(resolveSite('Some Gym That Does Not Exist', SITES)).toBeNull()
  })

  it('returns null for a blank center name', () => {
    for (const v of ['', '   ', null, undefined]) expect(resolveSite(v, SITES)).toBeNull()
  })

  it('returns null when an override points at a site this org does not have', () => {
    // The override table is global; an org missing that site must not crash.
    expect(resolveSite('Play Time Sport', SITES)).toBeNull()
  })
})

describe('indexSites', () => {
  it('keeps the first site when two normalise identically', () => {
    const dupes = [site('a', 'Cult Gym X'), site('b', 'Cult X')]
    const idx = indexSites(dupes)
    expect(idx.get('cult x').id).toBe('a')
  })
})

// Suggestions exist for the upload screen, where a person confirms them. The
// contract that matters is that they never fire for a name that already
// resolves, and never offer something unrelated.
describe('suggestSite', () => {
  it('offers nothing when the name already resolves', () => {
    expect(suggestSite('Cult Gym Shaikpet', SITES)).toBeNull()
    expect(suggestSite('Cult Shaikpet', SITES)).toBeNull() // normalises
    expect(suggestSite('Cult Suchitra Hybrid', SITES)).toBeNull() // override
  })

  it('offers the near miss for a misspelling', () => {
    const s = suggestSite('Cult Gym Shaikpett', SITES)
    expect(s?.site.name).toBe('Cult Gym Shaikpet')
  })

  it('ignores word order', () => {
    const s = suggestSite('Alwal Cult neo', SITES)
    expect(s?.site.name).toBe('Cult neo gym Alwal')
  })

  it('offers nothing for a name with no relation to any site', () => {
    expect(suggestSite('Zzzz Warehouse 12', SITES)).toBeNull()
  })

  it('offers nothing for a blank name', () => {
    expect(suggestSite('', SITES)).toBeNull()
    expect(suggestSite(null, SITES)).toBeNull()
  })
})

describe('planSiteLinks', () => {
  const ext = (id, centerName, entity = '1P', extra = {}) => ({ id, centerName, entity, ...extra })

  it('links assets and reports the ones it cannot', () => {
    const plan = planSiteLinks([
      ext('e1', 'Cult Gym Shaikpet'),
      ext('e2', 'Cult Ameerpet'),
      ext('e3', 'Nowhere Fitness'),
    ], SITES)
    expect(plan.linked).toHaveLength(2)
    expect(plan.unmatched).toHaveLength(1)
    expect(plan.unmatchedCenters).toEqual(['Nowhere Fitness'])
  })

  it('takes entity from the matched site, not a lookup table', () => {
    // 1P is usually COCO but this site is FOCO — reading it off the site is exact.
    const plan = planSiteLinks([ext('e1', 'Cult Gym Ameerpet', '1P')], SITES)
    expect(plan.linked[0].site.entity).toBe('FOCO')
    expect(plan.linked[0].entityChanged).toBe(true)
    expect(plan.entityChanges).toBe(1)
  })

  it('skips assets already linked with the right entity', () => {
    const plan = planSiteLinks([ext('e1', 'Cult Gym Shaikpet', 'COCO', { siteId: 's2' })], SITES)
    expect(plan.linked).toHaveLength(0)
  })

  it('re-links an asset whose entity drifted from its site', () => {
    const plan = planSiteLinks([ext('e1', 'Cult Gym Shaikpet', '1P', { siteId: 's2' })], SITES)
    expect(plan.linked).toHaveLength(1)
    expect(plan.linked[0].entityChanged).toBe(true)
  })

  // AEDs are listed and searched by centerName, so once an asset resolves, the
  // registry's wording is the one to keep — otherwise the same building reads
  // as two different places depending on which module you are in.
  it('flags a rename when the asset calls the site something else', () => {
    const plan = planSiteLinks([ext('a1', 'Cult Ameerpet', 'FOCO')], SITES)
    expect(plan.linked).toHaveLength(1)
    expect(plan.linked[0].nameChanged).toBe(true)
    expect(plan.linked[0].site.name).toBe('Cult Gym Ameerpet')
    expect(plan.nameChanges).toBe(1)
  })

  it('does not flag a rename when the names already agree', () => {
    const plan = planSiteLinks([ext('a1', 'Cult Gym Shaikpet', 'COCO', { siteId: 's2' })], SITES)
    expect(plan.linked).toHaveLength(0)
    expect(plan.nameChanges).toBe(0)
  })

  it('re-links an asset that is linked but still carries the old name', () => {
    const plan = planSiteLinks([ext('a1', 'Cult Ameerpet', 'FOCO', { siteId: 's1' })], SITES)
    expect(plan.linked).toHaveLength(1)
    expect(plan.linked[0].nameChanged).toBe(true)
    expect(plan.linked[0].entityChanged).toBe(false)
  })

  it('exposes the matched asset as `asset` as well as `ext`', () => {
    const plan = planSiteLinks([ext('a1', 'Cult Ameerpet', 'FOCO')], SITES)
    expect(plan.linked[0].asset).toBe(plan.linked[0].ext)
    expect(plan.linked[0].asset.id).toBe('a1')
  })

  it('ignores deleted assets', () => {
    const plan = planSiteLinks([ext('e1', 'Cult Gym Shaikpet', '1P', { deletedAt: 'x' })], SITES)
    expect(plan.linked).toHaveLength(0)
    expect(plan.unmatched).toHaveLength(0)
  })

  it('counts distinct centers seen', () => {
    const plan = planSiteLinks([
      ext('e1', 'Cult Gym Shaikpet'), ext('e2', 'Cult Gym Shaikpet'), ext('e3', 'Cult Ameerpet'),
    ], SITES)
    expect(plan.totalCenters).toBe(2)
  })
})

describe('SITE_NAME_OVERRIDES', () => {
  it('never maps a name to itself — that would be a normalisation case', () => {
    for (const [from, to] of Object.entries(SITE_NAME_OVERRIDES)) {
      expect(from.toLowerCase(), from).not.toBe(to.toLowerCase())
    }
  })

  it('has no duplicate source names', () => {
    const keys = Object.keys(SITE_NAME_OVERRIDES)
    expect(new Set(keys.map((k) => k.toLowerCase())).size).toBe(keys.length)
  })
})

describe('planSiteLinks — assets with no center name', () => {
  it('labels them instead of reporting a blank', () => {
    const plan = planSiteLinks([
      { id: 'e1', centerName: '', entity: '1P' },
      { id: 'e2', entity: '1P' },
    ], SITES)
    expect(plan.unmatched).toHaveLength(2)
    expect(plan.unmatchedCenters).toEqual(['(no center name)'])
  })
})

describe('linkImportRows', () => {
  const row = (centerName, extra = {}) => ({ serialNo: 'FE-1', type: 'CO2', centerName, ...extra })

  it('stamps the resolved siteId onto a row that matches', () => {
    const { rows } = linkImportRows([row('Cult Gym Shaikpet')], SITES)
    expect(rows[0].siteId).toBe('s2')
  })

  it('links through normalisation and the override table, not just exact names', () => {
    const { rows } = linkImportRows([row('Cult Ameerpet'), row('Cult Suchitra Hybrid')], SITES)
    expect(rows.map((r) => r.siteId)).toEqual(['s1', 's8'])
  })

  it("rewrites the centre to the registry's wording and takes its entity", () => {
    const { rows } = linkImportRows([row('Cult Ameerpet', { entity: 'WRONG' })], SITES)
    expect(rows[0].centerName).toBe('Cult Gym Ameerpet')
    expect(rows[0].entity).toBe('FOCO')
  })

  it('keeps the row entity when the matched site has none', () => {
    const sites = [{ id: 'sX', name: 'Bare Site', entity: '' }]
    const { rows } = linkImportRows([row('Bare Site', { entity: 'COCO' })], sites)
    expect(rows[0].entity).toBe('COCO')
  })

  // The point of the whole helper: there is no path from here that writes a
  // record with no site. An unmatched row is held back, not imported unlinked.
  it('keeps an unmatched row out of the importable rows entirely', () => {
    const { rows, blocked } = linkImportRows(
      [row('Cult Gym Shaikpet'), row('Some Gym That Does Not Exist')],
      SITES
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].siteId).toBe('s2')
    expect(blocked).toHaveLength(1)
    expect(blocked[0].centerName).toBe('Some Gym That Does Not Exist')
  })

  it('never puts a siteId on a blocked row', () => {
    const { blocked } = linkImportRows([row('Some Gym That Does Not Exist')], SITES)
    expect('siteId' in blocked[0]).toBe(false)
  })

  it('returns blocked rows untouched, so the caller can list them as written', () => {
    const original = row('Some Gym That Does Not Exist', { entity: 'COCO' })
    const { blocked } = linkImportRows([original], SITES)
    expect(blocked[0]).toEqual(original)
  })

  it('blocks a row with no centre name and labels it rather than showing a blank', () => {
    const { rows, blocked, unmatched } = linkImportRows([row(''), row('   ')], SITES)
    expect(rows).toHaveLength(0)
    expect(blocked).toHaveLength(2)
    expect(unmatched).toHaveLength(1)
    expect(unmatched[0].given).toBe('(no site name)')
    expect(unmatched[0].suggestion).toBeNull()
  })

  it('groups unmatched centres by spelling and counts the rows each holds back', () => {
    const { unmatched } = linkImportRows(
      [row('Nowhere Fitness'), row('Nowhere Fitness'), row('Nowhere Fitness')],
      SITES
    )
    expect(unmatched).toHaveLength(1)
    expect(unmatched[0]).toMatchObject({ given: 'Nowhere Fitness', count: 3 })
  })

  it('offers a suggestion when one is close enough', () => {
    const { unmatched } = linkImportRows([row('Raptor Fitness (Bowenpaly)')], SITES)
    expect(unmatched[0].suggestion?.id).toBe('s12')
  })

  it('offers no suggestion when nothing is close', () => {
    const { unmatched } = linkImportRows([row('Zzz Unrelated Warehouse')], SITES)
    expect(unmatched[0].suggestion).toBeNull()
  })

  // Blocking needs something to block against. An org with no registry yet must
  // still be able to upload, so nothing is held back in that case.
  it('blocks nothing when the org has no site registry', () => {
    const rowsIn = [row('Cult Gym Shaikpet'), row('Anything At All')]
    const { rows, blocked, unmatched } = linkImportRows(rowsIn, [])
    expect(rows).toBe(rowsIn)
    expect(blocked).toEqual([])
    expect(unmatched).toEqual([])
  })

  it("does not mutate the caller's rows", () => {
    const original = row('Cult Gym Shaikpet')
    const copy = { ...original }
    linkImportRows([original], SITES)
    expect(original).toEqual(copy)
  })
})

describe('planAllSiteLinks', () => {
  const sites = [
    { id: 's1', name: 'North Plant', region: 'North', entity: 'COCO' },
    { id: 's2', name: 'South Warehouse', region: 'South', entity: 'FOCO' },
  ]
  const registers = {
    extinguishers: [{ id: 'e1', serialNo: 'FE-1', centerName: 'North Plant' }],
    aeds: [{ id: 'a1', assetId: 'AED-1', centerName: 'South Warehouse' }],
    fas: [{ id: 'f1', deviceId: 'FAS-1', centerName: 'Nowhere At All' }],
  }

  it('plans each register separately, keyed by kind', () => {
    const { byKind } = planAllSiteLinks(registers, sites)
    expect(byKind.ext.linked).toHaveLength(1)
    expect(byKind.aed.linked).toHaveLength(1)
    expect(byKind.fas.linked).toHaveLength(0)
  })

  // One table shows all three, so a bare serial has to say where it came from.
  it('tags every combined row with its kind', () => {
    const { combined, total } = planAllSiteLinks(registers, sites)
    expect(total).toBe(2)
    expect(combined.linked.map((l) => [l.kind, l.site.name])).toEqual([
      ['ext', 'North Plant'],
      ['aed', 'South Warehouse'],
    ])
  })

  it('pools the unmatched across registers, without repeating a name', () => {
    const { combined } = planAllSiteLinks(
      { ...registers, aeds: [{ id: 'a2', assetId: 'AED-2', centerName: 'Nowhere At All' }] },
      sites
    )
    expect(combined.unmatchedCenters).toEqual(['Nowhere At All'])
    expect(combined.unmatched.map((u) => u.kind)).toEqual(['aed', 'fas'])
  })

  it('sums the corrections each register would make', () => {
    const { combined } = planAllSiteLinks(registers, sites)
    expect(combined.entityChanges).toBe(2)
  })

  it('survives a register that is simply absent', () => {
    const { total, byKind } = planAllSiteLinks({ aeds: registers.aeds }, sites)
    expect(total).toBe(1)
    expect(byKind.ext.linked).toEqual([])
  })

  it('covers every kind the modal can label', () => {
    expect(EQUIPMENT_KINDS.map((k) => k.key)).toEqual(['ext', 'aed', 'fas', 'sign'])
  })

  it('plans signage alongside the rest', () => {
    const { byKind, total } = planAllSiteLinks(
      { ...registers, signages: [{ id: 'g1', type: 'Fire Exit', centerName: 'North Plant' }] },
      sites
    )
    expect(byKind.sign.linked).toHaveLength(1)
    expect(total).toBe(3)
  })
})

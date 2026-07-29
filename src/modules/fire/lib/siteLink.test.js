import { describe, it, expect } from 'vitest'
import { resolveSite, planSiteLinks, indexSites, SITE_NAME_OVERRIDES } from './siteLink'

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

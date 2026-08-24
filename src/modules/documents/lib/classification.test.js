// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  ORG, REGION, SITE, UNCLASSIFIED, levelOf, classificationFields,
} from './classification'

const sites = [
  { id: 's1', name: 'Hosur', region: 'South' },
  { id: 's2', name: 'North Plant', region: 'North' },
]

const orgDoc = { title: 'HSE Policy', level: ORG }
const regionDoc = { title: 'South SOP', level: REGION, region: 'South' }
const siteDoc = { title: 'Hosur SDS', level: SITE, siteId: 's1', site: 'Hosur' }
const legacyDoc = { title: 'Old form' }

describe('levelOf', () => {
  it('reads the three levels back', () => {
    expect(levelOf(orgDoc)).toBe(ORG)
    expect(levelOf(regionDoc)).toBe(REGION)
    expect(levelOf(siteDoc)).toBe(SITE)
  })

  // The whole point of the requirement: documents written before the field
  // existed keep working, they just have nothing to say about where they apply.
  it('treats a document with no level as unclassified', () => {
    expect(levelOf(legacyDoc)).toBe(UNCLASSIFIED)
    expect(levelOf({ level: '' })).toBe(UNCLASSIFIED)
    expect(levelOf(undefined)).toBe(UNCLASSIFIED)
  })

  it('never guesses a level for one it does not recognise', () => {
    expect(levelOf({ level: 'state' })).toBe(UNCLASSIFIED)
    expect(levelOf({ level: 'ORG' })).toBe(UNCLASSIFIED)
  })

  // "Region" with no region is narrower than the organization without saying
  // where — less useful than admitting it is unclassified.
  it('is unclassified when a level names nothing', () => {
    expect(levelOf({ level: REGION })).toBe(UNCLASSIFIED)
    expect(levelOf({ level: REGION, region: '   ' })).toBe(UNCLASSIFIED)
    expect(levelOf({ level: SITE })).toBe(UNCLASSIFIED)
    expect(levelOf({ level: SITE, siteId: '' })).toBe(UNCLASSIFIED)
  })

  // Org level names nothing by design; that is what "applies everywhere" means.
  it('needs nothing named at organization level', () => {
    expect(levelOf({ level: ORG })).toBe(ORG)
    expect(levelOf(legacyDoc)).toBe(UNCLASSIFIED)
  })
})


describe('classificationFields', () => {
  it('writes every field so Firestore never sees undefined', () => {
    const keys = ['level', 'region', 'siteId', 'site', 'visibility', 'siteRegion', 'siteEntity']
    expect(Object.keys(classificationFields({ level: ORG })).sort()).toEqual([...keys].sort())
    expect(Object.keys(classificationFields({ level: REGION, region: 'South' })).sort()).toEqual([...keys].sort())
    expect(Object.keys(classificationFields({ level: SITE, siteId: 's1' }, sites)).sort()).toEqual([...keys].sort())
    expect(Object.keys(classificationFields({})).sort()).toEqual([...keys].sort())
  })

  // Changing the level has to clear what the old one named, or the document
  // applies everywhere AND to one site at the same time.
  it('clears the scope the new level does not use', () => {
    const wasSite = { level: ORG, region: 'South', siteId: 's1', site: 'Hosur' }
    expect(classificationFields(wasSite, sites)).toEqual({
      level: ORG, region: '', siteId: '', site: '',
      visibility: 'all', siteRegion: '', siteEntity: '',
    })
    expect(classificationFields({ level: REGION, region: 'North', siteId: 's1' }, sites))
      .toEqual({
        level: REGION, region: 'North', siteId: '', site: '',
        visibility: 'all', siteRegion: '', siteEntity: '',
      })
  })

  it('snapshots the site name beside its id so a deleted site stays readable', () => {
    expect(classificationFields({ level: SITE, siteId: 's2' }, sites))
      .toEqual({
        level: SITE, region: '', siteId: 's2', site: 'North Plant',
        visibility: 'site', siteRegion: 'North', siteEntity: '',
      })
  })

  // The rule cannot read the site document, so what it needs travels with the
  // document. A site level that never resolved to a site names nothing, so it
  // is not a boundary either — it must not become a document only an admin can
  // ever see.
  it('marks a site-level document as site-scoped and carries what the rule reads', () => {
    const f = classificationFields({ level: SITE, siteId: 's1' }, sites)
    expect(f.visibility).toBe('site')
    expect(f.siteRegion).toBe('South')
  })

  it('leaves a site level with no site open rather than locking it to nobody', () => {
    const f = classificationFields({ level: SITE, siteId: '' }, sites)
    expect(f.visibility).toBe('all')
    expect(f.siteId).toBe('')
  })

  it('keeps every other level org-wide', () => {
    expect(classificationFields({ level: ORG }).visibility).toBe('all')
    expect(classificationFields({ level: REGION, region: 'South' }).visibility).toBe('all')
    expect(classificationFields({}).visibility).toBe('all')
  })

  it('keeps a name already on the record when the site has left the registry', () => {
    expect(classificationFields({ level: SITE, siteId: 'gone', site: 'Old Depot' }, sites).site).toBe('Old Depot')
  })

  // An unrecognised level must not be written back as if it meant something.
  it('stores nothing for a level it does not recognise', () => {
    expect(classificationFields({ level: 'state', region: 'Kerala' }).level).toBe('')
    expect(classificationFields({}).level).toBe('')
  })

  it('round-trips through levelOf', () => {
    expect(levelOf(classificationFields({ level: SITE, siteId: 's1' }, sites))).toBe(SITE)
    expect(levelOf(classificationFields({ level: REGION, region: 'South' }))).toBe(REGION)
    expect(levelOf(classificationFields({ level: REGION }))).toBe(UNCLASSIFIED)
  })
})

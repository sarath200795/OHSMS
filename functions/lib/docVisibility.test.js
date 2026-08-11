import { describe, it, expect } from 'vitest'
import { visibilityPatch, planBackfill } from './docVisibility.js'

const sites = new Map([
  ['s1', { name: 'Hosur', region: 'South', entity: 'COCO' }],
  ['s2', { name: 'Bare', region: '', entity: '' }],
])

describe('visibilityPatch', () => {
  it('leaves an already-stamped document alone', () => {
    expect(visibilityPatch({ visibility: 'all' }, sites)).toBeNull()
    expect(visibilityPatch({ visibility: 'site', siteId: 's1' }, sites)).toBeNull()
  })

  it('stamps a legacy document org-wide — the access it already has', () => {
    expect(visibilityPatch({ title: 'Old SOP' }, sites)).toEqual({
      visibility: 'all', siteId: '', siteRegion: '', siteEntity: '',
    })
  })

  it('stamps an organization-level document org-wide', () => {
    expect(visibilityPatch({ level: 'org' }, sites).visibility).toBe('all')
  })

  it('stamps a region-level document org-wide — only Site is restricted', () => {
    expect(visibilityPatch({ level: 'region', region: 'South' }, sites).visibility).toBe('all')
  })

  // The rule reads siteRegion and siteEntity directly too, so a half-stamped
  // document is one nobody but an elevated role could open.
  it('carries the region and entity the rule reads', () => {
    expect(visibilityPatch({ level: 'site', siteId: 's1' }, sites)).toEqual({
      visibility: 'site', siteRegion: 'South', siteEntity: 'COCO',
    })
  })

  it('writes blanks for a site that has no region or entity', () => {
    expect(visibilityPatch({ level: 'site', siteId: 's2' }, sites)).toEqual({
      visibility: 'site', siteRegion: '', siteEntity: '',
    })
  })

  it('writes blanks for a site that has left the registry', () => {
    expect(visibilityPatch({ level: 'site', siteId: 'gone' }, sites)).toEqual({
      visibility: 'site', siteRegion: '', siteEntity: '',
    })
  })

  // A site level naming no site is not a boundary, and must not become a
  // document only an admin can ever open.
  it('leaves a site level with no site open', () => {
    expect(visibilityPatch({ level: 'site', siteId: '' }, sites).visibility).toBe('all')
    expect(visibilityPatch({ level: 'site' }, sites).visibility).toBe('all')
  })

  it('survives a missing document', () => {
    expect(visibilityPatch(null, sites).visibility).toBe('all')
  })
})

describe('planBackfill', () => {
  const docs = [
    { id: 'a', data: { title: 'Legacy' } },
    { id: 'b', data: { level: 'site', siteId: 's1', title: 'Plant SOP' } },
    { id: 'c', data: { visibility: 'all', title: 'Done already' } },
  ]

  it('separates what needs writing from what does not', () => {
    const plan = planBackfill(docs, sites)
    expect(plan.writes.map((w) => w.id)).toEqual(['a', 'b'])
    expect(plan.alreadyStamped).toBe(1)
  })

  it('counts the two kinds so the caller can report them', () => {
    const plan = planBackfill(docs, sites)
    expect(plan.orgWide).toBe(1)
    expect(plan.siteScoped).toBe(1)
  })

  // Idempotence is the property that makes this safe to run twice.
  it('plans nothing on a second pass', () => {
    const stamped = docs.map((d) => ({ id: d.id, data: { ...d.data, ...(visibilityPatch(d.data, sites) || {}) } }))
    expect(planBackfill(stamped, sites).writes).toHaveLength(0)
  })

  it('names each document so the report is readable', () => {
    expect(planBackfill(docs, sites).writes[0].title).toBe('Legacy')
    expect(planBackfill([{ id: 'x', data: {} }], sites).writes[0].title).toBe('(untitled)')
  })

  it('copes with an empty library', () => {
    expect(planBackfill([], sites)).toMatchObject({ writes: [], alreadyStamped: 0 })
  })
})

import { describe, it, expect } from 'vitest'
import {
  DOC_TYPES, docTypeTone, docTypeLabel,
  SOURCE_UPLOAD, SOURCE_LINK, isSafeDocumentUrl, documentHref, hasDocument,
  documentLabel, documentFolder, siteFolders, FOLDER_PREFIX, matchesScope,
} from './docTypes'

describe('the document types', () => {
  it('keeps the four the library started with', () => {
    const values = DOC_TYPES.map((t) => t.value)
    expect(values).toEqual(expect.arrayContaining(['Policy', 'SOP', 'SDS', 'Form']))
  })

  it('adds the engineering records a site has to produce on demand', () => {
    const values = DOC_TYPES.map((t) => t.value)
    expect(values).toEqual(expect.arrayContaining([
      'GFC', 'HPT', 'Structural Stability', 'Load Balancing', 'UPS & Power Backup Calculation',
    ]))
  })

  // The abbreviations are the ones people file under; the expansion is what
  // somebody who has not seen them before needs.
  it('expands the abbreviations in the label but files under the short value', () => {
    expect(docTypeLabel('GFC')).toBe('GFC (Good For Construction)')
    expect(docTypeLabel('HPT')).toBe('HPT (Hydrostatic Pressure Test)')
  })

  it('falls back rather than rendering undefined for an unknown type', () => {
    expect(docTypeLabel('Whatever')).toBe('Whatever')
    expect(docTypeLabel('')).toBe('—')
    expect(docTypeTone('Whatever')).toBe('gray')
  })

  it('has no duplicate values', () => {
    const values = DOC_TYPES.map((t) => t.value)
    expect(new Set(values).size).toBe(values.length)
  })
})

// A library is a place people click things. A javascript: URL stored by one
// member and opened by another is stored XSS with an audience.
describe('a link to a document', () => {
  it('accepts http and https', () => {
    expect(isSafeDocumentUrl('https://example.com/a.pdf')).toBe(true)
    expect(isSafeDocumentUrl('http://intranet/doc')).toBe(true)
  })

  it('refuses every scheme that is not', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'vbscript:msgbox',
      'file:///etc/passwd',
      'about:blank',
    ]) {
      expect(isSafeDocumentUrl(bad), bad).toBe(false)
    }
  })

  it('refuses nothing at all, and anything unparseable', () => {
    expect(isSafeDocumentUrl('')).toBe(false)
    expect(isSafeDocumentUrl('   ')).toBe(false)
    expect(isSafeDocumentUrl(null)).toBe(false)
    expect(isSafeDocumentUrl('not a url')).toBe(false)
  })
})

describe('where a document opens', () => {
  it('uses the uploaded file for an upload', () => {
    const doc = { source: SOURCE_UPLOAD, file: { url: 'https://cdn/x.pdf', name: 'x.pdf' } }
    expect(documentHref(doc)).toBe('https://cdn/x.pdf')
    expect(documentLabel(doc)).toBe('x.pdf')
    expect(hasDocument(doc)).toBe(true)
  })

  it('uses the link for a link, named by its host', () => {
    const doc = { source: SOURCE_LINK, linkUrl: 'https://www.sharepoint.com/a/b.pdf' }
    expect(documentHref(doc)).toBe('https://www.sharepoint.com/a/b.pdf')
    expect(documentLabel(doc)).toBe('sharepoint.com')
  })

  // The record must not become clickable just because a bad value was stored.
  it('opens nothing when the stored link is unsafe', () => {
    const doc = { source: SOURCE_LINK, linkUrl: 'javascript:alert(1)' }
    expect(documentHref(doc)).toBe('')
    expect(hasDocument(doc)).toBe(false)
    expect(documentLabel(doc)).toBe('')
  })

  it('is empty for a record that carries neither', () => {
    expect(hasDocument({})).toBe(false)
    expect(documentHref()).toBe('')
    expect(documentLabel({})).toBe('')
  })

  // A record filed as a link but still holding an old upload must not silently
  // fall back to the file — the source is what the author chose.
  it('does not fall back to a stale upload when the source is a link', () => {
    const doc = { source: SOURCE_LINK, linkUrl: '', file: { url: 'https://cdn/old.pdf' } }
    expect(documentHref(doc)).toBe('')
  })
})

describe('a folder for every site', () => {
  const sites = [
    { id: 's2', name: 'Plant 2' },
    { id: 's1', name: 'Alpha Depot' },
  ]

  it('files a site document under that site', () => {
    expect(documentFolder({ level: 'site', siteId: 's1' })).toBe(`${FOLDER_PREFIX}-s1`)
  })

  it('files everything else in the root folder', () => {
    expect(documentFolder({ level: 'org' })).toBe(FOLDER_PREFIX)
    expect(documentFolder({ level: 'region', region: 'South' })).toBe(FOLDER_PREFIX)
    expect(documentFolder({})).toBe(FOLDER_PREFIX)
  })

  // A site level with no site named is a half-finished record, not a folder.
  it('does not invent a folder from a blank site id', () => {
    expect(documentFolder({ level: 'site', siteId: '   ' })).toBe(FOLDER_PREFIX)
  })

  // The whole point: an empty folder says "nothing has been filed for this
  // site", which is the finding an audit is looking for. A view built only from
  // documents that exist can never show an absence.
  it('lists every site, including the ones with nothing in them', () => {
    const { folders } = siteFolders(sites, [{ level: 'site', siteId: 's1' }])
    expect(folders.map((f) => [f.name, f.count])).toEqual([['Alpha Depot', 1], ['Plant 2', 0]])
  })

  it('counts everything not filed to a site as organization-wide', () => {
    const { orgWide } = siteFolders(sites, [
      { level: 'org' }, { level: 'region' }, { level: 'site', siteId: 's1' },
    ])
    expect(orgWide).toBe(2)
  })

  it('copes with no sites and no documents', () => {
    expect(siteFolders()).toEqual({ folders: [], orgWide: 0 })
    expect(siteFolders(sites, [null]).folders).toHaveLength(2)
  })
})

describe('narrowing by region, entity and site', () => {
  const sites = [
    { id: 's1', name: 'Alpha', region: 'South', entity: 'COCO' },
    { id: 's2', name: 'Beta', region: 'North', entity: 'FOFO' },
  ]
  const at = (level, extra = {}) => ({ level, ...extra })

  it('matches everything when nothing is chosen', () => {
    expect(matchesScope(at('site', { siteId: 's1' }), {}, sites)).toBe(true)
  })

  it('narrows a site document by its own site', () => {
    expect(matchesScope(at('site', { siteId: 's1' }), { siteId: 's1' }, sites)).toBe(true)
    expect(matchesScope(at('site', { siteId: 's2' }), { siteId: 's1' }, sites)).toBe(false)
  })

  // Entity and region are answered through the registry, because a document has
  // no entity of its own — its site does.
  it('narrows a site document by the region and entity of its site', () => {
    expect(matchesScope(at('site', { siteId: 's1' }), { region: 'South' }, sites)).toBe(true)
    expect(matchesScope(at('site', { siteId: 's1' }), { region: 'North' }, sites)).toBe(false)
    expect(matchesScope(at('site', { siteId: 's1' }), { entity: 'COCO' }, sites)).toBe(true)
    expect(matchesScope(at('site', { siteId: 's1' }), { entity: 'FOFO' }, sites)).toBe(false)
  })

  it('combines them', () => {
    expect(matchesScope(at('site', { siteId: 's1' }), { region: 'South', entity: 'COCO' }, sites)).toBe(true)
    expect(matchesScope(at('site', { siteId: 's1' }), { region: 'South', entity: 'FOFO' }, sites)).toBe(false)
  })

  // Losing the org-wide policy the moment you look at one site is how somebody
  // concludes that site has no policy.
  it('keeps an org-wide document under every narrowing', () => {
    expect(matchesScope(at('org'), { siteId: 's1', region: 'South', entity: 'COCO' }, sites)).toBe(true)
  })

  it('answers a region question for a region document, and nothing narrower', () => {
    const doc = at('region', { region: 'South' })
    expect(matchesScope(doc, { region: 'South' }, sites)).toBe(true)
    expect(matchesScope(doc, { region: 'North' }, sites)).toBe(false)
    // It names a region, not a site, so it cannot be attributed to one.
    expect(matchesScope(doc, { siteId: 's1' }, sites)).toBe(false)
    expect(matchesScope(doc, { entity: 'COCO' }, sites)).toBe(false)
  })

  it('does not throw on a site that has left the registry', () => {
    expect(matchesScope(at('site', { siteId: 'gone' }), { region: 'South' }, sites)).toBe(false)
    expect(matchesScope(null, { region: 'South' }, sites)).toBe(false)
  })
})

describe('the snapshot the rules read is what the filter reads', () => {
  // classificationFields stamps siteRegion/siteEntity onto the document, and
  // firestore.rules decides who may READ the row from those same fields. If the
  // filter used a different source the two could disagree about which region a
  // document is in — the filter showing a row the rule would refuse.
  it('prefers the document snapshot over the registry', () => {
    const doc = { level: 'site', siteId: 's1', siteRegion: 'South', siteEntity: 'COCO' }
    expect(matchesScope(doc, { region: 'South' }, [])).toBe(true)
    expect(matchesScope(doc, { entity: 'COCO' }, [])).toBe(true)
    // A site since moved to another region does not retro-move its documents.
    expect(matchesScope(doc, { region: 'South' }, [{ id: 's1', region: 'North' }])).toBe(true)
  })

  it('falls back to the registry for a document written before the snapshot', () => {
    const legacy = { level: 'site', siteId: 's1' }
    expect(matchesScope(legacy, { region: 'South' }, [{ id: 's1', region: 'South' }])).toBe(true)
    expect(matchesScope(legacy, { region: 'North' }, [{ id: 's1', region: 'South' }])).toBe(false)
  })
})

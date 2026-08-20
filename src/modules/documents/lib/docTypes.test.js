import { describe, it, expect } from 'vitest'
import {
  DOC_TYPES, docTypeTone, docTypeLabel,
  SOURCE_UPLOAD, SOURCE_LINK, isSafeDocumentUrl, documentHref, hasDocument,
  documentLabel, storageKindFor, FOLDER_PREFIX,
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

describe('where a file is uploaded', () => {
  // One storage folder per REGION, plus one for org level — NOT one per folder
  // in the tree. The tree lives in Firestore and can be reorganised freely; the
  // bytes stay where they were put.
  it('gives org level, and anything with no region, its own folder', () => {
    expect(storageKindFor(null)).toBe(`${FOLDER_PREFIX}-org`)
    expect(storageKindFor('')).toBe(`${FOLDER_PREFIX}-org`)
    expect(storageKindFor('   ')).toBe(`${FOLDER_PREFIX}-org`)
  })

  it('gives a region one folder for everything beneath it', () => {
    expect(storageKindFor('South')).toBe(`${FOLDER_PREFIX}-region-South`)
  })

  // storagePath() sanitises every segment the same way; computing it here means
  // the folder recorded on the document is the path the file actually went to.
  it('sanitises a region name exactly as the path builder would', () => {
    expect(storageKindFor('South East / 2')).toBe(`${FOLDER_PREFIX}-region-South_East___2`)
  })

  // A name that sanitises to nothing would make storagePath throw, which would
  // fail the upload rather than merely misfile it.
  it('never produces a segment that carries no information', () => {
    expect(storageKindFor('北部')).toBe(`${FOLDER_PREFIX}-region`)
  })
})

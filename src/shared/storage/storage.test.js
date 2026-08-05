import { describe, it, expect } from 'vitest'
import { safeFileName, storagePath, dataUrlToBlob } from './index'

describe('safeFileName', () => {
  it('keeps an ordinary filename readable', () => {
    expect(safeFileName('Fire Safety SOP v2.pdf')).toBe('Fire Safety SOP v2.pdf')
  })

  it('strips path separators and URL-hostile characters', () => {
    // A filename must never be able to climb the path or smuggle a query.
    expect(safeFileName('../../etc/passwd')).not.toContain('/')
    expect(safeFileName('a?b#c%d[e]f{g}h')).not.toMatch(/[?#%[\]{}]/)
  })

  it('never returns empty, whatever it is given', () => {
    for (const bad of ['', null, undefined, '///', '???']) {
      expect(safeFileName(bad).length).toBeGreaterThan(0)
    }
  })

  it('caps length so a pasted essay cannot become a path segment', () => {
    expect(safeFileName('x'.repeat(500)).length).toBeLessThanOrEqual(120)
  })
})

describe('storagePath', () => {
  const fixed = () => 'abcd1234'

  it('scopes by org first — that is what the storage rules match on', () => {
    expect(storagePath('org1', 'training-content', 'a.pdf', fixed)).toBe(
      'orgs/org1/training-content/abcd1234-a.pdf'
    )
  })

  it('two identical filenames get different paths', () => {
    const a = storagePath('o', 'k', 'photo.jpg')
    const b = storagePath('o', 'k', 'photo.jpg')
    expect(a).not.toBe(b)
  })

  it('refuses to build an unscoped path', () => {
    // A file outside /orgs/{orgId}/ would be invisible to the tenancy rules.
    expect(() => storagePath('', 'k', 'a')).toThrow()
    expect(() => storagePath('o', '', 'a')).toThrow()
  })
})

// jsdom's Blob has no .text(); FileReader is the reader it does implement.
const readBlob = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(r.result)
  r.onerror = reject
  r.readAsText(blob)
})

describe('dataUrlToBlob', () => {
  it('round-trips a base64 data URL with its content type', async () => {
    const blob = dataUrlToBlob('data:text/plain;base64,aGVsbG8=')
    expect(blob.type).toBe('text/plain')
    expect(await readBlob(blob)).toBe('hello')
  })

  it('handles the URL-encoded (non-base64) form', async () => {
    const blob = dataUrlToBlob('data:text/plain,hello%20world')
    expect(await readBlob(blob)).toBe('hello world')
  })

  it('defaults the content type rather than inventing one', () => {
    expect(dataUrlToBlob('data:;base64,aGk=').type).toBe('application/octet-stream')
  })

  it('returns null for anything that is not a data URL', () => {
    for (const bad of ['https://x/y.png', 'hello', '', null, 'data:text/plain;base64,%%%']) {
      expect(dataUrlToBlob(bad)).toBeNull()
    }
  })
})

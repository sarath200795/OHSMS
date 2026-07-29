import { describe, it, expect } from 'vitest'
import { generateQrToken, tokenFromQrValue } from './qr'

describe('generateQrToken', () => {
  it('produces a URL-safe token', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateQrToken()).toMatch(/^[a-z0-9]+$/)
    }
  })

  it('does not collide across many draws', () => {
    const seen = new Set()
    for (let i = 0; i < 500; i += 1) seen.add(generateQrToken())
    expect(seen.size).toBe(500)
  })

  it('round-trips through tokenFromQrValue', () => {
    const t = generateQrToken()
    expect(tokenFromQrValue(`https://example.com/qr/${t}`)).toBe(t)
  })
})

describe('tokenFromQrValue', () => {
  it('extracts the token from a full QR URL', () => {
    expect(tokenFromQrValue('https://weehs-4eb28.web.app/qr/AB12CD34')).toBe('AB12CD34')
  })

  it('accepts a bare token', () => {
    expect(tokenFromQrValue('AB12CD34')).toBe('AB12CD34')
  })

  it('ignores a query string or fragment', () => {
    expect(tokenFromQrValue('https://x.io/qr/TOK123?src=label')).toBe('TOK123')
    expect(tokenFromQrValue('https://x.io/qr/TOK123#top')).toBe('TOK123')
  })

  it('tolerates a trailing slash', () => {
    expect(tokenFromQrValue('https://x.io/qr/TOK123/')).toBe('TOK123')
  })

  it('handles a legacy path shape from another system', () => {
    expect(tokenFromQrValue('https://old-vendor.com/assets/view/EXT-99881')).toBe('EXT-99881')
  })

  it('trims surrounding whitespace from a spreadsheet cell', () => {
    expect(tokenFromQrValue('  AB12CD34  ')).toBe('AB12CD34')
  })

  it('returns empty for a blank value, so a new token is minted', () => {
    for (const v of ['', '   ', null, undefined]) expect(tokenFromQrValue(v)).toBe('')
  })

  it('rejects a value too short to be a real token', () => {
    expect(tokenFromQrValue('ab')).toBe('')
  })

  it('rejects characters that would break a Firestore document id', () => {
    expect(tokenFromQrValue('has space')).toBe('')
    expect(tokenFromQrValue('semi;colon')).toBe('')
  })

  it('rejects a URL with no usable final segment', () => {
    expect(tokenFromQrValue('https://example.com/')).toBe('')
  })
})

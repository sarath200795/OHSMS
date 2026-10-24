import { describe, expect, it } from 'vitest'
import { parseQrPayload, routeForScan } from './qrPayload'

describe('parseQrPayload', () => {
  it('reads an equipment label from either host this app has used', () => {
    expect(parseQrPayload('https://suite.weehs.org/qr/AB12CD34')).toEqual({
      kind: 'equipment',
      token: 'AB12CD34',
    })
    expect(parseQrPayload('https://weehs-4eb28.web.app/qr/AB12CD34')).toEqual({
      kind: 'equipment',
      token: 'AB12CD34',
    })
  })

  it('reads a relative path and ignores a query or fragment on the token', () => {
    expect(parseQrPayload('/qr/TOK123?src=label')).toEqual({ kind: 'equipment', token: 'TOK123' })
    expect(parseQrPayload('https://suite.weehs.org/qr/TOK123#top')).toEqual({
      kind: 'equipment',
      token: 'TOK123',
    })
    expect(parseQrPayload('https://suite.weehs.org/qr/TOK123/')).toEqual({
      kind: 'equipment',
      token: 'TOK123',
    })
  })

  it('accepts a bare token, which is what a copied label line looks like', () => {
    expect(parseQrPayload('  AB12CD34  ')).toEqual({ kind: 'equipment', token: 'AB12CD34' })
  })

  it('routes the other codes this app prints', () => {
    expect(parseQrPayload('https://suite.weehs.org/permit/aa11bb22')).toEqual({
      kind: 'permit',
      token: 'aa11bb22',
    })
    expect(parseQrPayload('https://suite.weehs.org/p/PROC1234')).toEqual({
      kind: 'procedure',
      id: 'PROC1234',
    })
    expect(parseQrPayload('https://suite.weehs.org/t/PROC1234/E-1')).toEqual({
      kind: 'tag',
      id: 'PROC1234',
      point: 'E-1',
    })
  })

  it('does not adopt another system just because the url has a last segment', () => {
    // tokenFromQrValue would return EXT-99881. A camera must not.
    expect(parseQrPayload('https://old-vendor.com/assets/view/EXT-99881')).toEqual({
      kind: 'unknown',
    })
    expect(parseQrPayload('https://example.com/')).toEqual({ kind: 'unknown' })
    expect(parseQrPayload('https://example.com/qr/')).toEqual({ kind: 'unknown' })
  })

  it('refuses a token too short to be one of ours, and a non-http scheme', () => {
    expect(parseQrPayload('https://suite.weehs.org/qr/ab')).toEqual({ kind: 'unknown' })
    expect(parseQrPayload('javascript:alert(1)')).toEqual({ kind: 'unknown' })
    expect(parseQrPayload('')).toEqual({ kind: 'empty' })
    expect(parseQrPayload('   ')).toEqual({ kind: 'empty' })
  })

  it('does not let a dot-segment climb out of the route', () => {
    expect(parseQrPayload('https://evil.test/qr/..')).toEqual({ kind: 'unknown' })
    expect(parseQrPayload('https://evil.test/qr/../admin')).toEqual({ kind: 'unknown' })
  })
})

describe('routeForScan', () => {
  it('opens a signed-in equipment scan on the asset page, not the public sticker', () => {
    const parsed = parseQrPayload('https://suite.weehs.org/qr/AB12CD34')
    expect(routeForScan(parsed)).toBe('/field/asset/AB12CD34')
  })

  it('keeps permit, procedure and tag scans on the routes those codes already use', () => {
    expect(routeForScan(parseQrPayload('https://x/permit/aa11bb22'))).toBe('/permit/aa11bb22')
    expect(routeForScan(parseQrPayload('https://x/p/PROC1234'))).toBe('/p/PROC1234')
    expect(routeForScan(parseQrPayload('https://x/t/PROC1234/E-1'))).toBe('/t/PROC1234/E-1')
  })

  it('returns null for anything it does not recognise, and never an absolute url', () => {
    expect(routeForScan(parseQrPayload('https://evil.test/login'))).toBeNull()
    expect(routeForScan(parseQrPayload('javascript:alert(1)'))).toBeNull()
    expect(routeForScan({ kind: 'empty' })).toBeNull()
    const samples = [
      'https://suite.weehs.org/qr/AB12CD34',
      'https://suite.weehs.org/permit/aa11bb22',
      'https://suite.weehs.org/p/PROC1234',
      'https://suite.weehs.org/t/PROC1234/E-1',
      'https://evil.test/phish',
    ]
    for (const sample of samples) {
      const to = routeForScan(parseQrPayload(sample))
      if (to) {
        expect(to.startsWith('/')).toBe(true)
        expect(to.startsWith('//')).toBe(false)
        expect(to.includes('://')).toBe(false)
      }
    }
  })
})

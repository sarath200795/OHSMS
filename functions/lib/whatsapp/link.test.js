import { describe, it, expect } from 'vitest'
import {
  generateLinkCode,
  hashLinkCode,
  redeemable,
  phoneHash,
  inboundId,
  maskPhone,
} from './link.js'

describe('link codes', () => {
  it('are six digits with leading zeros kept', () => {
    expect(generateLinkCode(() => 42)).toBe('000042')
    expect(generateLinkCode()).toMatch(/^\d{6}$/)
  })
  it('are stored only as a digest', () => {
    expect(hashLinkCode('123456')).toMatch(/^[0-9a-f]{64}$/)
    expect(hashLinkCode('123456')).not.toContain('123456')
  })
  it('redeem only while unexpired and well-formed', () => {
    const now = 1_000_000
    expect(redeemable({ uid: 'u', orgId: 'o', expiresAtMs: now + 1 }, now)).toEqual({ ok: true })
    expect(redeemable({ uid: 'u', orgId: 'o', expiresAtMs: now }, now).reason).toBe('expired')
    expect(redeemable(null, now).reason).toBe('missing')
    expect(redeemable({ uid: '', orgId: 'o', expiresAtMs: now + 1 }, now).reason).toBe('malformed')
  })
})

describe('phone handling', () => {
  it('hashes with a key, so the digest depends on it', () => {
    expect(phoneHash('k1', '919000000001')).not.toBe(phoneHash('k2', '919000000001'))
    expect(phoneHash('k1', '919000000001')).not.toContain('9000')
  })
  it('makes a path-safe ledger id from any wamid', () => {
    expect(inboundId('wamid.HBg/abc==')).toMatch(/^[0-9a-f]{64}$/)
  })
  it('masks all but the last four digits', () => {
    expect(maskPhone('919000004821')).toBe('•••• 4821')
  })
})

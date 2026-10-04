import { describe, it, expect } from 'vitest'
import { formatPermitNo, parsePermitNo, permitSeqKind, permitYearNow } from './permitNumber'

describe('permit numbers', () => {
  it('pads to four digits and lets wider ones grow', () => {
    expect(formatPermitNo(2026, 7)).toBe('LP-2026-0007')
    expect(formatPermitNo(2026, 12345)).toBe('LP-2026-12345')
  })
  it('round-trips', () => {
    expect(parsePermitNo('LP-2026-0042')).toEqual({ year: 2026, seq: 42 })
  })
  it('refuses a malformed number', () => {
    for (const bad of ['', 'LP-26-1', 'lp-2026-0001', 'LP-2026-001', 'LP-2026-0001/x', null]) {
      expect(parsePermitNo(bad), String(bad)).toBeNull()
    }
  })
  it('refuses to format nonsense', () => {
    expect(() => formatPermitNo(2026, 0)).toThrow()
    expect(() => formatPermitNo('x', 1)).toThrow()
  })
  it('keeps one counter per year', () => {
    expect(permitSeqKind(2026)).toBe('lotoPermit-2026')
  })
  it('uses the UTC year, which is what the rules compare against', () => {
    expect(permitYearNow(new Date('2026-12-31T20:00:00Z'))).toBe(2026)
    expect(permitYearNow(new Date('2027-01-01T00:00:00Z'))).toBe(2027)
  })
})

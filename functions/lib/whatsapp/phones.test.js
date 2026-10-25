import { describe, expect, it } from 'vitest'
import { canonicalWaId, waIdLookupKeys } from './phones.js'

describe('canonicalWaId', () => {
  it('matches the digits Meta puts in from', () => {
    expect(canonicalWaId('917712345678')).toBe('917712345678')
    expect(canonicalWaId('+91 77123 45678')).toBe('917712345678')
    expect(canonicalWaId('7712345678')).toBe('917712345678')
    expect(canonicalWaId('07712345678')).toBe('917712345678')
    expect(canonicalWaId('00917712345678')).toBe('917712345678')
    expect(canonicalWaId('9107712345678')).toBe('917712345678')
    expect(canonicalWaId('+917712345678')).toBe('917712345678')
  })

  it('keeps another country code and refuses prose or a short local number', () => {
    expect(canonicalWaId('441234567890')).toBe('441234567890')
    expect(canonicalWaId('+44 1234 567890')).toBe('441234567890')
    expect(canonicalWaId('call me on 917712345678')).toBe('')
    expect(canonicalWaId('12345')).toBe('')
    expect(canonicalWaId('1234567890')).toBe('')
    expect(canonicalWaId('')).toBe('')
    expect(canonicalWaId(null)).toBe('')
  })
})

describe('waIdLookupKeys', () => {
  it('tries the spelling Meta sends before the ones already stored', () => {
    const keys = waIdLookupKeys('917712345678')
    expect(keys[0]).toBe('917712345678')
    expect(keys).toEqual(
      expect.arrayContaining(['+917712345678', '7712345678', '07712345678', '9107712345678'])
    )
    expect(keys.every((key) => !key.includes('/'))).toBe(true)
    expect(waIdLookupKeys('+91 77123 45678')).toContain('917712345678')
    expect(waIdLookupKeys('7712345678')[0]).toBe('917712345678')
  })
})

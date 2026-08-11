import { describe, it, expect, vi } from 'vitest'

// The module reaches for the initialised Firebase app at import time, which a
// unit test has no business booting.
vi.mock('../firebase', () => ({ auth: {} }))

const { isMfaRequired, needsRecentLogin, cleanCode, isCodeComplete, totpHintFrom, enrolledFactors, canReauthWithPassword } =
  await import('./mfa')

describe('isMfaRequired', () => {
  // The single most important line in the feature: mistake this for a failure
  // and the account is unreachable rather than protected.
  it('recognises the challenge', () => {
    expect(isMfaRequired({ code: 'auth/multi-factor-auth-required' })).toBe(true)
  })

  it('does not mistake a real failure for one', () => {
    expect(isMfaRequired({ code: 'auth/wrong-password' })).toBe(false)
    expect(isMfaRequired(new Error('boom'))).toBe(false)
    expect(isMfaRequired(null)).toBe(false)
    expect(isMfaRequired(undefined)).toBe(false)
  })

  it('recognises the stale-login code separately', () => {
    expect(needsRecentLogin({ code: 'auth/requires-recent-login' })).toBe(true)
    expect(needsRecentLogin({ code: 'auth/multi-factor-auth-required' })).toBe(false)
  })
})

describe('cleanCode', () => {
  // Authenticator apps display "123 456" and people paste exactly that.
  it('keeps only digits', () => {
    expect(cleanCode('123 456')).toBe('123456')
    expect(cleanCode('123-456')).toBe('123456')
    expect(cleanCode(' 123456 ')).toBe('123456')
  })

  it('survives nothing at all', () => {
    expect(cleanCode('')).toBe('')
    expect(cleanCode(null)).toBe('')
    expect(cleanCode(undefined)).toBe('')
  })

  it('preserves leading zeros, which a numeric input would eat', () => {
    expect(cleanCode('001234')).toBe('001234')
  })
})

describe('isCodeComplete', () => {
  it('is true only at exactly six digits', () => {
    expect(isCodeComplete('123456')).toBe(true)
    expect(isCodeComplete('12 34 56')).toBe(true)
    expect(isCodeComplete('12345')).toBe(false)
    expect(isCodeComplete('1234567')).toBe(false)
    expect(isCodeComplete('')).toBe(false)
  })
})

describe('totpHintFrom', () => {
  const totp = { factorId: 'totp', uid: 'f1' }
  const phone = { factorId: 'phone', uid: 'f2' }

  // Picked by looking, not by index — an account can carry factors enrolled
  // elsewhere, and answering the wrong one fails with an opaque SDK error.
  it('finds the TOTP factor whatever its position', () => {
    expect(totpHintFrom({ hints: [phone, totp] })).toBe(totp)
    expect(totpHintFrom({ hints: [totp] })).toBe(totp)
  })

  it('returns null when there is no TOTP factor to answer', () => {
    expect(totpHintFrom({ hints: [phone] })).toBeNull()
    expect(totpHintFrom({ hints: [] })).toBeNull()
    expect(totpHintFrom(null)).toBeNull()
  })
})

describe('enrolledFactors', () => {
  it('is empty rather than throwing when there is no user', () => {
    expect(enrolledFactors(null)).toEqual([])
    expect(enrolledFactors(undefined)).toEqual([])
  })
})

describe('canReauthWithPassword', () => {
  // A federated account has no password to re-enter, so asking for one would be
  // an unanswerable prompt.
  it('is true for a password account', () => {
    expect(canReauthWithPassword({ email: 'a@b.co', providerData: [{ providerId: 'password' }] })).toBe(true)
  })

  it('is false for an SSO-only account', () => {
    expect(canReauthWithPassword({ email: 'a@b.co', providerData: [{ providerId: 'saml.acme' }] })).toBe(false)
  })

  it('is false when there is nothing to go on', () => {
    expect(canReauthWithPassword(null)).toBe(false)
    expect(canReauthWithPassword({})).toBe(false)
  })
})

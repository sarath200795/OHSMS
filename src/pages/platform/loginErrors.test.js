import { describe, it, expect } from 'vitest'
import { operatorLoginMessage, REFUSED } from './loginErrors'

describe('operatorLoginMessage', () => {
  // The property the page exists to hold: nothing about the account leaks,
  // including whether it is one of the few that can reconfigure every customer.
  it('gives one sentence for every account-related failure', () => {
    const codes = [
      'auth/user-not-found',
      'auth/wrong-password',
      'auth/invalid-credential',
      'auth/invalid-login-credentials',
      'auth/invalid-email',
      'auth/user-disabled',
      'auth/operation-not-allowed',
      'auth/account-exists-with-different-credential',
    ]
    for (const code of codes) {
      expect(operatorLoginMessage({ code })).toBe(REFUSED)
    }
  })

  // A wrong password and a valid password on a non-operator account must be
  // indistinguishable. The second is not an error at all — the component sets
  // REFUSED directly — so this pins that both spell the same string.
  it('is the same sentence the no-grant path uses', () => {
    expect(operatorLoginMessage({ code: 'auth/wrong-password' })).toBe(REFUSED)
    expect(REFUSED).toBe('That account cannot sign in here.')
  })

  // The allowlist is the whole design: a code nobody has heard of must not be
  // able to talk, or a future SDK version quietly reopens the leak.
  it('refuses to repeat an unknown code, and never Firebase\'s raw message', () => {
    const raw = 'Firebase: Error (auth/requests-from-referer-https://example.web.app-are-blocked.).'
    expect(operatorLoginMessage({ code: 'auth/some-code-invented-next-year', message: raw })).toBe(REFUSED)
    expect(operatorLoginMessage({ message: raw })).toBe(REFUSED)
    expect(operatorLoginMessage({ code: 'auth/requests-from-referer-are-blocked', message: raw })).toBe(REFUSED)
  })

  it('handles junk without leaking it', () => {
    expect(operatorLoginMessage(null)).toBe(REFUSED)
    expect(operatorLoginMessage(undefined)).toBe(REFUSED)
    // authErrorMessage passes a bare string straight through; this must not.
    expect(operatorLoginMessage('something went wrong deep inside')).toBe(REFUSED)
  })

  // Operational failures still have to be actionable. Telling someone their
  // account cannot sign in when their connection dropped costs them an
  // afternoon chasing the wrong thing.
  it('lets request-level failures speak for themselves', () => {
    expect(operatorLoginMessage({ code: 'auth/network-request-failed' })).toMatch(/network/i)
    expect(operatorLoginMessage({ code: 'auth/too-many-requests' })).toMatch(/too many/i)
  })

  // Reaching a code prompt means the password was already accepted, so these
  // reveal nothing the person does not already hold.
  it('lets second-factor failures speak, since the password already passed', () => {
    expect(operatorLoginMessage({ code: 'auth/invalid-verification-code' })).toMatch(/code/i)
    expect(operatorLoginMessage({ code: 'auth/code-expired' })).toMatch(/expired/i)
    for (const code of ['auth/missing-code', 'auth/totp-challenge-timeout']) {
      expect(operatorLoginMessage({ code })).not.toBe(REFUSED)
    }
  })
})

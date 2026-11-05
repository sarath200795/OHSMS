import { describe, it, expect, vi } from 'vitest'
import {
  replacementError,
  authIsFresh,
  commitmentOf,
  signInEndpoint,
  classifySignInResponse,
  postPasswordSignIn,
  applyPasswordChange,
  PASSWORD_GATE_FRESH_MS,
} from './passwordGate.js'

const NOW = 1_700_000_000_000
const TEMP = 'temp-password-1'
const NEXT = 'river-lantern-42'

function harness() {
  const calls = []
  const state = { flag: true, marker: null }
  const api = {
    uid: 'user-1',
    authTime: NOW / 1000,
    now: NOW,
    email: 'ada@plant.example',
    name: 'Ada',
    current: TEMP,
    password: NEXT,
    signIn: vi.fn(async (_email, password) => (password === TEMP ? 'current' : 'not-current')),
    updatePassword: vi.fn(async () => { calls.push('update') }),
    writeMarker: vi.fn(async (_uid, marker) => { state.marker = marker }),
    clearFlag: vi.fn(async () => { state.flag = false; calls.push('clear') }),
    deleteMarker: vi.fn(async () => { state.marker = null; calls.push('delete-marker') }),
  }
  return {
    calls,
    state,
    api,
    // flag and marker are read at call time. The decision must see the marker
    // the previous attempt wrote, not the empty one from when the harness was built.
    run: () => applyPasswordChange({ ...api, flag: state.flag, marker: state.marker }),
  }
}

describe('replacementError', () => {
  it('accepts a long password and rejects the temporary-password failures', () => {
    expect(replacementError(NEXT, { email: 'ada@plant.example', name: 'Ada' })).toBe('')
    expect(replacementError('short')).toMatch(/10/)
    expect(replacementError('changeme-xyz')).toMatch(/easy to guess/)
    expect(replacementError('worker-secret', { email: 'worker@plant.example' })).toMatch(/email/)
    expect(replacementError(12345678901)).toMatch(/Enter a password/)
  })
})

describe('authIsFresh', () => {
  it('accepts this sign-in and rejects a stale one, a missing time, and a far-future time', () => {
    const authTime = NOW / 1000
    expect(authIsFresh(authTime, NOW)).toBe(true)
    expect(authIsFresh(authTime - 4 * 60, NOW)).toBe(true)
    expect(authIsFresh(authTime - PASSWORD_GATE_FRESH_MS / 1000 - 5, NOW)).toBe(false)
    expect(authIsFresh(undefined, NOW)).toBe(false)
    expect(authIsFresh(authTime + 120, NOW)).toBe(false)
  })
})

describe('sign-in classification', () => {
  it('treats a 200 as the current password and a wrong password as not current', () => {
    expect(classifySignInResponse(200, '')).toBe('current')
    expect(classifySignInResponse(400, 'INVALID_PASSWORD')).toBe('not-current')
    expect(classifySignInResponse(400, 'INVALID_LOGIN_CREDENTIALS')).toBe('not-current')
  })

  it('does not treat a blocked key, a revoke-shaped error, or a transport failure as a wrong password', () => {
    expect(classifySignInResponse(403, 'API_KEY_HTTP_REFERRER_BLOCKED')).toBe('unavailable')
    expect(classifySignInResponse(400, 'TOKEN_EXPIRED')).toBe('unavailable')
    expect(classifySignInResponse(500, '')).toBe('unavailable')
    expect(classifySignInResponse(400, 'USER_DISABLED')).toBe('unavailable')
  })

  it('builds the emulator url without a real key, and no url at all when production has none', () => {
    expect(signInEndpoint({ emulatorHost: '127.0.0.1:9099' })).toContain('http://127.0.0.1:9099/')
    expect(signInEndpoint({ emulatorHost: '127.0.0.1:9099' })).toContain('key=emulator')
    expect(signInEndpoint({ apiKey: '' })).toBeNull()
    expect(signInEndpoint({ apiKey: 'public-web-key' })).toContain('key=public-web-key')
  })

  it('discards a successful body and classifies a wrong password from the error code only', async () => {
    const ok = {
      ok: true,
      text: vi.fn(async () => '{"idToken":"should-not-surface","refreshToken":"no"}'),
      json: vi.fn(),
    }
    expect(await postPasswordSignIn(vi.fn(async () => ok), 'http://auth/signIn', 'a@b.c', TEMP)).toBe('current')
    expect(ok.json).not.toHaveBeenCalled()

    const bad = {
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'INVALID_PASSWORD' } }),
    }
    expect(await postPasswordSignIn(async () => bad, 'http://auth/signIn', 'a@b.c', 'nope')).toBe('not-current')
    expect(await postPasswordSignIn(async () => { throw new Error('down') }, 'http://auth/signIn', 'a@b.c', TEMP))
      .toBe('unavailable')
    expect(await postPasswordSignIn(async () => bad, null, 'a@b.c', TEMP)).toBe('unavailable')
  })
})

describe('applyPasswordChange', () => {
  it('replaces the password and only then clears the flag', async () => {
    const h = harness()
    const order = []
    h.api.updatePassword = vi.fn(async () => { order.push('update') })
    h.api.clearFlag = vi.fn(async () => { order.push('clear'); h.state.flag = false })
    expect(await h.run()).toEqual({ ok: true, reason: 'replaced' })
    expect(order).toEqual(['update', 'clear'])
    expect(h.state.flag).toBe(false)
    expect(h.state.marker).toBeNull()
  })

  it('does not clear when the proposed password is the one that just signed in', async () => {
    const h = harness()
    h.api.password = TEMP
    expect(await h.run()).toEqual({ ok: false, reason: 'unchanged' })
    expect(h.api.updatePassword).not.toHaveBeenCalled()
    expect(h.api.clearFlag).not.toHaveBeenCalled()
    expect(h.state.flag).toBe(true)
  })

  it('does not clear on a fresh reauth, a token refresh, or a revocation by themselves', async () => {
    // Those events are not arguments. A fresh auth_time with the same
    // password — what reauth produces — is still unchanged. Refresh and
    // revoke never reach this function; calling it afterwards changes nothing
    // unless the password string did.
    const h = harness()
    h.api.password = TEMP
    h.api.authTime = NOW / 1000
    expect((await h.run()).reason).toBe('unchanged')
    expect(h.state.flag).toBe(true)
  })

  it('rejects a stale session even when the password would have been replaced', async () => {
    const h = harness()
    h.api.authTime = NOW / 1000 - PASSWORD_GATE_FRESH_MS / 1000 - 10
    expect(await h.run()).toEqual({ ok: false, reason: 'stale' })
    expect(h.api.signIn).not.toHaveBeenCalled()
    expect(h.api.updatePassword).not.toHaveBeenCalled()
    expect(h.state.flag).toBe(true)
  })

  it('rejects a missing caller, a wrong current password, and a sign-in it could not perform', async () => {
    const missing = harness()
    missing.api.uid = ''
    expect((await missing.run()).reason).toBe('unauthenticated')

    const wrong = harness()
    wrong.api.signIn = vi.fn(async () => 'not-current')
    expect((await wrong.run()).reason).toBe('current-rejected')
    expect(wrong.api.updatePassword).not.toHaveBeenCalled()

    const down = harness()
    down.api.signIn = vi.fn(async () => 'unavailable')
    expect((await down.run()).reason).toBe('unavailable')
    expect(down.api.updatePassword).not.toHaveBeenCalled()
    expect(down.state.flag).toBe(true)
  })

  it('leaves the flag set when the password update fails', async () => {
    const h = harness()
    h.api.updatePassword = vi.fn(async () => { throw Object.assign(new Error('no'), { code: 'auth/x' }) })
    const out = await h.run()
    expect(out.reason).toBe('not-updated')
    expect(out.code).toBe('auth/x')
    expect(h.api.clearFlag).not.toHaveBeenCalled()
    expect(h.state.flag).toBe(true)
    expect(JSON.stringify(out)).not.toContain(NEXT)
  })

  it('keeps a committed marker so a failed flag write can be finished without a third password', async () => {
    const h = harness()
    h.api.clearFlag = vi.fn(async () => { throw Object.assign(new Error('no'), { code: 'unavailable' }) })
    expect((await h.run()).reason).toBe('flag-unchanged')
    expect(h.state.flag).toBe(true)
    expect(h.state.marker).toEqual({ sha256: commitmentOf(NEXT), committed: true })

    h.api.current = NEXT
    h.api.password = NEXT
    h.api.signIn = vi.fn(async (_email, password) => (password === NEXT ? 'current' : 'not-current'))
    h.api.clearFlag = vi.fn(async () => { h.state.flag = false })
    expect(await h.run()).toEqual({ ok: true, reason: 'replaced' })
    expect(h.api.updatePassword).toHaveBeenCalledTimes(1)
    expect(h.state.flag).toBe(false)
  })

  it('does not treat an uncommitted marker plus the old password as a completed change', async () => {
    const h = harness()
    h.state.marker = { sha256: commitmentOf(TEMP), committed: false }
    h.api.password = TEMP
    expect((await h.run()).reason).toBe('unchanged')
    expect(h.state.flag).toBe(true)
  })

  it('does not touch Auth when the flag is not set or the password is refused by policy', async () => {
    const open = harness()
    open.state.flag = false
    expect(await open.run()).toEqual({ ok: true, reason: 'not-required' })
    expect(open.api.signIn).not.toHaveBeenCalled()

    const weak = harness()
    weak.api.password = 'password'
    expect((await weak.run()).reason).toBe('policy')
    expect(weak.api.signIn).not.toHaveBeenCalled()
    expect(weak.state.flag).toBe(true)
  })

  it('never returns the password or the commitment', async () => {
    const h = harness()
    const out = await h.run()
    const dumped = JSON.stringify(out)
    expect(dumped).not.toContain(TEMP)
    expect(dumped).not.toContain(NEXT)
    expect(dumped).not.toContain(commitmentOf(NEXT))
  })
})

import { describe, it, expect, vi } from 'vitest'
import {
  replacementError,
  authIsFresh,
  lockState,
  gateLockShouldDrop,
  safeAuthCode,
  authErrorCode,
  signInEndpoint,
  classifySignInResponse,
  postPasswordSignIn,
  applyPasswordChange,
  createSerialLock,
  PASSWORD_GATE_FRESH_MS,
  PASSWORD_GATE_LOCK_MS,
} from './passwordGate.js'

const NOW = 1_700_000_000_000
const TEMP = 'temp-password-1'
const NEXT = 'river-lantern-42'

function harness() {
  const calls = []
  const state = { flag: true, account: TEMP }
  const lock = createSerialLock(() => NOW)
  const api = {
    uid: 'user-1',
    authTime: NOW / 1000,
    now: NOW,
    email: 'ada@plant.example',
    name: 'Ada',
    current: TEMP,
    password: NEXT,
    signIn: vi.fn(async (_email, password) => (password === state.account ? 'current' : 'not-current')),
    updatePassword: vi.fn(async (_id, password) => {
      state.account = password
      calls.push('update')
    }),
    claimLock: (record) => lock.claimLock(record),
    commitLock: (id, exp) => lock.commitLock(id, exp),
    releaseLock: (id) => lock.releaseLock(id),
    clearFlag: vi.fn(async () => { state.flag = false; calls.push('clear') }),
  }
  return {
    calls,
    state,
    lock,
    api,
    run: () => applyPasswordChange({
      ...api,
      flag: state.flag,
      marker: lock.read(),
    }),
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
      json: async () => ({ error: { message: `INVALID_PASSWORD : ${TEMP}` } }),
    }
    const wrong = await postPasswordSignIn(async () => bad, 'http://auth/signIn', 'a@b.c', 'nope')
    expect(wrong).toBe('not-current')
    expect(wrong).not.toContain(TEMP)
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
    expect(h.lock.read()).toBeNull()
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

  it('leaves the flag set and drops the lock when the password update fails', async () => {
    const h = harness()
    h.api.updatePassword = vi.fn(async () => {
      throw Object.assign(new Error(`refused ${NEXT}`), { code: 'auth/x' })
    })
    const out = await h.run()
    expect(out.reason).toBe('not-updated')
    expect(out.code).toBe('auth/x')
    expect(h.api.clearFlag).not.toHaveBeenCalled()
    expect(h.state.flag).toBe(true)
    expect(h.state.account).toBe(TEMP)
    expect(h.lock.read()).toBeNull()
    expect(JSON.stringify(out)).not.toContain(NEXT)
  })

  it('finishes a failed flag write by signing in with the new password, without storing it', async () => {
    const h = harness()
    h.api.clearFlag = vi.fn(async () => { throw Object.assign(new Error('no'), { code: 'unavailable' }) })
    expect((await h.run()).reason).toBe('flag-unchanged')
    expect(h.state.flag).toBe(true)
    expect(h.state.account).toBe(NEXT)
    const held = h.lock.read()
    expect(held.phase).toBe('committed')
    expect(held.expiresAtMs).toBe(NOW + PASSWORD_GATE_LOCK_MS)
    expect(held.nonce).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(held)).not.toContain(NEXT)
    expect(JSON.stringify(held)).not.toContain(TEMP)

    h.api.current = NEXT
    h.api.password = NEXT
    h.api.clearFlag = vi.fn(async () => { h.state.flag = false })
    expect(await h.run()).toEqual({ ok: true, reason: 'replaced' })
    expect(h.api.updatePassword).toHaveBeenCalledTimes(1)
    expect(h.state.flag).toBe(false)
    expect(h.lock.read()).toBeNull()
  })

  it('does not treat a pending lock plus the old password as a completed change', async () => {
    const h = harness()
    h.api.updatePassword = vi.fn(async () => { throw Object.assign(new Error('no'), { code: 'auth/internal' }) })
    h.api.releaseLock = vi.fn(async () => {})
    expect((await h.run()).reason).toBe('not-updated')
    // The release was skipped by the stub, so the pending lock is still there.
    h.lock.read().phase = 'pending'
    h.api.password = TEMP
    h.api.releaseLock = (id) => h.lock.releaseLock(id)
    expect((await h.run()).reason).toBe('unchanged')
    expect(h.state.flag).toBe(true)
    expect(h.api.updatePassword).toHaveBeenCalledTimes(1)
  })

  it('a replay of the temporary password after a replacement does not clear or set it again', async () => {
    const h = harness()
    expect(await h.run()).toEqual({ ok: true, reason: 'replaced' })
    h.state.flag = true
    h.api.current = TEMP
    h.api.password = NEXT
    expect((await h.run()).reason).toBe('current-rejected')
    expect(h.api.updatePassword).toHaveBeenCalledTimes(1)
    expect(h.state.flag).toBe(true)
    expect(h.state.account).toBe(NEXT)
  })

  it('a second completion after the flag is down does not change the password again', async () => {
    const h = harness()
    expect((await h.run()).reason).toBe('replaced')
    const updates = h.api.updatePassword.mock.calls.length
    h.api.current = NEXT
    h.api.password = 'second-lantern-9'
    expect(await h.run()).toEqual({ ok: true, reason: 'not-required' })
    expect(h.api.updatePassword).toHaveBeenCalledTimes(updates)
    expect(h.state.account).toBe(NEXT)
  })

  it('lets only one of two concurrent replacements call updateUser', async () => {
    const h = harness()
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const original = h.api.updatePassword
    h.api.updatePassword = vi.fn(async (id, password) => {
      await gate
      return original(id, password)
    })
    const first = h.run()
    const second = applyPasswordChange({
      ...h.api,
      password: 'other-lantern-7',
      flag: true,
      marker: null,
    })
    await Promise.resolve()
    release()
    const [a, b] = await Promise.all([first, second])
    const reasons = [a.reason, b.reason].sort()
    expect(reasons).toEqual(['busy', 'replaced'])
    expect(h.api.updatePassword).toHaveBeenCalledTimes(1)
    expect(h.state.flag).toBe(false)
    expect(h.lock.read()).toBeNull()
  })

  it('ignores an expired lock, so a failed attempt does not block the account', async () => {
    const h = harness()
    const stale = {
      nonce: 'a'.repeat(64),
      phase: 'committed',
      expiresAtMs: NOW - 1,
    }
    expect(lockState(stale, NOW)).toBeNull()
    h.api.password = TEMP
    const same = await applyPasswordChange({ ...h.api, flag: true, marker: stale, password: TEMP })
    expect(same.reason).toBe('unchanged')
    expect(h.state.flag).toBe(true)
    h.api.password = NEXT
    expect((await h.run()).reason).toBe('replaced')
    expect(h.state.flag).toBe(false)
  })

  it('drops the lock when the requirement changes and keeps it across a name edit', () => {
    const flagged = { mustChangePassword: true, name: 'Ada' }
    expect(gateLockShouldDrop(flagged, { ...flagged, name: 'Ada Lovelace' })).toBe(false)
    expect(gateLockShouldDrop(flagged, { mustChangePassword: false })).toBe(true)
    expect(gateLockShouldDrop({ mustChangePassword: false }, flagged)).toBe(true)
    expect(gateLockShouldDrop(flagged, null)).toBe(true)
  })

  it('does not log a credential validation message or a non-code error', () => {
    expect(authErrorCode(`INVALID_PASSWORD : ${TEMP}`)).toBe('INVALID_PASSWORD')
    expect(authErrorCode(`INVALID_PASSWORD : ${TEMP}`)).not.toContain(TEMP)
    expect(safeAuthCode(`auth/internal ${NEXT}`)).toBe('')
    expect(safeAuthCode('auth/internal')).toBe('auth/internal')
    expect(classifySignInResponse(400, `TOKEN_EXPIRED ${TEMP}`)).toBe('unavailable')
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
    expect(h.lock.read()).toBeNull()
  })
})

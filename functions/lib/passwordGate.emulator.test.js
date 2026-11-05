// Auth emulator only. `npm --prefix functions test` skips this file: proving
// sign-in, refresh, reauth and revoke against a live Auth service needs the
// emulator, and the unit tests fake that boundary on purpose.
//
//   firebase emulators:exec --only auth --project demo-ohs-03 \
//     "npm --prefix functions exec vitest run lib/passwordGate.emulator.test.js"
import { describe, it, expect, afterAll } from 'vitest'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import {
  applyPasswordChange,
  createSerialLock,
  postPasswordSignIn,
  signInEndpoint,
} from './passwordGate.js'

const EMULATOR = process.env.FIREBASE_AUTH_EMULATOR_HOST
const TEMP = 'temp-password-1'
const NEXT = 'river-lantern-42'

function auth() {
  if (!getApps().length) {
    initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-ohs-03' })
  }
  return getAuth()
}

describe.skipIf(!EMULATOR)('password gate against the Auth emulator', () => {
  const email = `gate-${Date.now()}@plant.example`
  let uid = ''
  const endpoint = signInEndpoint({ emulatorHost: EMULATOR })

  afterAll(async () => {
    if (uid) await auth().deleteUser(uid).catch(() => {})
  })

  const signIn = (address, password) => postPasswordSignIn(fetch, endpoint, address, password)

  it('does not treat a re-salt, a sign-in, a refresh, a reauth, or a revoke as a password replacement', async () => {
    const created = await auth().createUser({ email, password: TEMP })
    uid = created.uid

    const before = await auth().getUser(uid)
    await auth().updateUser(uid, { password: TEMP })
    const salted = await auth().getUser(uid)
    // The emulator hashes as fakeHash:salt=…:password=…. A new salt is minted
    // on every password write, including a write of the same string, so the
    // hash moves when the password did not. Production SCRYPT re-salts the
    // same way. Hash inequality is not proof of replacement; this locks that.
    // Compared as a boolean so a failure does not print the hash, which on
    // the emulator contains the password.
    const hashMoved = Boolean(before.passwordHash)
      && Boolean(salted.passwordHash)
      && before.passwordHash !== salted.passwordHash
    expect(hashMoved).toBe(true)
    expect(await signIn(email, TEMP)).toBe('current')

    const issued = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: TEMP, returnSecureToken: true }),
    })
    expect(issued.ok).toBe(true)
    const session = await issued.json()
    const refreshed = await fetch(
      `http://${EMULATOR}/securetoken.googleapis.com/v1/token?key=emulator`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: session.refreshToken }),
      },
    )
    expect(refreshed.ok).toBe(true)
    await refreshed.text()

    // Reauth is a second sign-in. It must not clear anything by itself.
    expect(await signIn(email, TEMP)).toBe('current')

    const validBeforeRevoke = (await auth().getUser(uid)).tokensValidAfterTime
    // validSince is whole seconds. A revoke in the same second as the password
    // write above does not move the value the Admin SDK returns, which is the
    // other reason a timestamp cannot be the proof.
    await new Promise((r) => { setTimeout(r, 1100) })
    await auth().revokeRefreshTokens(uid)
    const validAfterRevoke = (await auth().getUser(uid)).tokensValidAfterTime
    expect(validAfterRevoke === validBeforeRevoke).toBe(false)

    const flag = { value: true }
    const cleared = []
    const now = Date.now()
    const lock = createSerialLock(() => now)
    const unchanged = await applyPasswordChange({
      uid,
      authTime: Math.floor(now / 1000),
      now,
      email,
      name: 'Ada',
      flag: flag.value,
      current: TEMP,
      password: TEMP,
      marker: lock.read(),
      signIn,
      updatePassword: async () => { throw new Error('must not replace') },
      claimLock: (record) => lock.claimLock(record),
      commitLock: (id, exp) => lock.commitLock(id, exp),
      releaseLock: (id) => lock.releaseLock(id),
      clearFlag: async () => { flag.value = false; cleared.push('clear') },
    })
    expect(unchanged.reason).toBe('unchanged')
    expect(flag.value).toBe(true)
    expect(cleared).toEqual([])
    expect(await signIn(email, TEMP)).toBe('current')
  })

  it('clears the flag only after Auth accepts a different password, and a failure leaves it set', async () => {
    const flag = { value: true }
    const now = Date.now()
    const lock = createSerialLock(() => now)
    const base = {
      uid,
      authTime: Math.floor(now / 1000),
      now,
      email,
      name: 'Ada',
      current: TEMP,
      signIn,
      claimLock: (record) => lock.claimLock(record),
      commitLock: (id, exp) => lock.commitLock(id, exp),
      releaseLock: (id) => lock.releaseLock(id),
    }

    const broken = await applyPasswordChange({
      ...base,
      flag: true,
      password: NEXT,
      marker: lock.read(),
      updatePassword: async () => { throw Object.assign(new Error('no'), { code: 'auth/internal' }) },
      clearFlag: async () => { flag.value = false },
    })
    expect(broken.reason).toBe('not-updated')
    expect(flag.value).toBe(true)
    expect(lock.read()).toBeNull()
    expect(await signIn(email, TEMP)).toBe('current')

    const stuck = await applyPasswordChange({
      ...base,
      flag: true,
      password: NEXT,
      marker: lock.read(),
      updatePassword: (id, password) => auth().updateUser(id, { password }),
      clearFlag: async () => { throw Object.assign(new Error('no'), { code: 'unavailable' }) },
    })
    expect(stuck.reason).toBe('flag-unchanged')
    expect(flag.value).toBe(true)
    expect(lock.read()?.phase).toBe('committed')
    expect(JSON.stringify(lock.read())).not.toMatch(/river|temp-password/)
    expect(await signIn(email, TEMP)).toBe('not-current')
    expect(await signIn(email, NEXT)).toBe('current')

    const replay = await applyPasswordChange({
      ...base,
      flag: true,
      current: TEMP,
      password: NEXT,
      marker: lock.read(),
      updatePassword: async () => { throw new Error('replay must not set a password') },
      clearFlag: async () => { flag.value = false },
    })
    expect(replay.reason).toBe('current-rejected')
    expect(flag.value).toBe(true)

    const done = await applyPasswordChange({
      ...base,
      flag: true,
      current: NEXT,
      password: NEXT,
      marker: lock.read(),
      updatePassword: async () => { throw new Error('finish must not set a password') },
      clearFlag: async () => { flag.value = false },
    })
    expect(done).toEqual({ ok: true, reason: 'replaced' })
    expect(flag.value).toBe(false)
    expect(lock.read()).toBeNull()
    expect(await signIn(email, NEXT)).toBe('current')
  })

  it('rejects a stale auth_time even when the new password would have been accepted', async () => {
    await auth().updateUser(uid, { password: NEXT })
    const now = Date.now()
    const stale = await applyPasswordChange({
      uid,
      authTime: Math.floor(now / 1000) - 60 * 60,
      now,
      email,
      name: 'Ada',
      flag: true,
      current: NEXT,
      password: 'another-lantern-7',
      marker: null,
      signIn,
      updatePassword: async () => { throw new Error('must not replace') },
      claimLock: async () => { throw new Error('must not lock') },
      commitLock: async () => { throw new Error('must not lock') },
      releaseLock: async () => {},
      clearFlag: async () => { throw new Error('must not clear') },
    })
    expect(stale.reason).toBe('stale')
    expect(await signIn(email, NEXT)).toBe('current')
  })
})

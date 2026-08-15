import { describe, it, expect } from 'vitest'
import { buildCaller, createCallerStore, readProfile, USERS_COLLECTION } from './caller.js'
import { hasProfile, isAdminOf, isApprovedMemberOf, isWriterOf } from './policy.js'

const ORG = 'orgA'
const approved = (role, overrides = {}) => ({ orgId: ORG, status: 'approved', role, ...overrides })

/** A Firestore stand-in that records every read, so "reads on every request" is provable. */
function makeDb(users = {}) {
  const reads = []
  const db = {
    collection(name) {
      return {
        doc(id) {
          return {
            id,
            collection: name,
            async get() {
              reads.push({ via: 'ref', collection: name, id })
              return snapshot(users[id])
            },
          }
        },
      }
    },
  }
  const tx = {
    async get(ref) {
      reads.push({ via: 'tx', collection: ref.collection, id: ref.id })
      return snapshot(users[ref.id])
    },
  }
  return { db, tx, users, reads }
}

const snapshot = (data) => ({ exists: data !== undefined && data !== null, data: () => data })

describe('loadCaller', () => {
  it('takes the uid it was given and everything else from the profile', async () => {
    const { db } = makeDb({ u1: approved('manager') })
    const { loadCaller } = createCallerStore({ db })

    const caller = await loadCaller('u1', { orgId: ORG, role: 'manager' })

    expect(caller.uid).toBe('u1')
    expect(caller.profile).toEqual(approved('manager'))
  })

  // The reason this file exists. Firestore re-reads the profile on every rule
  // evaluation, so revocation is instant there; a cached answer here would put
  // the hour-long staleness of the token back into a layer that had escaped it.
  it('reads the profile on every request, with no cache and no fast path', async () => {
    const { db, reads } = makeDb({ u1: approved('member') })
    const { loadCaller } = createCallerStore({ db })

    await loadCaller('u1', {})
    await loadCaller('u1', {})
    await loadCaller('u1', {})

    expect(reads).toHaveLength(3)
    expect(reads.every((r) => r.collection === USERS_COLLECTION && r.id === 'u1')).toBe(true)
  })

  // functions/lib/claims.js:85-103 does not revoke refresh tokens on
  // member → auditor, so this token keeps role: 'member' for up to an hour.
  it('refuses the write a stale member claim would have allowed', async () => {
    const { db } = makeDb({ u1: approved('auditor') })
    const { loadCaller } = createCallerStore({ db })

    const caller = await loadCaller('u1', { orgId: ORG, role: 'member' })

    expect(caller.staleClaims.role).toBe('member')
    expect(isWriterOf(caller, ORG)).toBe(false)
    expect(isApprovedMemberOf(caller, ORG)).toBe(true)
  })

  it('refuses an admin claim the profile has already withdrawn', async () => {
    const { db } = makeDb({ u1: approved('member') })
    const { loadCaller } = createCallerStore({ db })

    expect(isAdminOf(await loadCaller('u1', { orgId: ORG, role: 'admin' }), ORG)).toBe(false)
  })

  // A deleted user's token stays valid until it expires. hasProfile() denies on
  // exists() rather than raising, and this is that: a null profile, not a throw.
  it('gives a signed-in stranger a null profile rather than failing the request', async () => {
    const { db } = makeDb({})
    const { loadCaller } = createCallerStore({ db })

    const caller = await loadCaller('ghost', {})

    expect(caller.profile).toBeNull()
    expect(hasProfile(caller)).toBe(false)
  })

  it('records absent claims as null rather than leaving them undefined', async () => {
    const { db } = makeDb({ u1: approved('member') })
    const { loadCaller } = createCallerStore({ db })

    expect((await loadCaller('u1', undefined)).staleClaims).toEqual({ orgId: null, role: null })
    expect((await loadCaller('u1', {})).staleClaims).toEqual({ orgId: null, role: null })
  })
})

describe('reloadCaller', () => {
  // Rules evaluate against committed state AT WRITE TIME. A check in middleware
  // and a write afterwards is a window the rules never had, and this closes it.
  it('re-reads the profile through the transaction', async () => {
    const { db, tx, reads } = makeDb({ u1: approved('manager') })
    const { loadCaller, reloadCaller } = createCallerStore({ db })

    const caller = await loadCaller('u1', {})
    const fresh = await reloadCaller(caller, tx)

    expect(reads.map((r) => r.via)).toEqual(['ref', 'tx'])
    expect(fresh.uid).toBe('u1')
    expect(fresh.profile).toEqual(approved('manager'))
  })

  it('sees a demotion that landed after the middleware ran', async () => {
    const { db, tx, users } = makeDb({ u1: approved('manager') })
    const { loadCaller, reloadCaller } = createCallerStore({ db })

    const caller = await loadCaller('u1', {})
    expect(isWriterOf(caller, ORG)).toBe(true)

    users.u1 = approved('auditor')
    expect(isWriterOf(await reloadCaller(caller, tx), ORG)).toBe(false)
  })

  it('sees a member moved to another tenant mid-request', async () => {
    const { db, tx, users } = makeDb({ u1: approved('admin') })
    const { loadCaller, reloadCaller } = createCallerStore({ db })

    const caller = await loadCaller('u1', {})
    users.u1 = approved('admin', { orgId: 'orgB' })

    expect(isAdminOf(await reloadCaller(caller, tx), ORG)).toBe(false)
  })

  it('sees a profile deleted mid-request', async () => {
    const { db, tx, users } = makeDb({ u1: approved('admin') })
    const { loadCaller, reloadCaller } = createCallerStore({ db })

    const caller = await loadCaller('u1', {})
    delete users.u1

    expect((await reloadCaller(caller, tx)).profile).toBeNull()
  })

  it('carries the claims across without consulting them', async () => {
    const { db, tx } = makeDb({ u1: approved('member') })
    const { loadCaller, reloadCaller } = createCallerStore({ db })

    const fresh = await reloadCaller(await loadCaller('u1', { orgId: ORG, role: 'admin' }), tx)

    expect(fresh.staleClaims).toEqual({ orgId: ORG, role: 'admin' })
    expect(isAdminOf(fresh, ORG)).toBe(false)
  })

  // Not an AuthzError: a caller reaching a transaction unverified is a wiring
  // bug in a route, not a permissions decision about a person.
  it('refuses a caller that was never verified', async () => {
    const { db, tx } = makeDb({ u1: approved('admin') })
    const { reloadCaller } = createCallerStore({ db })

    await expect(reloadCaller(null, tx)).rejects.toThrow(/without a verified caller/)
    await expect(reloadCaller({}, tx)).rejects.toThrow(/without a verified caller/)
  })
})

describe('readProfile', () => {
  it('returns null for a document that does not exist', async () => {
    const { db } = makeDb({})
    expect(await readProfile(db, 'nobody')).toBeNull()
  })

  it('reads /users by default and honours an override', async () => {
    const { db, reads } = makeDb({ u1: approved('member') })
    await readProfile(db, 'u1')
    await readProfile(db, 'u1', { usersCollection: 'usersV2' })
    expect(reads.map((r) => r.collection)).toEqual(['users', 'usersV2'])
  })
})

describe('buildCaller', () => {
  // A field called `claims` invites a branch. A field called `staleClaims` in
  // an `if` reads as the bug it is.
  it('names the claims for what they are and freezes them', () => {
    const caller = buildCaller({ uid: 'u1', profile: approved('member'), staleClaims: { orgId: ORG, role: 'member' } })
    expect(Object.isFrozen(caller)).toBe(true)
    expect(Object.isFrozen(caller.staleClaims)).toBe(true)
    expect(caller.claims).toBeUndefined()
    expect(caller.orgId).toBeUndefined()
    expect(caller.role).toBeUndefined()
  })

  it('normalises a missing profile to null', () => {
    expect(buildCaller({ uid: 'u1', profile: undefined }).profile).toBeNull()
    expect(buildCaller({ uid: 'u1', profile: null }).profile).toBeNull()
  })
})

import { describe, it, expect, vi } from 'vitest'
import * as guards from './guards.js'
import { createProfileStage, assertOrgAccess, orgIdFromParams, requireOrgAccess, requireManager, requireWriter } from './guards.js'
import { AuthzError, statusFor } from './errors.js'
import { ApiError } from '../errors.js'
import { DENIED, ORG_PREDICATES, ROLES } from './policy.js'

const ORG = 'orgA'
const OTHER_ORG = 'orgB'

const profileFor = (role, overrides = {}) => ({ orgId: ORG, status: 'approved', role, ...overrides })
const callerFor = (role, overrides = {}) => ({ uid: 'u1', profile: profileFor(role, overrides), staleClaims: {} })

const makeReq = (caller, orgId = ORG) => ({ caller, params: { orgId } })

/** Run a middleware and report what it handed to next(). */
function run(middleware, req) {
  const next = vi.fn()
  middleware(req, {}, next)
  return next
}

const allowed = (next) => next.mock.calls.length === 1 && next.mock.calls[0].length === 0
const refusal = (next) => next.mock.calls[0] && next.mock.calls[0][0]

/** requireWriter for isWriterOf, assertManager for isManagerOf, and so on. */
const guardNameFor = (predicate) => `require${predicate.replace(/^is/, '').replace(/Of$/, '')}`
const assertNameFor = (predicate) => `assert${predicate.replace(/^is/, '').replace(/Of$/, '')}`

describe('every predicate has a guard', () => {
  // The registry drives this. A predicate added to policy.js without a guard
  // here is a route that cannot be written, which is better than a route that
  // is written and guards nothing.
  Object.keys(ORG_PREDICATES).forEach((predicate) => {
    it(`exports ${guardNameFor(predicate)} and ${assertNameFor(predicate)} for ${predicate}`, () => {
      expect(typeof guards[guardNameFor(predicate)]).toBe('function')
      expect(typeof guards[assertNameFor(predicate)]).toBe('function')
    })
  })

  // Wiring a guard to the wrong predicate is silent otherwise: the route still
  // refuses somebody, just not the right somebody. Every guard is compared
  // against its own predicate for every role.
  Object.entries(ORG_PREDICATES).forEach(([predicate, check]) => {
    ROLES.forEach((role) => {
      const caller = callerFor(role)

      it(`${guardNameFor(predicate)} agrees with ${predicate} for ${role}`, () => {
        expect(allowed(run(guards[guardNameFor(predicate)](), makeReq(caller)))).toBe(check(caller, ORG))
      })

      it(`${assertNameFor(predicate)} agrees with ${predicate} for ${role}`, () => {
        let threw = false
        try {
          guards[assertNameFor(predicate)](caller, ORG)
        } catch {
          threw = true
        }
        expect(threw).toBe(!check(caller, ORG))
      })
    })
  })
})

describe('what a refusal is allowed to say', () => {
  const refuse = (caller, orgId = ORG, predicate = 'isWriterOf') =>
    refusal(run(requireOrgAccess(predicate), makeReq(caller, orgId)))

  // The whole point of the opaque code. Distinguishing these would let anyone
  // with a login walk the tenant list one 403 at a time.
  it('cannot be used to tell a wrong tenant from a wrong role from an org that does not exist', () => {
    const wrongTenant = refuse(callerFor('admin', { orgId: OTHER_ORG }))
    const wrongRole = refuse(callerFor('auditor'))
    const noSuchOrg = refuse(callerFor('admin'), 'org-nobody-has-registered')

    expect(wrongTenant.code).toBe(DENIED.FORBIDDEN)
    expect(wrongRole.code).toBe(DENIED.FORBIDDEN)
    expect(noSuchOrg.code).toBe(DENIED.FORBIDDEN)
    expect(wrongTenant.status).toBe(403)
  })

  // src/errors.js serialises `{ error: { code, requestId } }` for an ApiError
  // and 500 'internal' for anything else, so this is what makes a refusal land
  // as the code it means rather than as a crash.
  it('refuses with an ApiError, so the app error handler serialises it', () => {
    const err = refuse(callerFor('auditor'))
    expect(err).toBeInstanceOf(AuthzError)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.expose).toBe(true)
  })

  // The response body is built from the code alone. Nothing that identifies the
  // org, the person or the role may ride along on the error at all — err.message
  // reaches the LOG, and a log line outlives the request.
  it('never names the org, the uid or the role', () => {
    const err = refuse(callerFor('auditor', { orgId: OTHER_ORG }))
    const carried = `${err.code} ${err.message}`
    expect(carried).not.toContain(ORG)
    expect(carried).not.toContain(OTHER_ORG)
    expect(carried).not.toContain('u1')
    expect(carried).not.toContain('auditor')
  })

  // The three that ARE specific are statements about the caller's own account.
  // Without the last one a provisioned user is refused everywhere with no hint
  // that the change-password screen is the way out.
  const SPECIFIC = [
    ['a signed-in user with no profile', { uid: 'u1', profile: null }, 403, DENIED.PROFILE_MISSING],
    ['a pending joiner', callerFor('member', { status: 'pending' }), 403, DENIED.NOT_APPROVED],
    [
      'an account still on a provisioned password',
      callerFor('member', { mustChangePassword: true }),
      403,
      DENIED.PASSWORD_CHANGE_REQUIRED,
    ],
    ['a caller with no verified uid', { uid: '', profile: profileFor('admin') }, 401, DENIED.UNAUTHENTICATED],
  ]

  SPECIFIC.forEach(([label, caller, status, code]) => {
    it(`tells ${label} what is wrong with their own account`, () => {
      const err = refuse(caller)
      expect(err.code).toBe(code)
      expect(err.status).toBe(status)
    })
  })

  it('maps an unrecognised code to a refusal rather than a success', () => {
    expect(statusFor('something_new')).toBe(403)
  })

  // Same inherited-key trap as the predicate registry. STATUSES.constructor is
  // the Object constructor, so `STATUSES[code] || 403` handed res.status() a
  // FUNCTION — Express throws on it, and a refusal meant to be a 403 leaves as
  // a 500 raised by the error path itself.
  const NOT_CODES = ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__', '', undefined, null]

  it('maps every code to an actual status number, inherited keys included', () => {
    NOT_CODES.forEach((code) => {
      expect(typeof statusFor(code), `statusFor(${String(code)})`).toBe('number')
      expect(statusFor(code)).toBe(403)
    })
  })

  it('still maps every real code to its own status', () => {
    expect(statusFor(DENIED.UNAUTHENTICATED)).toBe(401)
    Object.values(DENIED)
      .filter((c) => c !== DENIED.UNAUTHENTICATED)
      .forEach((code) => expect(statusFor(code)).toBe(403))
  })
})

describe('requireOrgAccess', () => {
  it('reads the org from the path by default', () => {
    expect(orgIdFromParams({ params: { orgId: ORG } })).toBe(ORG)
    expect(orgIdFromParams({})).toBeUndefined()
  })

  // The org is an ASSERTION the caller controls; the comparison against the
  // stored profile is the only thing that makes it mean anything.
  it('refuses an org the caller does not belong to, wherever it was read from', () => {
    const req = { caller: callerFor('admin'), params: {}, body: { orgId: OTHER_ORG } }
    const next = run(requireOrgAccess('isWriterOf', (r) => r.body.orgId), req)
    expect(refusal(next).code).toBe(DENIED.FORBIDDEN)
  })

  it('accepts an org read from somewhere other than the path', () => {
    const req = { caller: callerFor('member'), params: {}, body: { orgId: ORG } }
    expect(allowed(run(requireOrgAccess('isWriterOf', (r) => r.body.orgId), req))).toBe(true)
  })

  // A guard naming a predicate that does not exist would be a route that looks
  // guarded in the router and is not. Fail at wiring time, not at request time.
  //
  // The inherited keys are the ones that were wrong. ORG_PREDICATES.constructor
  // is the Object constructor: truthy, so the old existence check passed it, and
  // callable, returning the caller — so the guard it built called next() with
  // nothing and let an auditor write to another tenant's org.
  const NOT_PREDICATES = ['isSuperUserOf', 'isWriter', 'isSignedIn', '', 'constructor', 'toString', '__proto__']

  NOT_PREDICATES.forEach((name) => {
    it(`will not build a guard named ${JSON.stringify(name)}`, () => {
      expect(() => requireOrgAccess(name)).toThrow(/Unknown authorization predicate/)
    })

    // assertOrgAccess is the check that runs inside the transaction, so it is
    // the one that actually protects the data. It takes the name at CALL time,
    // never passing through requireOrgAccess's wiring check, and must refuse on
    // its own.
    it(`will not let ${JSON.stringify(name)} authorize a write from assertOrgAccess`, () => {
      const auditorElsewhere = callerFor('auditor', { orgId: OTHER_ORG })
      expect(() => assertOrgAccess(auditorElsewhere, ORG, name)).toThrow(/Unknown authorization predicate/)
    })
  })

  // Fail closed AND loudly: a 403 here would hide the wiring bug behind
  // something that looks like an ordinary permissions problem.
  it('errors rather than 403s when requireProfile was left out of the chain', () => {
    const err = refusal(run(requireWriter(), { params: { orgId: ORG } }))
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(AuthzError)
    expect(err.message).toMatch(/without requireProfile/)
  })

  it('refuses a caller whose profile was never attached', () => {
    const err = refusal(run(requireManager(), { caller: { uid: 'u1' }, params: { orgId: ORG } }))
    expect(err).not.toBeInstanceOf(AuthzError)
  })
})

describe('assertOrgAccess', () => {
  // This is the one that actually protects the data: the middleware ran before
  // the handler, the write happens after, and only a check inside the
  // transaction commits or aborts with it.
  it('throws an AuthzError a route can let bubble', () => {
    let thrown = null
    try {
      assertOrgAccess(callerFor('auditor'), ORG, 'isWriterOf')
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(AuthzError)
    expect(thrown.code).toBe(DENIED.FORBIDDEN)
    expect(thrown.status).toBe(403)
  })

  it('is silent when the caller is allowed', () => {
    expect(() => assertOrgAccess(callerFor('member'), ORG, 'isWriterOf')).not.toThrow()
  })

  it('refuses a caller re-read as demoted inside the transaction', () => {
    expect(() => assertOrgAccess(callerFor('auditor'), ORG, 'isWriterOf')).toThrow(AuthzError)
  })
})

describe('the profile stage', () => {
  const stageFor = (users) =>
    createProfileStage({
      loadCaller: async (uid, staleClaims) => ({ uid, profile: users[uid] || null, staleClaims: staleClaims || {} }),
    })

  const runAsync = async (middleware, req) => {
    const next = vi.fn()
    await new Promise((resolve) => {
      middleware(req, {}, (...args) => {
        next(...args)
        resolve()
      })
    })
    return next
  }

  it('replaces the verified uid with the live profile', async () => {
    const req = { caller: { uid: 'u1', staleClaims: { orgId: ORG, role: 'admin' } } }
    const next = await runAsync(stageFor({ u1: profileFor('member') }), req)

    expect(allowed(next)).toBe(true)
    expect(req.caller.profile).toEqual(profileFor('member'))
    expect(req.caller.uid).toBe('u1')
  })

  // Parity with the exists() guard at firestore.rules:34-37 — a signed-in
  // stranger with no profile document reaches nothing.
  it('refuses a signed-in user with no profile document', async () => {
    const next = await runAsync(stageFor({}), { caller: { uid: 'ghost', staleClaims: {} } })
    expect(refusal(next).code).toBe(DENIED.PROFILE_MISSING)
  })

  // firestore.rules:65-66 read both fields DIRECTLY, so a profile missing
  // either raises — and a rule that raises denies everything. There is nothing
  // downstream such a caller could have passed.
  const UNUSABLE = [
    ['no orgId', { status: 'approved', role: 'admin' }],
    ['a blank orgId', { orgId: '  ', status: 'approved', role: 'admin' }],
    ['no status', { orgId: ORG, role: 'admin' }],
    ['a blank status', { orgId: ORG, status: '', role: 'admin' }],
  ]

  UNUSABLE.forEach(([label, profile]) => {
    it(`refuses a profile with ${label}`, async () => {
      const next = await runAsync(stageFor({ u1: profile }), { caller: { uid: 'u1', staleClaims: {} } })
      expect(refusal(next).code).toBe(DENIED.FORBIDDEN)
    })
  })

  // Deliberately NOT refused at the gate: the route's own guard names the check
  // that actually refused, and a profile with no role still READS.
  it('lets a pending joiner and a role-less profile through to the route guard', async () => {
    const pending = await runAsync(stageFor({ u1: profileFor('member', { status: 'pending' }) }), {
      caller: { uid: 'u1', staleClaims: {} },
    })
    expect(allowed(pending)).toBe(true)

    const roleless = await runAsync(stageFor({ u1: { orgId: ORG, status: 'approved' } }), {
      caller: { uid: 'u1', staleClaims: {} },
    })
    expect(allowed(roleless)).toBe(true)
  })

  it('refuses when mounted without a verified uid in front of it', async () => {
    const bare = await runAsync(stageFor({}), {})
    expect(refusal(bare).code).toBe(DENIED.UNAUTHENTICATED)

    const empty = await runAsync(stageFor({}), { caller: { uid: '' } })
    expect(refusal(empty).code).toBe(DENIED.UNAUTHENTICATED)
  })

  // A Firestore outage is not a permissions decision and must not be dressed up
  // as one — in either direction.
  it('passes a failed profile read on rather than calling it a refusal', async () => {
    const boom = new Error('Firestore unavailable')
    const stage = createProfileStage({
      loadCaller: async () => {
        throw boom
      },
    })
    const next = await runAsync(stage, { caller: { uid: 'u1', staleClaims: {} } })
    expect(refusal(next)).toBe(boom)
  })
})

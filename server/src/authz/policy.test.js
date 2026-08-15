import { describe, it, expect } from 'vitest'
import * as policy from './policy.js'
import {
  ROLES,
  ORG_PREDICATES,
  DENIED,
  denialReason,
  predicateFor,
  profileGateReason,
  isSignedIn,
  hasProfile,
  passwordIsOwn,
  isApprovedMemberOf,
  isWriterOf,
  isManagerOf,
  isElevatedOf,
  isAdminOf,
} from './policy.js'

const ORG = 'orgA'
const OTHER_ORG = 'orgB'

const profileFor = (role, overrides = {}) => ({ orgId: ORG, status: 'approved', role, ...overrides })
const callerFor = (role, overrides = {}) => ({ uid: 'u1', profile: profileFor(role, overrides), staleClaims: {} })

// ─────────────────────────────────────────────────────────────────────────────
// The satisfaction matrix, straight out of firestore.rules.
//
// This table IS the spec. Every predicate is a row, every role is a column, and
// the completeness tests below refuse to pass if either gains a member without
// gaining a cell — which is the only thing stopping a sixth role or a new
// predicate from shipping unexercised.
// ─────────────────────────────────────────────────────────────────────────────
const MATRIX = {
  //                    admin  manager member auditor
  isApprovedMemberOf: { admin: true, manager: true, member: true, auditor: true },
  isWriterOf: { admin: true, manager: true, member: true, auditor: false },
  isManagerOf: { admin: true, manager: true, member: false, auditor: false },
  isElevatedOf: { admin: true, manager: true, member: false, auditor: true },
  isAdminOf: { admin: true, manager: false, member: false, auditor: false },
}

// Predicates that are not org-scoped and so cannot live in the matrix. Each has
// its own describe below; the completeness test knows about this list, so a new
// predicate can only be added by extending the matrix or extending this.
const COVERED_INDIVIDUALLY = [
  'isSignedIn',
  'hasProfile',
  'passwordIsOwn',
  'denialReason',
  'profileGateReason',
  'predicateFor',
]

// ─────────────────────────────────────────────────────────────────────────────
// Names that are NOT predicates.
//
// The last five are the ones that bite. ORG_PREDICATES is an object literal, so
// it inherits from Object.prototype, and `ORG_PREDICATES.constructor` is the
// Object constructor — a function, hence truthy, hence indistinguishable from a
// real predicate to a bare `if (!check) throw`. Calling it returns the caller,
// which is truthy, which reads as "allowed". Before predicateFor existed,
// denialReason(auditor, someoneElsesOrg, 'constructor') returned null and both
// requireOrgAccess and assertOrgAccess let the write through.
// ─────────────────────────────────────────────────────────────────────────────
const NOT_PREDICATES = [
  'isSuperUserOf',
  'isWriter', // the real one is isWriterOf — the plausible typo
  'isSignedIn', // a real export, but not org-scoped, so not reachable by name
  '',
  'constructor',
  'toString',
  'valueOf',
  'hasOwnProperty',
  '__proto__',
]

describe('predicateFor', () => {
  it('returns the predicate for every name in the registry', () => {
    Object.entries(ORG_PREDICATES).forEach(([name, check]) => {
      expect(predicateFor(name)).toBe(check)
    })
  })

  NOT_PREDICATES.forEach((name) => {
    it(`throws for ${JSON.stringify(name)} rather than returning something callable`, () => {
      expect(() => predicateFor(name)).toThrow(/Unknown authorization predicate/)
    })
  })

  // A name arriving as anything but a string is a wiring bug too, and
  // Object.hasOwn would happily stringify it first.
  const NON_STRINGS = [undefined, null, 0, {}, ['isWriterOf'], Symbol.iterator]
  NON_STRINGS.forEach((name) => {
    it(`throws for the non-string ${String(name)}`, () => {
      expect(() => predicateFor(name)).toThrow(/Unknown authorization predicate/)
    })
  })
})

describe('the table covers everything', () => {
  it('has a row for every org-scoped predicate', () => {
    expect(Object.keys(MATRIX).sort()).toEqual(Object.keys(ORG_PREDICATES).sort())
  })

  it('has a column for every role', () => {
    Object.entries(MATRIX).forEach(([name, row]) => {
      expect(Object.keys(row).sort(), `${name} is missing a role`).toEqual([...ROLES].sort())
    })
  })

  // The one that catches a predicate added to policy.js and to no test at all.
  it('leaves no exported predicate untested', () => {
    const exported = Object.entries(policy)
      .filter(([, v]) => typeof v === 'function')
      .map(([k]) => k)
      .sort()
    expect(exported).toEqual([...Object.keys(ORG_PREDICATES), ...COVERED_INDIVIDUALLY].sort())
  })
})

describe('every role against every predicate', () => {
  Object.entries(MATRIX).forEach(([name, row]) => {
    const check = ORG_PREDICATES[name]
    Object.entries(row).forEach(([role, expected]) => {
      it(`${name} is ${expected} for ${role}`, () => {
        expect(check(callerFor(role), ORG)).toBe(expected)
      })
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The auditor.
//
// Elevated for reads, refused for writes. The two predicates look alike and
// pull in opposite directions, which is why this is the case most likely to be
// got wrong, and why it gets its own block rather than trusting two cells.
// ─────────────────────────────────────────────────────────────────────────────
describe('the auditor', () => {
  const auditor = callerFor('auditor')

  it('is an approved member and may read', () => {
    expect(isApprovedMemberOf(auditor, ORG)).toBe(true)
  })

  // firestore.rules:81-89. Until isWriterOf existed this was true only in
  // React, while the rules accepted the same write from the SDK. firebase-admin
  // will not hide the buttons either.
  it('may not write, which is the whole reason the role exists', () => {
    expect(isWriterOf(auditor, ORG)).toBe(false)
  })

  it('is elevated even though it may not write — both halves are load-bearing', () => {
    expect(isElevatedOf(auditor, ORG)).toBe(true)
    expect(isWriterOf(auditor, ORG)).toBe(false)
  })

  // The generic write rule is isWriterOf && (isElevatedOf || keepsClassification)
  // (firestore.rules:1055-1056). The auditor is refused by the FIRST conjunct
  // and never reaches the second, so on the write path `isElevatedOf ||` means
  // admin-or-manager. Any composition in this server must keep that order.
  it('is refused by isWriterOf before isElevatedOf is ever consulted', () => {
    const writePathAllows = isWriterOf(auditor, ORG) && isElevatedOf(auditor, ORG)
    expect(writePathAllows).toBe(false)
  })

  // firestore.rules:944-946 — isManagerOf, not isElevatedOf, is what keeps an
  // outside reviewer out of injury and illness records.
  it('is not a manager, so health records and deletes stay out of reach', () => {
    expect(isManagerOf(auditor, ORG)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Everything that must deny, for every role and every predicate.
// ─────────────────────────────────────────────────────────────────────────────
describe('cases where every predicate denies every role', () => {
  const DENY_ALL = [
    ['no caller at all', () => null, ORG],
    ['a caller with no uid', (role) => ({ ...callerFor(role), uid: '' }), ORG],
    ['a signed-in user whose profile document does not exist', (role) => ({ ...callerFor(role), profile: null }), ORG],
    ['a profile that is not a document', (role) => ({ ...callerFor(role), profile: [role] }), ORG],
    ['an approved member of another tenant', (role) => callerFor(role, { orgId: OTHER_ORG }), ORG],
    ['a pending joiner', (role) => callerFor(role, { status: 'pending' }), ORG],
    ['a rejected member', (role) => callerFor(role, { status: 'rejected' }), ORG],
    ['a suspended member', (role) => callerFor(role, { status: 'suspended' }), ORG],
    // Direct field access at firestore.rules:65-66 raises on an absent field,
    // and a rule that raises denies. In JavaScript it would quietly be undefined.
    ['a profile carrying no status', (role) => callerFor(role, { status: undefined }), ORG],
    ['a profile carrying no orgId', (role) => callerFor(role, { orgId: undefined }), ORG],
    ['a profile whose orgId is blank', (role) => callerFor(role, { orgId: '   ' }), ORG],
    // ' orgA ' is not 'orgA' to Firestore. Trimming here would silently admit
    // a profile the rules refuse.
    ['a profile whose orgId is padded', (role) => callerFor(role, { orgId: ' orgA ' }), ORG],
    // A route that forgot to pass an org must not pass the check.
    ['a request naming no org', (role) => callerFor(role), undefined],
    ['a request naming a blank org', (role) => callerFor(role), '  '],
    ['a request naming an org as a non-string', (role) => callerFor(role), 42],
    // firestore.rules:59-61 — an account still on the password an admin typed
    // for it reaches NOTHING.
    ['a profile still on a provisioned password', (role) => callerFor(role, { mustChangePassword: true }), ORG],
  ]

  DENY_ALL.forEach(([label, build, orgId]) => {
    Object.entries(ORG_PREDICATES).forEach(([name, check]) => {
      ROLES.forEach((role) => {
        it(`${name} denies ${role}: ${label}`, () => {
          expect(check(build(role), orgId)).toBe(false)
        })
      })
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The role field itself.
// ─────────────────────────────────────────────────────────────────────────────
describe('a profile whose role is unusable', () => {
  // firestore.rules:88 reads myProfile().role directly, so a missing role
  // raises in isWriterOf/isManagerOf/isElevatedOf/isAdminOf — which denies —
  // while isApprovedMemberOf, which never touches the field, still passes.
  // In JavaScript `undefined !== 'auditor'` is true, so getting this wrong
  // turns a profile with no role at all into a writer.
  const UNUSABLE = [
    ['absent', undefined],
    ['null', null],
    ['blank', ''],
    ['whitespace', '   '],
    ['a number', 7],
    ['an array', ['admin']],
    ['an object', { role: 'admin' }],
  ]

  UNUSABLE.forEach(([label, role]) => {
    it(`reads with a role that is ${label}, and writes nothing`, () => {
      const caller = { uid: 'u1', profile: profileFor(role), staleClaims: {} }
      expect(isApprovedMemberOf(caller, ORG)).toBe(true)
      expect(isWriterOf(caller, ORG)).toBe(false)
      expect(isManagerOf(caller, ORG)).toBe(false)
      expect(isElevatedOf(caller, ORG)).toBe(false)
      expect(isAdminOf(caller, ORG)).toBe(false)
    })
  })
})

describe('isWriterOf is a denylist, replicated literally', () => {
  // firestore.rules:87-89 is `role != 'auditor'`. Rewriting it as an allowlist
  // of the three known writers would be a different rule: a role added to the
  // app later would lose its writes here and keep them in firestore.rules, and
  // the two layers would disagree with no test failing.
  const NOT_THE_AUDITOR = ['inspector', 'contractor', 'Auditor', 'AUDITOR', ' auditor ', 'auditor2', 'admin']

  NOT_THE_AUDITOR.forEach((role) => {
    it(`treats ${JSON.stringify(role)} as a writer, because it is not exactly 'auditor'`, () => {
      expect(isWriterOf(callerFor(role), ORG)).toBe(true)
    })
  })

  it('treats only the exact string as the auditor', () => {
    expect(isWriterOf(callerFor('auditor'), ORG)).toBe(false)
  })

  // The mirror image, and the reason nothing here is normalised: trimming would
  // make ' admin ' an admin, which Firestore would not.
  it('does not let a padded or recased role climb', () => {
    expect(isAdminOf(callerFor(' admin '), ORG)).toBe(false)
    expect(isAdminOf(callerFor('Admin'), ORG)).toBe(false)
    expect(isManagerOf(callerFor(' manager '), ORG)).toBe(false)
    expect(isElevatedOf(callerFor('MANAGER'), ORG)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The claims on the token are never consulted.
// ─────────────────────────────────────────────────────────────────────────────
describe('the token claims decide nothing', () => {
  // functions/lib/claims.js:85-103 does not revoke on member → auditor, so the
  // token keeps role: 'member' for up to an hour after the demotion. The
  // profile is authoritative and it says auditor.
  it('refuses a write from a demoted auditor whose token still claims member', () => {
    const caller = { uid: 'u1', profile: profileFor('auditor'), staleClaims: { orgId: ORG, role: 'member' } }
    expect(isWriterOf(caller, ORG)).toBe(false)
  })

  it('refuses an admin claim that the profile does not back', () => {
    const caller = { uid: 'u1', profile: profileFor('member'), staleClaims: { orgId: ORG, role: 'admin' } }
    expect(isAdminOf(caller, ORG)).toBe(false)
    expect(isManagerOf(caller, ORG)).toBe(false)
  })

  // mustChangePassword is not a claim key at all (claims.js:24), so a
  // provisioned account's token looks perfectly healthy.
  it('refuses a provisioned account whose token shows nothing wrong', () => {
    const caller = {
      uid: 'u1',
      profile: profileFor('manager', { mustChangePassword: true }),
      staleClaims: { orgId: ORG, role: 'manager' },
    }
    expect(isApprovedMemberOf(caller, ORG)).toBe(false)
    expect(isManagerOf(caller, ORG)).toBe(false)
  })

  it('refuses a claim naming another tenant', () => {
    const caller = { uid: 'u1', profile: profileFor('admin'), staleClaims: { orgId: OTHER_ORG, role: 'admin' } }
    expect(isAdminOf(caller, OTHER_ORG)).toBe(false)
    expect(isAdminOf(caller, ORG)).toBe(true)
  })

  // The other direction: claims are absent for anyone approved in the last
  // hour, or whenever a token predates the claims sync. That must cost nothing.
  it('allows a caller with no claims at all, because nothing reads them', () => {
    const noClaims = { uid: 'u1', profile: profileFor('manager') }
    expect(isApprovedMemberOf(noClaims, ORG)).toBe(true)
    expect(isWriterOf(noClaims, ORG)).toBe(true)
    expect(isManagerOf(noClaims, ORG)).toBe(true)
    expect(isAdminOf(noClaims, ORG)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The predicates that are not org-scoped.
// ─────────────────────────────────────────────────────────────────────────────
describe('isSignedIn', () => {
  const CASES = [
    ['a verified caller', { uid: 'u1' }, true],
    ['a caller with a blank uid', { uid: '' }, false],
    ['a caller with a non-string uid', { uid: 123 }, false],
    ['no caller', null, false],
    ['undefined', undefined, false],
    ['an empty object', {}, false],
  ]
  CASES.forEach(([label, caller, expected]) => {
    it(`is ${expected} for ${label}`, () => expect(isSignedIn(caller)).toBe(expected))
  })
})

describe('hasProfile', () => {
  // firestore.rules:34-37 guards with exists(), so a missing profile denies
  // rather than raising. Here that is a null profile denying rather than the
  // request erroring on a field read.
  const CASES = [
    ['a signed-in user with a profile', { uid: 'u1', profile: {} }, true],
    ['a signed-in user with no profile document', { uid: 'u1', profile: null }, false],
    ['a signed-in user with an undefined profile', { uid: 'u1' }, false],
    ['a profile that is an array', { uid: 'u1', profile: [] }, false],
    ['a profile that is a string', { uid: 'u1', profile: 'admin' }, false],
    ['a profile with no signed-in user', { uid: '', profile: {} }, false],
  ]
  CASES.forEach(([label, caller, expected]) => {
    it(`is ${expected} for ${label}`, () => expect(hasProfile(caller)).toBe(expected))
  })
})

describe('passwordIsOwn', () => {
  // `.get('mustChangePassword', false) != true` — ONLY the exact boolean true
  // denies. Tightening this to a truthiness test would deny every profile
  // written before the field existed, which is the whole existing user base.
  const CASES = [
    ['absent', {}, true],
    ['false', { mustChangePassword: false }, true],
    ['null', { mustChangePassword: null }, true],
    ["the string 'true'", { mustChangePassword: 'true' }, true],
    ['the number 1', { mustChangePassword: 1 }, true],
    ['the number 0', { mustChangePassword: 0 }, true],
    ['exactly true', { mustChangePassword: true }, false],
  ]
  CASES.forEach(([label, overrides, expected]) => {
    it(`is ${expected} when mustChangePassword is ${label}`, () => {
      expect(passwordIsOwn(callerFor('member', overrides))).toBe(expected)
    })
  })

  it('denies rather than raising when there is no profile to read', () => {
    expect(passwordIsOwn({ uid: 'u1', profile: null })).toBe(false)
    expect(passwordIsOwn(null)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// What we admit to.
// ─────────────────────────────────────────────────────────────────────────────
describe('denialReason', () => {
  const CASES = [
    ['an approved writer', callerFor('member'), ORG, 'isWriterOf', null],
    ['no caller', null, ORG, 'isWriterOf', DENIED.UNAUTHENTICATED],
    ['a caller with no uid', { uid: '', profile: profileFor('admin') }, ORG, 'isWriterOf', DENIED.UNAUTHENTICATED],
    ['a signed-in user with no profile', { uid: 'u1', profile: null }, ORG, 'isWriterOf', DENIED.PROFILE_MISSING],
    ['a member of another tenant', callerFor('admin', { orgId: OTHER_ORG }), ORG, 'isWriterOf', DENIED.FORBIDDEN],
    ['a request naming no org', callerFor('admin'), undefined, 'isWriterOf', DENIED.FORBIDDEN],
    ['a profile carrying no org', callerFor('admin', { orgId: undefined }), ORG, 'isWriterOf', DENIED.FORBIDDEN],
    ['a pending joiner', callerFor('member', { status: 'pending' }), ORG, 'isWriterOf', DENIED.NOT_APPROVED],
    ['a suspended member', callerFor('member', { status: 'suspended' }), ORG, 'isWriterOf', DENIED.NOT_APPROVED],
    ['a profile with no status', callerFor('member', { status: undefined }), ORG, 'isWriterOf', DENIED.NOT_APPROVED],
    [
      'a provisioned password',
      callerFor('member', { mustChangePassword: true }),
      ORG,
      'isWriterOf',
      DENIED.PASSWORD_CHANGE_REQUIRED,
    ],
    ['an auditor trying to write', callerFor('auditor'), ORG, 'isWriterOf', DENIED.FORBIDDEN],
    ['a member trying to delete', callerFor('member'), ORG, 'isManagerOf', DENIED.FORBIDDEN],
    ['a manager trying to act as admin', callerFor('manager'), ORG, 'isAdminOf', DENIED.FORBIDDEN],
    ['a profile with no role', callerFor(undefined), ORG, 'isWriterOf', DENIED.FORBIDDEN],
  ]

  CASES.forEach(([label, caller, orgId, predicate, expected]) => {
    it(`answers ${expected === null ? 'allowed' : expected} for ${label}`, () => {
      expect(denialReason(caller, orgId, predicate)).toBe(expected)
    })
  })

  // The point of the opaque code. "You are not a member of that org" and "no
  // such org" are different sentences, and the difference is a directory of
  // other people's tenants, readable one request at a time.
  it('cannot be used to tell a wrong tenant from a wrong role', () => {
    const wrongTenant = denialReason(callerFor('admin', { orgId: OTHER_ORG }), ORG, 'isWriterOf')
    const wrongRole = denialReason(callerFor('auditor'), ORG, 'isWriterOf')
    const noSuchOrg = denialReason(callerFor('admin'), 'org-that-does-not-exist', 'isWriterOf')
    expect(wrongTenant).toBe(DENIED.FORBIDDEN)
    expect(wrongRole).toBe(DENIED.FORBIDDEN)
    expect(noSuchOrg).toBe(DENIED.FORBIDDEN)
  })

  // A guard naming a predicate that does not exist would otherwise be a route
  // that looks guarded in the router and is not.
  it('throws on a predicate that does not exist rather than allowing', () => {
    NOT_PREDICATES.forEach((name) => {
      expect(() => denialReason(callerFor('member'), ORG, name), name).toThrow(/Unknown authorization predicate/)
    })
  })

  // The regression, stated as the thing that was actually wrong: an auditor,
  // against a tenant that is not theirs, came back ALLOWED. Written against the
  // worst caller and the worst org so that a future rewrite of the lookup
  // cannot pass by throwing for a member and allowing for everyone else.
  it('never answers "allowed" for a name that is not a predicate', () => {
    const auditorElsewhere = callerFor('auditor', { orgId: OTHER_ORG })
    NOT_PREDICATES.forEach((name) => {
      let answer
      try {
        answer = denialReason(auditorElsewhere, ORG, name)
      } catch {
        return // throwing is the correct outcome
      }
      expect.fail(`denialReason answered ${JSON.stringify(answer)} for ${JSON.stringify(name)} instead of throwing`)
    })
  })
})

describe('profileGateReason', () => {
  // The once-per-request gate. It refuses only the states in which NO
  // downstream predicate could pass, so the per-route codes stay accurate.
  const GATE = [
    ['an approved member', callerFor('member'), null],
    ['an auditor', callerFor('auditor'), null],
    ['no caller', null, DENIED.UNAUTHENTICATED],
    ['a caller with no verified uid', { uid: '', profile: profileFor('admin') }, DENIED.UNAUTHENTICATED],
    ['a signed-in user with no profile', { uid: 'u1', profile: null }, DENIED.PROFILE_MISSING],
    ['a profile that is not a document', { uid: 'u1', profile: [] }, DENIED.PROFILE_MISSING],
    // firestore.rules:65-66 read both DIRECTLY: absent raises, and a raise
    // denies everything, read and write alike.
    ['a profile with no orgId', callerFor('admin', { orgId: undefined }), DENIED.FORBIDDEN],
    ['a profile with a blank orgId', callerFor('admin', { orgId: '   ' }), DENIED.FORBIDDEN],
    ['a profile with no status', callerFor('admin', { status: undefined }), DENIED.FORBIDDEN],
    ['a profile with a blank status', callerFor('admin', { status: '' }), DENIED.FORBIDDEN],
    // Deliberately let through: the route's own guard names the check that
    // actually refused, and both of these still read.
    ['a pending joiner', callerFor('member', { status: 'pending' }), null],
    ['a profile with no role', callerFor(undefined), null],
    ['a member of another tenant', callerFor('admin', { orgId: OTHER_ORG }), null],
    ['an account on a provisioned password', callerFor('member', { mustChangePassword: true }), null],
  ]

  GATE.forEach(([label, caller, expected]) => {
    it(`answers ${expected === null ? 'through' : expected} for ${label}`, () => {
      expect(profileGateReason(caller)).toBe(expected)
    })
  })

  // The gate establishes WHO, the guards establish WHAT. If the gate started
  // refusing on approval or role, a caller would get a code naming the front
  // door rather than the check that refused them.
  it('leaves every role and approval refusal to the predicate that asked', () => {
    expect(profileGateReason(callerFor('auditor'))).toBeNull()
    expect(denialReason(callerFor('auditor'), ORG, 'isWriterOf')).toBe(DENIED.FORBIDDEN)
    expect(profileGateReason(callerFor('member', { status: 'pending' }))).toBeNull()
    expect(denialReason(callerFor('member', { status: 'pending' }), ORG, 'isWriterOf')).toBe(DENIED.NOT_APPROVED)
  })
})

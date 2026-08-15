// ─────────────────────────────────────────────────────────────────────────────
// The role predicates from firestore.rules, as pure functions.
//
// WHY THIS FILE EXISTS. The server writes through firebase-admin, which
// BYPASSES firestore.rules completely — every rule that stood between a caller
// and a document is simply not there. These predicates are the replacement.
// Nothing else in the server is allowed to decide who may write.
//
// WHY IT IS PURE. Every predicate takes an explicit caller object and returns a
// boolean. No Firestore, no express, no clock, no I/O. Two reasons:
//
//   1. A rule you cannot read beside its replacement is a rule you cannot
//      review. Each predicate sits next to the firestore.rules lines it came
//      from, so the pair can be diffed by eye. That review is the only thing
//      standing between this file and a silently different meaning.
//   2. Every branch is reachable from a test with a literal object. The auditor
//      — elevated for reads, refused for writes — is the case most likely to be
//      got wrong, and it costs one line to prove here.
//
// The caller object is built in caller.js. Its `profile` is the LIVE
// /users/{uid} document, never the token's claims; see that file for why.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} Caller
 * @property {string}      uid          From verifyIdToken. The ONLY auth-derived
 *                                      value any rule uses (rules 27, 31, 36).
 * @property {Object|null} profile      The live /users/{uid} document, or null
 *                                      when it does not exist. Never claims.
 * @property {Object}      staleClaims  Recorded for logging only — see caller.js.
 */

/** The roles the app mints. Every predicate below is decided by strict equality against these. */
export const ROLES = Object.freeze(['admin', 'manager', 'member', 'auditor'])

// The two role sets, kept as data so the tests can assert against the same list
// the predicates use rather than a second copy that can drift.
const MANAGER_ROLES = Object.freeze(['admin', 'manager'])
const ELEVATED_ROLES = Object.freeze(['admin', 'manager', 'auditor'])

// isWriterOf is a DENYLIST, not an allowlist (rules 87-89). Named, so the one
// place it is compared reads as the rule does.
const READ_ONLY_ROLE = 'auditor'

/**
 * Read a field that the rules read DIRECTLY — myProfile().orgId, .status, .role
 * (rules 65, 66, 71, 78, 88, 235).
 *
 * WHY THIS IS NOT `profile.role`. Direct field access on an absent field RAISES
 * in a rule, and a rule that raises denies. In JavaScript the same access
 * yields undefined and carries straight on — which is exactly how
 * `role != 'auditor'` turns a profile with no role at all into a writer. Every
 * direct read goes through here, and anything that is not a non-blank string is
 * treated as absent, which denies.
 *
 * The value comes back UNTRIMMED and with its case intact, because everything
 * downstream is the rules' strict string equality. Normalising here would be a
 * change of meaning in the dangerous direction: ' admin ' is not an admin to
 * Firestore, and trimming it would make it one. Blank-but-present is the one
 * place this is deliberately STRICTER than the rules — CEL would compare '' to
 * 'auditor', find them unequal and grant the write. Stricter denies a write the
 * rules would have allowed; looser is a hole. Only one of those is survivable.
 */
const directField = (v) => (typeof v === 'string' && v.trim() !== '' ? v : null)

/** The caller's role, or null when the profile carries nothing usable. */
const roleOf = (caller) => (caller && caller.profile ? directField(caller.profile.role) : null)

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)

// ── Predicates ───────────────────────────────────────────────────────────────

/**
 * firestore.rules:26-28 — `request.auth != null`.
 *
 * A verified token always carries a uid, so an empty one means the caller was
 * assembled by hand somewhere it should not have been. That denies.
 */
export function isSignedIn(caller) {
  return Boolean(caller && typeof caller.uid === 'string' && caller.uid !== '')
}

/**
 * firestore.rules:34-37 — `isSignedIn() && exists(/users/{uid})`.
 *
 * The exists() guard is what makes a missing profile DENY rather than raise.
 * Here that is caller.profile being null: a signed-in stranger with no profile
 * document reaches nothing, which is the state a deleted user is left in.
 */
export function hasProfile(caller) {
  return isSignedIn(caller) && isPlainObject(caller.profile)
}

/**
 * firestore.rules:59-61 — `myProfile().get('mustChangePassword', false) != true`.
 *
 * An account still holding the password an admin typed for it reaches NOTHING.
 *
 * Only the exact boolean true denies. Absent, false, null and even the string
 * 'true' all pass, because the rule reads the field with a default and compares
 * for inequality with true. Do NOT tighten this to a truthiness test: every
 * profile written before the field existed has no such key, and the rules'
 * comment at 51-54 records what happens when a check like this denies the whole
 * existing user base at once.
 *
 * Note this is a flag the rules deliberately BYPASS for /users read and update
 * (rules 56-58), so the change-password screen can clear the flag it exists to
 * clear. Any future /users route must do the same or it locks that screen out.
 */
export function passwordIsOwn(caller) {
  return hasProfile(caller) && caller.profile.mustChangePassword !== true
}

/**
 * firestore.rules:63-68 — profile exists, names this org, is approved, and is
 * not still on a provisioned password.
 *
 * `orgId` is an ASSERTION to be compared, never authority. It arrives from a
 * route path or a request body, both of which the caller controls; the only
 * thing that makes it mean anything is this comparison against the stored
 * profile. A server that took orgId from the request and trusted it would hand
 * every tenant to anyone who could spell another tenant's id.
 *
 * A blank or missing orgId argument denies rather than matching a profile that
 * is also missing one — a route that forgot to pass one must not pass the check.
 */
export function isApprovedMemberOf(caller, orgId) {
  const want = directField(orgId)
  if (want === null) return false
  if (!hasProfile(caller)) return false
  const mine = directField(caller.profile.orgId)
  if (mine === null || mine !== want) return false
  // Direct access at rules 66: a profile with no status raises, which denies.
  if (directField(caller.profile.status) !== 'approved') return false
  return passwordIsOwn(caller)
}

/** firestore.rules:70-72 — `isApprovedMemberOf(orgId) && role == 'admin'`. */
export function isAdminOf(caller, orgId) {
  return isApprovedMemberOf(caller, orgId) && roleOf(caller) === 'admin'
}

/**
 * firestore.rules:76-79 — admin or manager. Deliberately NOT auditor.
 *
 * This is the delete gate and the decision gate, and it is the predicate that
 * keeps an outside auditor away from injury and illness records (rules 944-946,
 * 960-966). isElevatedOf below looks similar and is not the same; the pair pull
 * in opposite directions on purpose.
 */
export function isManagerOf(caller, orgId) {
  return isApprovedMemberOf(caller, orgId) && MANAGER_ROLES.includes(roleOf(caller))
}

/**
 * firestore.rules:87-89 — every approved member EXCEPT the auditor.
 *
 * An auditor is typically an outside party given a login to inspect the safety
 * record. Being able to edit the evidence they are auditing is the one thing
 * the role exists to prevent, and until this predicate existed it was true only
 * in React — can() hid the buttons while the rules accepted the same write from
 * the SDK. firebase-admin will not hide anything either.
 *
 * A DENYLIST, replicated literally: any role that is not exactly 'auditor'
 * writes, including a role string nobody has heard of. Rewriting it as an
 * allowlist of the three known writers would be a quieter file and a different
 * rule — a role added to the app later would silently lose its writes here
 * while keeping them in firestore.rules, and the two layers would disagree
 * about a tenant's data with no test failing.
 *
 * The `role !== null` conjunct is the raise: a profile with no role at all
 * denies every write (rules 88 reads the field directly) while still reading.
 * That asymmetry is real and is covered in policy.test.js.
 */
export function isWriterOf(caller, orgId) {
  const role = roleOf(caller)
  if (role === null) return false
  return isApprovedMemberOf(caller, orgId) && role !== READ_ONLY_ROLE
}

/**
 * firestore.rules:233-236 — admin, manager OR AUDITOR.
 *
 * The auditor is in this one and out of isManagerOf, and both halves are
 * load-bearing: document reads use this to let a reviewer see the library
 * (rules 285), health records use isManagerOf to keep the same reviewer out
 * (rules 944-946).
 *
 * In the generic write rule the auditor never reaches this predicate — it sits
 * behind isWriterOf (rules 1055-1056), which has already refused them — so on
 * the write path `isElevatedOf(...) ||` effectively means admin-or-manager.
 * Anything in this server that composes the two must keep that order.
 */
export function isElevatedOf(caller, orgId) {
  return isApprovedMemberOf(caller, orgId) && ELEVATED_ROLES.includes(roleOf(caller))
}

/**
 * The org-scoped predicates, by name.
 *
 * A registry rather than five imports so that guards.js and policy.test.js are
 * driven by the same list: a predicate added here without a guard, or without a
 * row in the test's expectation table, fails the suite rather than shipping
 * unexercised.
 */
export const ORG_PREDICATES = Object.freeze({
  isApprovedMemberOf,
  isWriterOf,
  isManagerOf,
  isElevatedOf,
  isAdminOf,
})

/**
 * The predicate called `name`, or a throw. The ONLY way to reach one by name.
 *
 * WHY Object.hasOwn AND NOT `ORG_PREDICATES[name]`. That object literal
 * inherits from Object.prototype, so `ORG_PREDICATES.constructor` is the Object
 * constructor: a function, therefore truthy, therefore it sails past a
 * `if (!check) throw` existence test — and then `Object(caller, orgId)` returns
 * the caller, which is truthy, which reads as "the predicate passed". A guard
 * built on that name refuses NOBODY: wrong tenant, wrong role, auditor, all
 * allowed, through the middleware and through assertOrgAccess inside the
 * transaction. That is the exact inversion of what this lookup exists to do.
 *
 * No route names a predicate 'constructor' today, and that is not the point.
 * The comments on requireOrgAccess and on denialReason both promise that a name
 * which is not a predicate FAILS LOUDLY rather than reading as allowed, and a
 * promise that holds only for the typos we happened to imagine is not one worth
 * writing down. An own-property lookup makes it hold for every string.
 */
export function predicateFor(name) {
  if (typeof name !== 'string' || !Object.hasOwn(ORG_PREDICATES, name)) {
    // String(name), not `${name}`. Interpolating a Symbol throws a TypeError of
    // its own, and the message an operator then reads is "Cannot convert a
    // Symbol value to a string" — which describes the error handler rather than
    // the wiring bug, and sends whoever is paged reading the wrong file.
    throw new Error(`Unknown authorization predicate: ${String(name)}`)
  }
  return ORG_PREDICATES[name]
}

// ── Why a request was refused ────────────────────────────────────────────────

/**
 * The refusal codes the API may return.
 *
 * Deliberately few. A code is a channel back to whoever is asking, and the
 * caller of a multi-tenant API is not always the person you hope: "you are not
 * a member of that org" and "no such org" are different sentences, and the
 * difference tells a stranger which tenant ids are real. So every cross-tenant
 * and every role refusal collapses into one opaque `forbidden`.
 *
 * The three that are NOT opaque are all statements about the caller's own
 * account, which they can already read from their own profile:
 *   - profile_missing          you exist in Auth and nowhere else
 *   - not_approved             your membership has not been approved
 *   - password_change_required you are still on a provisioned password
 * The last one has to be distinguishable or a provisioned user is refused
 * everywhere with no hint that the change-password screen is the way out.
 */
export const DENIED = Object.freeze({
  UNAUTHENTICATED: 'unauthenticated',
  PROFILE_MISSING: 'profile_missing',
  NOT_APPROVED: 'not_approved',
  PASSWORD_CHANGE_REQUIRED: 'password_change_required',
  FORBIDDEN: 'forbidden',
})

/**
 * Why `predicateName` refused this caller — or null when it did not refuse.
 *
 * Pure, so the "what do we admit to" decision is table-tested rather than
 * scattered through route handlers. The org check is answered FIRST and
 * opaquely, so nothing further down can leak a fact about the tenant named in
 * the request.
 */
export function denialReason(caller, orgId, predicateName) {
  // A typo'd predicate name must not read as "allowed". Throwing is right here:
  // it is a wiring bug, it is caught by the first request in any environment,
  // and the alternative is a route that silently guards nothing. predicateFor
  // is what makes that true for EVERY name rather than only the unimagined
  // ones — see the Object.prototype trap documented on it.
  const check = predicateFor(predicateName)
  if (check(caller, orgId)) return null

  if (!isSignedIn(caller)) return DENIED.UNAUTHENTICATED
  if (!hasProfile(caller)) return DENIED.PROFILE_MISSING

  // Wrong tenant, no tenant on the profile, or no tenant asked for: one answer.
  const mine = directField(caller.profile.orgId)
  const want = directField(orgId)
  if (mine === null || want === null || mine !== want) return DENIED.FORBIDDEN

  if (directField(caller.profile.status) !== 'approved') return DENIED.NOT_APPROVED
  if (!passwordIsOwn(caller)) return DENIED.PASSWORD_CHANGE_REQUIRED

  // Approved member of the right org, so what is left is the role — including
  // a profile carrying no role at all, which reads and writes nothing.
  return DENIED.FORBIDDEN
}

/**
 * Is this caller's profile usable AT ALL — or null when it is.
 *
 * The gate that runs once per request, before any route's own predicate. It
 * refuses only what makes every downstream predicate impossible, so that the
 * per-route codes stay accurate: `not_approved` and the role refusals belong to
 * the guard that asked, not to the front door.
 *
 * The orgId/status branch is firestore.rules:65-66 read literally. Both are
 * accessed DIRECTLY there, so a profile missing either raises, and a rule that
 * raises denies — everything, every collection, read and write alike. There is
 * nothing such a caller could have gone on to pass, and letting them past the
 * gate would only move the refusal somewhere less obvious.
 *
 * `role` is deliberately NOT checked here. A profile with no role still reads
 * (isApprovedMemberOf never touches the field) and writes nothing (isWriterOf
 * reads it directly and raises). That asymmetry is real and belongs to the
 * predicates.
 */
export function profileGateReason(caller) {
  if (!isSignedIn(caller)) return DENIED.UNAUTHENTICATED
  if (!hasProfile(caller)) return DENIED.PROFILE_MISSING
  if (directField(caller.profile.orgId) === null) return DENIED.FORBIDDEN
  if (directField(caller.profile.status) === null) return DENIED.FORBIDDEN
  return null
}

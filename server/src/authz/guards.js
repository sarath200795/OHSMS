// ─────────────────────────────────────────────────────────────────────────────
// The predicates, wired into express.
//
// Every middleware here answers exactly one question — "does this caller
// satisfy this predicate for this org" — and answers it the way firestore.rules
// answered it. Nothing here decides anything of its own; the deciding is in
// policy.js, pure, next to the rule lines it replaces.
//
// REFUSALS GO TO next(), NOT TO res. src/errors.js owns the response body for
// the whole server and gives the caller a code and a request id, with the
// detail going to the log under the same id. Writing a body here would be a
// second shape, a second log path, and eventually a second opinion about how
// much a 403 is allowed to say.
//
// TWO THINGS THIS FILE IS NOT ALLOWED TO DO.
//
// 1. Say why. A 403 that distinguishes "you are not a member of that org" from
//    "no such org" is a directory of other people's tenants, readable one
//    request at a time by anyone with a login. Every cross-tenant and role
//    refusal leaves here as the same opaque `forbidden`. See DENIED in
//    policy.js for the three that ARE specific and why each is a statement
//    about the caller's own account.
//
// 2. Be the last word. A guard runs before the handler; the write happens
//    after. Rules had no such gap — they evaluate against committed state at
//    write time. Any route that writes must ALSO call assertOrgAccess() against
//    a caller re-read inside its transaction (createCallerStore().reloadCaller).
//    The middleware exists to refuse the obvious cheaply and to make a route's
//    intent readable at its declaration, not to be the only check.
//
// The anonymous QR surfaces (firestore.rules:775-836, 854-891) never come
// through here. They are mounted above the auth middleware entirely and
// validated exhaustively on their own, because the rules learned the hard way
// that a shared handler with an optional-auth flag lets the looser branch
// decide (firestore.rules:762-767).
// ─────────────────────────────────────────────────────────────────────────────

import { AuthzError } from './errors.js'
import { denialReason, predicateFor, profileGateReason, DENIED } from './policy.js'

/**
 * The stage that turns a verified uid into an authorized caller.
 *
 * This is the `requireProfile` src/index.js mounts. It
 * runs after src/auth.js has proved the token and attached `{ uid, staleClaims }`,
 * and it replaces req.caller with the full object every predicate reads from.
 *
 * WHAT IT REFUSES, AND WHAT IT LEAVES TO THE ROUTES. Only the states in which
 * no downstream predicate could possibly pass: no verified uid, no profile
 * document, or a profile missing the orgId or status that firestore.rules:65-66
 * read directly. `not_approved` and every role refusal stay with the guard that
 * asked for them, so the code a caller gets names the check that actually
 * refused.
 *
 * TWO SURFACES MUST BE MOUNTED ABOVE THIS, not adapted to fit through it: the
 * anonymous QR routes, which have no caller at all, and any future
 * signup / change-password route — firestore.rules deliberately exempts /users
 * read and update from passwordIsOwn() (56-58) so the change-password screen
 * can clear the flag it exists to clear, and a profile-shaped gate cannot make
 * that exemption for them.
 */
export function createProfileStage({ loadCaller }) {
  return function requireProfile(req, res, next) {
    const uid = req.caller && req.caller.uid
    if (!uid) {
      // Reached only if this is mounted without src/auth.js in front of it.
      // Fail closed rather than reading a profile for a uid nobody verified.
      next(new AuthzError(DENIED.UNAUTHENTICATED, 'requireProfile reached without a verified uid'))
      return
    }

    Promise.resolve(loadCaller(uid, req.caller.staleClaims)).then((caller) => {
      const reason = profileGateReason(caller)
      if (reason !== null) {
        next(new AuthzError(reason))
        return
      }
      req.caller = caller
      next()
    }, next)
  }
}

/** The default source of the org being asserted: the route path. */
export const orgIdFromParams = (req) => (req && req.params ? req.params.orgId : undefined)

/**
 * Refuse the request unless `predicateName` holds for the caller and the org.
 *
 * `getOrgId` reads the org the request is ASSERTING — a path segment or a body
 * field, both caller-controlled. It is never authority; policy.js compares it
 * against the stored profile, exactly as isApprovedMemberOf(orgId) compares a
 * path segment (firestore.rules:63-68).
 */
export function requireOrgAccess(predicateName, getOrgId = orgIdFromParams) {
  // Fails at wiring time rather than at request time. A guard naming a
  // predicate that does not exist would otherwise be a route that looks guarded
  // in the router and is not — and via an inherited Object.prototype key it
  // would be a route that looks guarded and allows EVERYONE. predicateFor is
  // the own-property lookup that closes both.
  predicateFor(predicateName)
  return function orgAccessMiddleware(req, res, next) {
    // A route that reaches a guard without the profile stage in front of it is
    // a wiring bug, and a 403 would hide it behind something that looks like an
    // ordinary permissions problem. Fail closed AND loudly — nothing is written
    // either way, but only one of the two gets noticed.
    if (!req.caller || !('profile' in req.caller)) {
      next(new Error(`Route reached ${predicateName} without requireProfile`))
      return
    }
    const reason = denialReason(req.caller, getOrgId(req), predicateName)
    if (reason === null) {
      next()
      return
    }
    next(new AuthzError(reason))
  }
}

// Named per predicate so a router reads as the rule does. Kept in step with
// ORG_PREDICATES by a test — a predicate added without a guard fails the suite.
export const requireApprovedMember = (getOrgId) => requireOrgAccess('isApprovedMemberOf', getOrgId)
export const requireWriter = (getOrgId) => requireOrgAccess('isWriterOf', getOrgId)
export const requireManager = (getOrgId) => requireOrgAccess('isManagerOf', getOrgId)
export const requireElevated = (getOrgId) => requireOrgAccess('isElevatedOf', getOrgId)
export const requireAdmin = (getOrgId) => requireOrgAccess('isAdminOf', getOrgId)

/**
 * The same check, throwing, for use INSIDE a transaction.
 *
 * This is the one that actually protects the data. Call it against a caller
 * re-read through the transaction, immediately before the write, so the check
 * and the write commit or abort together.
 */
export function assertOrgAccess(caller, orgId, predicateName) {
  const reason = denialReason(caller, orgId, predicateName)
  if (reason !== null) throw new AuthzError(reason)
}

export const assertApprovedMember = (caller, orgId) => assertOrgAccess(caller, orgId, 'isApprovedMemberOf')
export const assertWriter = (caller, orgId) => assertOrgAccess(caller, orgId, 'isWriterOf')
export const assertManager = (caller, orgId) => assertOrgAccess(caller, orgId, 'isManagerOf')
export const assertElevated = (caller, orgId) => assertOrgAccess(caller, orgId, 'isElevatedOf')
export const assertAdmin = (caller, orgId) => assertOrgAccess(caller, orgId, 'isAdminOf')

// ─────────────────────────────────────────────────────────────────────────────
// The one error an authorization refusal produces.
//
// It extends ApiError rather than standing beside it, for one reason: src/errors.js
// owns the response body for the whole server — `{ error: { code, requestId } }`,
// a code and nothing else, with the detail going to the log under the same id.
// A second error class with a second body shape would mean two ways to be
// refused, and the day they drift is the day one of them starts saying more
// than it should.
//
// So there is no message here and no toResponse(). The caller gets a stable
// code; whoever can read the logs gets everything.
//
// WHAT A CODE MAY SAY. Every cross-tenant and every role refusal collapses into
// one opaque `forbidden`. "You are not a member of that org" and "no such org"
// are different sentences, and the difference is a directory of other people's
// tenants, readable one 403 at a time by anyone with a login. The three codes
// that ARE specific are all statements about the caller's own account, which
// they can already read from their own profile — and the last of them has to be
// distinguishable or a provisioned user is refused everywhere with no hint that
// the change-password screen is the way out.
// ─────────────────────────────────────────────────────────────────────────────

import { ApiError } from '../errors.js'
import { DENIED } from './policy.js'

const STATUSES = Object.freeze({
  [DENIED.UNAUTHENTICATED]: 401,
  [DENIED.PROFILE_MISSING]: 403,
  [DENIED.NOT_APPROVED]: 403,
  [DENIED.PASSWORD_CHANGE_REQUIRED]: 403,
  [DENIED.FORBIDDEN]: 403,
})

/**
 * 403 for an unrecognised code: an unknown refusal is still a refusal.
 *
 * Object.hasOwn rather than `STATUSES[code] || 403`, for the reason spelled out
 * on predicateFor in policy.js. STATUSES inherits from Object.prototype, so
 * `STATUSES['constructor']` is the Object constructor — truthy, so `|| 403`
 * never fires, and the "status" handed to res.status() is a FUNCTION. Express
 * throws on it, and a refusal that was meant to be a 403 leaves as a 500
 * carrying a stack trace from the error path itself.
 *
 * Not reachable today: AuthzError is only ever constructed with a DENIED
 * constant. It is one line to make the sentence above true for every input
 * rather than for the inputs we currently happen to pass.
 */
export const statusFor = (code) => (Object.hasOwn(STATUSES, code) ? STATUSES[code] : 403)

/**
 * A refusal, carried to the app's error handler.
 *
 * `detail` reaches the LOG and never the response. Nothing sensitive belongs in
 * it — not the org, not the profile, and never a token. The token in particular
 * cannot arrive here at all: this module never sees one, because verification
 * lives in src/auth.js and is finished before src/authz/ is reached.
 */
export class AuthzError extends ApiError {
  constructor(code, detail) {
    super(statusFor(code), code, detail)
    this.name = 'AuthzError'
  }
}

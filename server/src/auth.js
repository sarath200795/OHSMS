// ─────────────────────────────────────────────────────────────────────────────
// Who is calling. Nothing about what they may do.
//
// This middleware answers exactly one question — is this a valid, current ID
// token from our Firebase project — and attaches the uid it proves. Every
// decision that follows belongs to src/authz/, against the LIVE /users
// profile, never against what the token says.
//
// WHY THE TOKEN'S CLAIMS ARE NOT AUTHORITY HERE. functions/lib/claims.js
// stamps {orgId, role} onto the token, and an ID token lives for up to an
// hour. firestore.rules never reads either: it re-reads /users on every single
// evaluation, so a revocation lands instantly. The claims exist only because
// Cloud Storage rules cannot query Firestore.
//
// The gap is not theoretical. `revokesAccess()` (claims.js:85-103) revokes
// refresh tokens on exactly two transitions, and member → auditor is not one
// of them: `wasElevated` is false, so nothing fires, and the freshly demoted
// auditor's token still says `role: 'member'` for the rest of the hour. A
// server that branched on the role claim would let them WRITE for that hour —
// which is precisely the failure isWriterOf was introduced to close
// (firestore.rules:81-89). `mustChangePassword` is not a claim key at all, so a
// provisioned account's token looks perfectly healthy while passwordIsOwn()
// denies it everything.
//
// That is why the claims are attached under the name `staleClaims`: they are
// fine to log and fine to assert against the profile, and any code that
// branches on them has to type the word "stale" to do it.
// ─────────────────────────────────────────────────────────────────────────────
import { getAdminAuth } from './firestore.js'
import { log } from './log.js'

/**
 * Whether to ask Firebase if the token's refresh token has been revoked.
 *
 * On by default. It costs a lookup per request and it is NOT a substitute for
 * reading the profile — it misses every transition listed above — but it is
 * the one net that catches a session an admin explicitly killed. Switchable
 * because that lookup is a dependency on Firebase being reachable, and a
 * degraded-mode decision is better made with an env var than with a redeploy.
 */
const checkRevoked = () => process.env.AUTH_CHECK_REVOKED !== 'false'

/**
 * Which failure this was, in words an operator can grep and alert on.
 *
 * All four collapse to the same 401 for the caller. They must not collapse in
 * the log: "your token expired, refresh it" and "this token was revoked" are
 * a client bug and a possible intrusion respectively, and telling them apart
 * after the fact is impossible if the server wrote the same line for both.
 */
export function reasonFor(err) {
  switch (err?.code) {
    case 'auth/id-token-expired':
      return 'token_expired'
    case 'auth/id-token-revoked':
    case 'auth/session-cookie-revoked':
      return 'token_revoked'
    case 'auth/user-disabled':
      return 'user_disabled'
    case 'auth/argument-error':
    case 'auth/invalid-id-token':
    case 'auth/invalid-argument':
      return 'token_malformed'
    default:
      return 'verification_failed'
  }
}

/**
 * Pull the token out of `Authorization: Bearer <token>`.
 *
 * Returns the reason instead of the token when there isn't one, so the caller
 * logs the same vocabulary for a missing header as for a rejected token.
 */
export function bearerToken(header) {
  if (!header) return { reason: 'no_authorization_header' }
  if (typeof header !== 'string') return { reason: 'malformed_authorization_header' }

  // The scheme is case-insensitive (RFC 7235). A client sending `bearer` is
  // not an attacker and should not spend an afternoon on a blank 401.
  const match = /^Bearer[ ]+(.+)$/i.exec(header.trim())
  if (!match) return { reason: 'malformed_authorization_header' }

  const token = match[1].trim()
  // A JWT has no spaces. Catching it here keeps a header like
  // "Bearer undefined extra" from reaching Firebase as a network round trip.
  if (!token || /\s/.test(token)) return { reason: 'malformed_authorization_header' }

  return { token }
}

/** One body for every rejection. The reason lives in the log, never here. */
function refuse(res, requestId) {
  res.status(401).json({ error: { code: 'unauthenticated', requestId } })
}

/**
 * Verify the caller's ID token and attach them to the request.
 *
 * Attaches `req.caller = { uid, staleClaims }` and nothing else. `uid` is the
 * only auth-derived value firestore.rules trusts (it appears at lines 27, 31,
 * 36, 536, 579, 594, 604, 634, 649 and 692 and is the sole such value in the
 * file), so it is the only one this hands on.
 */
export async function requireAuth(req, res, next) {
  const requestId = res.locals?.requestId
  const { token, reason } = bearerToken(req.get('authorization'))

  if (!token) {
    // Never the header value, not even truncated. A prefix of a JWT is still
    // a piece of a credential, and the algorithm header it decodes to tells
    // an attacker reading logs nothing useful anyway.
    log.warn('auth refused', { requestId, reason, method: req.method, path: req.path })
    return refuse(res, requestId)
  }

  let decoded
  try {
    decoded = await getAdminAuth().verifyIdToken(token, checkRevoked())
  } catch (err) {
    log.warn('auth refused', {
      requestId,
      reason: reasonFor(err),
      code: err?.code,
      method: req.method,
      path: req.path,
    })
    return refuse(res, requestId)
  }

  req.caller = {
    uid: decoded.uid,
    // Named for what they are. Up to an hour behind /users — see the header.
    // Log them, compare them against the profile, never decide with them.
    staleClaims: Object.freeze({ orgId: decoded.orgId ?? null, role: decoded.role ?? null }),
  }

  next()
}

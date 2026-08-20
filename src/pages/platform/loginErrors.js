// ─────────────────────────────────────────────────────────────────────────────
// What the operator sign-in is willing to say when it refuses.
//
// One sentence for every outcome that concerns the ACCOUNT — no such address,
// wrong password, disabled, valid but not an operator. Distinguishing them lets
// someone test, one guess at a time, whether an address is one of the handful
// that can reconfigure every customer on the platform. On the customer login
// that reasoning already collapses "no account" into "wrong password"; here it
// has to go one step further and collapse "not an operator" in with them.
//
// An ALLOWLIST, not a blocklist, and that is the point. authErrorMessage falls
// back to Firebase's raw `err.message` for any code it has never heard of — a
// real message from a real backend, phrased for a developer. That is how
// `auth/requests-from-referer-…-are-blocked` arrived on screen verbatim, naming
// the deployment. Harmless that time. But a blocklist only hides the codes
// somebody thought of, and the failure mode is silent: a new SDK version adds a
// code, nobody updates the list, and the page starts explaining itself again.
// Defaulting to the refusal means an unknown code says nothing.
//
// The exceptions below are all about the REQUEST rather than the account: a
// network that dropped, a rate limit, a second-factor code that was mistyped.
// None of them reveal whether the account exists, whether the password was
// right, or whether it carries the grant — and each one leaves the person with
// something they can actually do about it. Telling someone "that account cannot
// sign in here" when their wifi died would be a lie that costs an afternoon.
//
// The second-factor codes are safe for a further reason: reaching a code prompt
// at all means the password was already accepted, so nothing is given away that
// the person does not already hold.
// ─────────────────────────────────────────────────────────────────────────────
import { authErrorMessage } from '../../shared/lib/authErrors'

/** The single sentence. Every account-related refusal uses exactly this. */
export const REFUSED = 'That account cannot sign in here.'

const SPEAKS_FOR_ITSELF = new Set([
  'auth/too-many-requests',
  'auth/network-request-failed',
  'auth/invalid-verification-code',
  'auth/missing-code',
  'auth/code-expired',
  'auth/totp-challenge-timeout',
])

/**
 * The message to show for a failed operator sign-in.
 *
 * Anything not explicitly allowed through becomes REFUSED — including a null
 * error, a bare string, and codes that do not exist yet.
 */
export function operatorLoginMessage(err) {
  const code = err && typeof err === 'object' ? err.code : null
  return SPEAKS_FOR_ITSELF.has(code) ? authErrorMessage(err) : REFUSED
}

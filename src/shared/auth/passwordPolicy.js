/**
 * One definition of what counts as an acceptable password.
 *
 * There were three, and they disagreed: registering an organization and joining
 * one each demanded six characters, while the forced-change screen demanded
 * eight. So the founder of a tenant — the account that can promote roles,
 * rewrite everyone's site access and read every module — could be protected by
 * six characters, and the rule the product actually believed in was only
 * applied to people who had already been let in.
 *
 * Client-side, and honest about it: with no application server, Firebase Auth
 * is the only thing that can truly refuse a weak password, and that is a
 * console setting (Identity Platform → password policy). This makes the app
 * consistent and gives a usable message; PRODUCTION.md carries the console half.
 */

/** Ten, not six. Long enough to matter, short enough that nobody writes it down. */
export const MIN_PASSWORD_LENGTH = 10

// Rejected outright regardless of length. Not a serious dictionary — the point
// is to catch the handful that get typed when someone is in a hurry, which is
// exactly when a provisioned account gets its "temporary" password.
const OBVIOUS = [
  'password', 'passw0rd', 'welcome', 'letmein', 'qwerty', 'admin',
  'changeme', 'iloveyou', 'monkey', 'dragon', 'football',
]

/**
 * Returns an error string, or '' when the password is acceptable.
 *
 * A string rather than a boolean because every caller has to tell somebody what
 * is wrong, and three callers inventing their own wording is how they drifted
 * apart in the first place.
 */
export function validatePassword(password, { email = '', name = '' } = {}) {
  const pw = String(password ?? '')

  if (!pw) return 'Enter a password'
  if (pw.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
  }
  // Leading or trailing spaces survive a paste and then cannot be typed back
  // reliably — a password nobody can re-enter is a lockout, not a control.
  if (pw !== pw.trim()) return 'Password cannot start or end with a space'

  const lower = pw.toLowerCase()
  if (OBVIOUS.some((w) => lower === w || lower.startsWith(w))) {
    return 'That password is too easy to guess'
  }

  // Their own name or email local-part is the first thing anyone tries, and the
  // first thing an admin picks when inventing a temporary password.
  const local = String(email || '').split('@')[0].toLowerCase()
  if (local.length >= 4 && lower.includes(local)) return 'Password cannot contain your email address'
  const first = String(name || '').trim().split(/\s+/)[0]?.toLowerCase() || ''
  if (first.length >= 4 && lower.includes(first)) return 'Password cannot contain your name'

  // A single repeated character reaches any length and defeats a length rule.
  if (/^(.)\1+$/.test(pw)) return 'Password cannot be one repeated character'

  return ''
}

/** Convenience for a form that only wants to know. */
export const isAcceptablePassword = (password, ctx) => validatePassword(password, ctx) === ''

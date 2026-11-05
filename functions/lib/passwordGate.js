// ─────────────────────────────────────────────────────────────────────────────
// When a provisioned account may leave the temporary password behind.
//
// mustChangePassword is what passwordIsOwn() trusts. A client that can set it
// to false never has to change the Auth password, so the temporary password
// the provisioning admin was shown keeps working. Rules refuse every client
// clear. This module is the only decision that may lift the flag, and it does
// not trust a session.
//
// tokensValidAfterTime is not an input. Sign-in, token refresh, reauth and
// revokeRefreshTokens all move it, and none of them replace the password.
// passwordHash is not an input either. Auth re-salts on every password write,
// including a write of the same string, and the Admin SDK does not return the
// hash unless the caller has firebaseauth.configs.getHashConfig — which the
// platform's own Admin SDK service account does not have by default
// (Manage Users → "Password hashes of listed users"). An inequality against a
// hash we often cannot read, and which moves when the string did not, is not
// a proof.
//
// The proof is the Auth service itself. The callable learns the password the
// account has now by asking Identity Toolkit to sign in with it, refuses when
// the proposed password is that same string, and only then calls Admin
// updateUser to replace it. The flag is cleared after that call returns. A
// sign-in that is not followed by a different password does not clear anything.
//
// The password is an argument to Auth and nothing else. It is not logged, not
// written to Firestore, and not returned. authGates/{uid} holds only a sha256
// of the candidate, and only so a crash between updateUser and the flag write
// can be finished without setting a third password. It is deleted once the
// flag is cleared. Clients cannot read it.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from 'node:crypto'

/** How long after auth_time a completion attempt is still this sign-in. */
export const PASSWORD_GATE_FRESH_MS = 5 * 60 * 1000

const MIN_PASSWORD_LENGTH = 10

// The same short list as src/shared/auth/passwordPolicy.js. The two packages
// cannot import each other. A temporary password an admin invents in a hurry
// is the case this list exists for, so the server has to apply it too: the
// client check is not what stops a direct callable.
const OBVIOUS = [
  'password', 'passw0rd', 'welcome', 'letmein', 'qwerty', 'admin',
  'changeme', 'iloveyou', 'monkey', 'dragon', 'football',
]

/**
 * '' when the replacement is acceptable, otherwise a message safe to show.
 * Mirrors validatePassword. Email and name are the account's, not the request's.
 */
export function replacementError(password, { email = '', name = '' } = {}) {
  const pw = typeof password === 'string' ? password : ''
  if (!pw) return 'Enter a password'
  if (pw.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
  }
  if (pw !== pw.trim()) return 'Password cannot start or end with a space'
  const lower = pw.toLowerCase()
  if (OBVIOUS.some((w) => lower === w || lower.startsWith(w))) {
    return 'That password is too easy to guess'
  }
  const local = String(email || '').split('@')[0].toLowerCase()
  if (local.length >= 4 && lower.includes(local)) return 'Password cannot contain your email address'
  const first = String(name || '').trim().split(/\s+/)[0]?.toLowerCase() || ''
  if (first.length >= 4 && lower.includes(first)) return 'Password cannot contain your name'
  if (/^(.)\1+$/.test(pw)) return 'Password cannot be one repeated character'
  return ''
}

/**
 * The ID token's auth_time is recent enough that this is the sign-in the
 * person is sitting in. Freshness is required and is not the proof: reauth
 * makes a token fresh and still does not change the password.
 */
export function authIsFresh(authTimeSec, nowMs, windowMs = PASSWORD_GATE_FRESH_MS) {
  const t = Number(authTimeSec)
  if (!Number.isFinite(t) || !Number.isFinite(nowMs)) return false
  const age = nowMs - t * 1000
  return age >= -60_000 && age <= windowMs
}

/** sha256 of the candidate. Not the password, and not written anywhere else. */
export function commitmentOf(password) {
  return createHash('sha256').update(String(password), 'utf8').digest('hex')
}

/**
 * Where a password check is sent.
 *
 * The Auth emulator does not check the API key. Production Identity Toolkit
 * does, and a browser key locked to HTTP referrers will not accept a call
 * from Cloud Functions — that refusal must stay a refusal, not a bypass.
 * Returns null when production has no key, which the caller treats as
 * "cannot verify" and does not clear the flag.
 */
export function signInEndpoint({ emulatorHost = '', apiKey = '' } = {}) {
  const host = String(emulatorHost || '').replace(/^https?:\/\//, '').replace(/\/$/, '')
  if (host) {
    return `http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator`
  }
  if (!apiKey) return null
  return `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`
}

/**
 * 'current' | 'not-current' | 'unavailable'.
 *
 * Only INVALID_PASSWORD / INVALID_LOGIN_CREDENTIALS mean "this is not the
 * password on the account". Anything else — a referrer-blocked key, a network
 * failure, a 500 — is unavailable, and unavailable does not clear the flag.
 */
export function classifySignInResponse(httpStatus, errorMessage) {
  if (httpStatus >= 200 && httpStatus < 300) return 'current'
  const code = String(errorMessage || '')
  if (code.includes('INVALID_PASSWORD') || code.includes('INVALID_LOGIN_CREDENTIALS')) {
    return 'not-current'
  }
  return 'unavailable'
}

/**
 * Ask Identity Toolkit whether this password is the one on the account.
 * The success body can contain tokens even when we asked it not to; it is
 * discarded unread. The error body is read only for the Auth error code.
 */
export async function postPasswordSignIn(fetchImpl, url, email, password) {
  if (!url || !email) return 'unavailable'
  let res
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: false }),
    })
  } catch {
    return 'unavailable'
  }
  if (res.ok) {
    await res.text?.().catch(() => {})
    return 'current'
  }
  let message = ''
  try {
    const data = await res.json()
    message = data?.error?.message || ''
  } catch {
    message = ''
  }
  return classifySignInResponse(res.status, message)
}

/**
 * Replace the password and lift the flag, or do neither.
 *
 * `signIn` is Identity Toolkit, not a session we trust: 'current' means the
 * string is the password on the account right now. Equal strings stop here.
 * updateUser runs only after that, and the flag moves only after updateUser
 * returns. If the flag write fails, a retry that signs in with the password
 * we just set finds the committed marker and finishes the clear — it does
 * not get to skip the replacement, because the marker is written only after
 * a sign-in proved the candidate was not the current password, and flipped
 * to committed only after updateUser.
 */
export async function applyPasswordChange({
  uid,
  authTime,
  now,
  email,
  name,
  flag,
  current,
  password,
  marker,
  signIn,
  updatePassword,
  writeMarker,
  clearFlag,
  deleteMarker,
}) {
  if (!uid) return { ok: false, reason: 'unauthenticated' }
  if (!authIsFresh(authTime, now)) return { ok: false, reason: 'stale' }
  if (flag !== true) return { ok: true, reason: 'not-required' }

  const policy = replacementError(password, { email, name })
  if (policy) return { ok: false, reason: 'policy', message: policy }
  if (typeof current !== 'string' || current.length === 0) {
    return { ok: false, reason: 'current-required' }
  }
  if (!email) return { ok: false, reason: 'unavailable' }

  let known
  try {
    known = await signIn(email, current)
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
  if (known === 'unavailable') return { ok: false, reason: 'unavailable' }
  if (known !== 'current') return { ok: false, reason: 'current-rejected' }

  if (current === password) {
    const commit = typeof marker?.sha256 === 'string' ? marker.sha256 : ''
    if (marker?.committed === true && commit && commit === commitmentOf(password)) {
      try {
        await clearFlag(uid)
      } catch (err) {
        return { ok: false, reason: 'flag-unchanged', code: err?.code || '' }
      }
      await deleteMarker(uid).catch(() => {})
      return { ok: true, reason: 'replaced' }
    }
    return { ok: false, reason: 'unchanged' }
  }

  const sha256 = commitmentOf(password)
  await writeMarker(uid, { sha256, committed: false })
  try {
    await updatePassword(uid, password)
  } catch (err) {
    return { ok: false, reason: 'not-updated', code: err?.code || '' }
  }
  await writeMarker(uid, { sha256, committed: true })
  try {
    await clearFlag(uid)
  } catch (err) {
    return { ok: false, reason: 'flag-unchanged', code: err?.code || '' }
  }
  await deleteMarker(uid).catch(() => {})
  return { ok: true, reason: 'replaced' }
}

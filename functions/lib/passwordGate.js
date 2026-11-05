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
// The password is an argument to Auth for this call and nothing else. It is
// not logged, not written to Firestore, and not returned. A crash between
// updateUser and the flag write is recovered with authGates/{uid}, which holds
// a random nonce, a phase, and an expiry — not a password and not a digest of
// one. Clients cannot read it. It is deleted when the flag moves, and an
// expired lock is ignored so a failed attempt cannot sit there forever.
// ─────────────────────────────────────────────────────────────────────────────
import { randomBytes } from 'node:crypto'

/** How long after auth_time a completion attempt is still this sign-in. */
export const PASSWORD_GATE_FRESH_MS = 5 * 60 * 1000

/** How long an in-flight lock may block another attempt. Not a password lifetime. */
export const PASSWORD_GATE_LOCK_MS = 10 * 60 * 1000

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

/** A lock we will still honour. Expired, malformed, or unknown phases are absent. */
export function lockState(marker, now) {
  if (!marker || typeof marker !== 'object') return null
  const nonce = marker.nonce
  if (typeof nonce !== 'string' || !/^[a-f0-9]{64}$/.test(nonce)) return null
  if (marker.phase !== 'pending' && marker.phase !== 'committed') return null
  const exp = Number(marker.expiresAtMs)
  if (!Number.isFinite(exp) || !Number.isFinite(now) || exp <= now) return null
  return { nonce, phase: marker.phase, expiresAtMs: exp }
}

/**
 * Drop the lock when the profile goes away or the requirement changes.
 * A name edit that leaves the flag true must not drop it: that is the retry
 * after a failed flag write. Imposing the requirement again must drop it, or
 * a committed lock from the previous change would finish the new one.
 */
export function gateLockShouldDrop(before, after) {
  if (!after) return true
  return (before?.mustChangePassword === true) !== (after?.mustChangePassword === true)
}

/** An Auth error code safe to log. Anything else, including a message, is dropped. */
export function safeAuthCode(code) {
  const s = typeof code === 'string' ? code : ''
  return /^[a-z0-9/_-]{1,64}$/i.test(s) ? s : ''
}

/** The leading Identity Toolkit code, with the rest of the message discarded. */
export function authErrorCode(message) {
  const token = String(message || '').trim().split(/[\s:]/, 1)[0]
  return /^[A-Z0-9_]{1,64}$/.test(token) ? token : ''
}

export function newLockNonce() {
  return randomBytes(32).toString('hex')
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
  const code = authErrorCode(errorMessage)
  if (code === 'INVALID_PASSWORD' || code === 'INVALID_LOGIN_CREDENTIALS') return 'not-current'
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
 * string is the password on the account right now. Equal strings do not call
 * updateUser. The one exception is a lock this process already committed
 * after updateUser returned and the flag write then failed: signing in with
 * that same new password finishes the clear. A pending lock is not that
 * proof — updateUser may have thrown — so it cannot clear the flag.
 *
 * The lock stores a random nonce. claimLock must refuse when another
 * unexpired lock is already held, so two completions cannot both call
 * updateUser. releaseLock must delete only its own nonce.
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
  claimLock,
  commitLock,
  releaseLock,
  clearFlag,
  nonce = newLockNonce,
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

  const live = lockState(marker, now)
  if (current === password) {
    if (live?.phase !== 'committed') return { ok: false, reason: 'unchanged' }
    try {
      await clearFlag(uid)
    } catch (err) {
      return { ok: false, reason: 'flag-unchanged', code: safeAuthCode(err?.code) }
    }
    await releaseLock(live.nonce).catch(() => {})
    return { ok: true, reason: 'replaced' }
  }

  if (live?.phase === 'pending') return { ok: false, reason: 'busy' }
  if (live?.phase === 'committed') return { ok: false, reason: 'finish-pending' }

  const id = nonce()
  const expiresAtMs = now + PASSWORD_GATE_LOCK_MS
  let claimed = false
  try {
    claimed = await claimLock({ nonce: id, expiresAtMs })
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
  if (!claimed) return { ok: false, reason: 'busy' }

  try {
    await updatePassword(uid, password)
  } catch (err) {
    await releaseLock(id).catch(() => {})
    return { ok: false, reason: 'not-updated', code: safeAuthCode(err?.code) }
  }

  let committed = false
  try {
    committed = await commitLock(id, expiresAtMs)
  } catch {
    return { ok: false, reason: 'busy' }
  }
  if (!committed) return { ok: false, reason: 'busy' }

  try {
    await clearFlag(uid)
  } catch (err) {
    return { ok: false, reason: 'flag-unchanged', code: safeAuthCode(err?.code) }
  }
  await releaseLock(id).catch(() => {})
  return { ok: true, reason: 'replaced' }
}

/**
 * In-memory lock with the same rules as the Firestore transaction: one holder,
 * nonce-checked commit and release, expired locks ignored. Tests and the
 * Auth emulator exercise races through this. Production uses a transaction
 * that calls lockState the same way.
 */
export function createSerialLock(nowFn = () => Date.now()) {
  let doc = null
  let chain = Promise.resolve()
  const run = (fn) => {
    const next = chain.then(fn, fn)
    chain = next.then(() => {}, () => {})
    return next
  }
  return {
    read: () => doc,
    claimLock: (record) => run(() => {
      if (lockState(doc, nowFn())) return false
      doc = { nonce: record.nonce, phase: 'pending', expiresAtMs: record.expiresAtMs }
      return true
    }),
    commitLock: (id, expiresAtMs) => run(() => {
      const live = lockState(doc, nowFn())
      if (!live || live.nonce !== id || live.phase !== 'pending') return false
      doc = { nonce: id, phase: 'committed', expiresAtMs }
      return true
    }),
    releaseLock: (id) => run(() => {
      if (doc && doc.nonce === id) doc = null
    }),
  }
}

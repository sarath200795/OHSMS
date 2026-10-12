// ─────────────────────────────────────────────────────────────────────────────
// Meta webhook authentication.
//
// The webhook is the project's first public, unauthenticated HTTP surface, so
// nothing in a request is believed until it has passed here:
//
//   GET   the subscription handshake: hub.mode=subscribe and a hub.verify_token
//         equal to the WA_VERIFY_TOKEN secret, answered with hub.challenge
//   POST  X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of the RAW body, keyed
//         with the Meta App Secret>
//
// The HMAC is computed over req.rawBody, the bytes Meta signed. Hashing a
// re-serialised JSON object is the classic failure: key order, whitespace and
// unicode escapes differ, every genuine message fails, and the "fix" people
// reach for is to stop checking.
//
// Comparisons are constant-time. A placeholder secret (what the deploy step
// creates when the real value has not been set yet) never authenticates
// anything: anyone who has read this repository knows the placeholder.
// ─────────────────────────────────────────────────────────────────────────────
import { createHmac, timingSafeEqual } from 'node:crypto'

export const PLACEHOLDER_SECRET = 'UNSET-PLACEHOLDER'

/** A secret that is set to something other than the deploy placeholder. */
export function isRealSecret(value) {
  const v = typeof value === 'string' ? value.trim() : ''
  return v.length >= 8 && v !== PLACEHOLDER_SECRET
}

/** Constant-time string equality that does not leak length through an exception. */
export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''), 'utf8')
  const y = Buffer.from(String(b ?? ''), 'utf8')
  if (x.length !== y.length) {
    // Still spend the comparison so a length mismatch is not measurably faster.
    timingSafeEqual(x, x)
    return false
  }
  return timingSafeEqual(x, y)
}

/** The hex digest Meta should have sent for these bytes. */
export function expectedSignature(rawBody, appSecret) {
  return createHmac('sha256', appSecret).update(rawBody).digest('hex')
}

/**
 * Whether `header` (X-Hub-Signature-256) is a valid signature of `rawBody`.
 * rawBody must be the Buffer exactly as received.
 */
export function verifySignature(rawBody, header, appSecret) {
  if (!isRealSecret(appSecret)) return false
  if (!Buffer.isBuffer(rawBody) && typeof rawBody !== 'string') return false
  const m = /^sha256=([0-9a-f]{64})$/i.exec(String(header ?? '').trim())
  if (!m) return false
  const want = Buffer.from(expectedSignature(rawBody, appSecret), 'hex')
  const got = Buffer.from(m[1].toLowerCase(), 'hex')
  return want.length === got.length && timingSafeEqual(want, got)
}

/**
 * The GET handshake. Returns the challenge to echo, or null to refuse (403).
 * The challenge is echoed as text, so it is restricted to a short token of
 * safe characters rather than reflecting arbitrary input back.
 */
export function handshakeChallenge(query = {}, verifyToken) {
  if (!isRealSecret(verifyToken)) return null
  if (query['hub.mode'] !== 'subscribe') return null
  if (!safeEqual(query['hub.verify_token'], verifyToken)) return null
  const challenge = String(query['hub.challenge'] ?? '')
  return /^[A-Za-z0-9._-]{1,128}$/.test(challenge) ? challenge : null
}

// ─────────────────────────────────────────────────────────────────────────────
// Proof that a WhatsApp number belongs to an app user.
//
// The user asks the app for a code (startWhatsAppLink), and sends "LINK <code>"
// FROM the phone. The webhook then knows both halves: the signed-in uid that
// asked for the code, and the wa_id Meta says sent it. An admin typing numbers
// into a form would be an unverified mapping — a typo would hand one person's
// site data to another's phone — so there is no such form.
//
// Codes are six digits, single-use, valid for ten minutes, and stored only as a
// SHA-256 digest. Five wrong codes from one number in a day block that number
// from linking for 24 hours (see rateLimit.js), which keeps a million-code space
// out of reach of guessing within a code's lifetime.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash, createHmac, randomInt } from 'node:crypto'

export const LINK_CODE_TTL_MS = 10 * 60 * 1000

/** A uniformly random six-digit code, leading zeros kept. */
export function generateLinkCode(rand = randomInt) {
  return String(rand(0, 1_000_000)).padStart(6, '0')
}

export function hashLinkCode(code) {
  return createHash('sha256').update(`wa-link:${code}`).digest('hex')
}

/**
 * Whether a stored code record may be redeemed now.
 * @returns { ok: true } | { ok: false, reason: 'missing'|'expired'|'malformed' }
 */
export function redeemable(record, now = Date.now()) {
  if (!record) return { ok: false, reason: 'missing' }
  if (
    typeof record.uid !== 'string' ||
    !record.uid ||
    typeof record.orgId !== 'string' ||
    !record.orgId
  ) {
    return { ok: false, reason: 'malformed' }
  }
  const expires = Number(record.expiresAtMs)
  if (!Number.isFinite(expires) || expires <= now) return { ok: false, reason: 'expired' }
  return { ok: true }
}

/**
 * A keyed digest of a phone number for logs and counters.
 *
 * Keyed, not a bare hash: India's mobile space is ~10^10 numbers, which a
 * laptop enumerates against an unkeyed SHA-256 in minutes. The key is derived
 * from a secret the function already holds, so the digest is useless to anyone
 * who has only the database.
 */
export function phoneHash(pepper, waId) {
  return createHmac('sha256', String(pepper)).update(`wa-phone:${waId}`).digest('hex').slice(0, 32)
}

/** Ledger key for a message id. wamids are base64 and may contain '/'. */
export function inboundId(wamid) {
  return createHash('sha256').update(`wamid:${wamid}`).digest('hex')
}

/** "+•• ••••• 4821" — enough for a person to recognise their own number. */
export function maskPhone(waId) {
  const digits = String(waId ?? '').replace(/\D/g, '')
  if (digits.length < 4) return ''
  return `•••• ${digits.slice(-4)}`
}

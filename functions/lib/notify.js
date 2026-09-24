// ─────────────────────────────────────────────────────────────────────────────
// Delivery ledger. firestore.rules names this file, and the comment there is
// the specification: sendOnce() claims organizations/{orgId}/notifications/{id}
// BEFORE it sends, and the claim carries the recipient uid and the subject.
//
// A row already at that id is how a mail is skipped. That is what makes a
// trigger retry safe, and it is also why the rules refuse every client write —
// a member who can pre-seed the id can suppress a mail they are not allowed
// to read. The Admin SDK bypasses those rules, which is the only writer.
//
// At most once, on purpose. Claiming before the send means a crash between
// the two does not produce a second copy on the retry; the retry sees the
// claim and stops. A lost mail is recovered by assigning again, not by
// rolling back a write that has already committed.
//
// The exception is a rate-limit refusal. The server said it did not accept
// the message, so the claim is removed and a later delivery may send it.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from 'node:crypto'
import { isSmtpRateLimit } from './mailPace.js'

// The rules test seeds a row claimed on 4 Jan and expiring on 3 Feb: thirty
// days. Nothing deletes on this date today. It is here so the shape the rules
// were written against stays the shape this file writes, and so a later sweep
// has a bound that was chosen when the row was created rather than invented
// afterwards.
const LEDGER_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Stable id for a logical send. The same key always names the same document,
 * which is the whole of the dedupe. Hex, so it is a legal document id.
 */
export function notificationId(key) {
  const parts = (Array.isArray(key) ? key : [key]).map((part) => String(part ?? ''))
  return createHash('sha256').update(parts.join('\u001f')).digest('hex')
}

/** Firestore admin reports "already exists" as gRPC code 6 or the string form. */
export function isAlreadyExists(err) {
  const code = err?.code
  return code === 6 || code === 'already-exists' || code === 'ALREADY_EXISTS'
}

/**
 * Claim `ref`, then call `send`. `send` is only invoked when this call won
 * the claim.
 *
 * Returns `{ status: 'sent' | 'skipped' | 'failed', reason? }`. A failed send
 * is written onto the row and is NOT rethrown: the caller has already been
 * told the claim exists, and throwing would make the platform retry a send
 * the next attempt is required to skip. A failure to claim (Firestore down)
 * IS rethrown, because nothing was sent and a retry is the right recovery.
 *
 * A Private Email rate-limit refusal is the exception. 554 "too many
 * messages" means the message was not accepted. Leaving status:failed
 * there made the next delivery skip it forever. The claim is deleted so
 * the same key can be sent once the hourly window has room. Any other
 * SMTP error still stays claimed: an ambiguous failure may have accepted
 * the message, and a retry would be a second copy.
 */
export async function sendOnce({ ref, kind, key, uid, subject, now, send }) {
  const claimedAt = now instanceof Date ? now : new Date()
  const claim = {
    kind,
    key,
    uid,
    subject,
    status: 'claimed',
    claimedAt,
    expiresAt: new Date(claimedAt.getTime() + LEDGER_TTL_MS),
  }
  try {
    await ref.create(claim)
  } catch (err) {
    if (!isAlreadyExists(err)) throw err
    const row = await existingRow(ref)
    // Delete failed on the earlier refusal, so the row records why a retry
    // is allowed. Drop it and claim again. Two retries racing: one create
    // wins, the other sees the new claim and skips.
    if (!isRetryableRateLimit(row)) return { status: 'skipped', reason: 'already-claimed' }
    try {
      await ref.delete()
    } catch {
      /* create below fails closed if the row is still there */
    }
    try {
      await ref.create(claim)
    } catch (again) {
      if (isAlreadyExists(again)) return { status: 'skipped', reason: 'already-claimed' }
      throw again
    }
  }

  try {
    await send()
  } catch (err) {
    if (isSmtpRateLimit(err)) {
      const released = await releaseClaim(ref)
      if (!released) {
        try {
          await ref.update({ status: 'rate-limited', failure: 'rate-limited' })
        } catch {
          /* a stuck 'claimed' row still suppresses; the delete is the fix */
        }
      }
      return { status: 'failed', reason: 'rate-limited', error: err }
    }
    // Best effort. If this update fails the row stays 'claimed', which still
    // suppresses a retry — the same outcome as 'failed', with a less honest
    // status. Either is preferable to a second copy of the mail.
    try {
      await ref.update({ status: 'failed' })
    } catch {
      /* the claim is what matters */
    }
    return { status: 'failed', reason: 'send-failed', error: err }
  }

  try {
    await ref.update({ status: 'sent' })
  } catch {
    /* mail already left; do not send it again to tidy the row */
  }
  return { status: 'sent' }
}

function isRetryableRateLimit(row) {
  return row?.status === 'rate-limited' || row?.failure === 'rate-limited'
}

async function existingRow(ref) {
  if (typeof ref.get !== 'function') return null
  try {
    const snap = await ref.get()
    const exists = typeof snap?.exists === 'function' ? snap.exists() : Boolean(snap?.exists)
    if (!exists) return null
    return typeof snap.data === 'function' ? snap.data() : null
  } catch {
    return null
  }
}

async function releaseClaim(ref) {
  if (typeof ref.delete !== 'function') return false
  try {
    await ref.delete()
    return true
  } catch {
    return false
  }
}

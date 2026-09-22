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
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from 'node:crypto'

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
 */
export async function sendOnce({ ref, kind, key, uid, subject, now, send }) {
  const claimedAt = now instanceof Date ? now : new Date()
  try {
    await ref.create({
      kind,
      key,
      uid,
      subject,
      status: 'claimed',
      claimedAt,
      expiresAt: new Date(claimedAt.getTime() + LEDGER_TTL_MS),
    })
  } catch (err) {
    if (isAlreadyExists(err)) return { status: 'skipped', reason: 'already-claimed' }
    throw err
  }

  try {
    await send()
  } catch (err) {
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

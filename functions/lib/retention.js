/**
 * Making the Recycle Bin's promise true.
 *
 * The screen says "Auto-purged after 30 days" and renders a per-row countdown.
 * Nothing implemented it: soft-deleted records sat in the database for as long
 * as the project existed, including illness records carrying health data,
 * unless a human remembered to click Purge. The countdown ran down to zero and
 * then kept going.
 *
 * A stated retention period that nothing enforces is worse than none at all —
 * it is a control an auditor will test, a claim a data subject can rely on, and
 * the reason someone stops worrying about the delete they performed.
 *
 * Pure planning only. Nothing here reads or writes Firestore; index.js does
 * that with what these functions decide, which is what makes the decisions
 * testable without a database and the destructive half small enough to read.
 */

/** The window the UI has always claimed. */
export const PURGE_AFTER_DAYS = 30

/**
 * How many documents one scheduled run may destroy.
 *
 * A scheduled hard delete is the most dangerous thing in this codebase: it is
 * irreversible, unattended, and its blast radius is every tenant. The cap means
 * a mistake in the query costs one run's worth of damage and shows up in the
 * logs, rather than emptying the database before anyone reads them. A real
 * backlog drains over consecutive days, which is fine for something already
 * 30 days dead.
 */
export const MAX_PURGES_PER_RUN = 500

/** Collections that soft-delete, and what has to go with each. */
export const PURGEABLE = [
  // Photos carry Storage objects; the pointer must not outlive the file, nor
  // the file the pointer.
  { collection: 'incidents', subcollections: ['photos'] },
  { collection: 'illnesses', subcollections: ['files'] },
  // The QR mirror is public and keyed by token, so it lives outside the org
  // path — deleting the asset without it leaves a world-readable record of
  // equipment that no longer exists.
  { collection: 'extinguishers', qrMirror: true },
  { collection: 'aeds', qrMirror: true },
  { collection: 'fas', qrMirror: true },
  { collection: 'signages', qrMirror: true },
]

/** Millisecond timestamp from whatever shape the field arrived in. */
export function toMillis(value) {
  if (value == null) return null
  if (typeof value?.toMillis === 'function') return value.toMillis()
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  if (typeof value === 'object' && typeof value.seconds === 'number') return value.seconds * 1000
  const parsed = Date.parse(String(value))
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * Is this record past its window?
 *
 * Anything without a readable deletedAt is NOT expired. A missing or unparseable
 * timestamp means "we do not know when this was deleted", and the safe answer to
 * that is to leave it alone — the cost of keeping a record too long is a finding,
 * the cost of destroying a live one is the record.
 */
export function isExpired(deletedAt, now = Date.now(), days = PURGE_AFTER_DAYS) {
  const ms = toMillis(deletedAt)
  if (ms == null) return false
  return now - ms >= days * 24 * 60 * 60 * 1000
}

/** Days remaining before a record is eligible; 0 once it is. */
export function daysRemaining(deletedAt, now = Date.now(), days = PURGE_AFTER_DAYS) {
  const ms = toMillis(deletedAt)
  if (ms == null) return null
  const left = days * 24 * 60 * 60 * 1000 - (now - ms)
  return left <= 0 ? 0 : Math.ceil(left / (24 * 60 * 60 * 1000))
}

/**
 * Which of these documents may be destroyed, and which are kept and why.
 *
 * Returns both halves on purpose. A job that reports only what it destroyed
 * cannot be checked; the kept list is what tells someone reading the logs that
 * the query is selecting what they think it is.
 */
export function planPurge(docs = [], { now = Date.now(), days = PURGE_AFTER_DAYS, max = MAX_PURGES_PER_RUN } = {}) {
  const purge = []
  const keep = []

  for (const d of docs || []) {
    if (!d) continue
    // Never destroy a record that is not in the bin. A query is a filter, not a
    // guarantee — this is the one check that must not depend on getting it right.
    if (d.deletedAt == null) {
      keep.push({ id: d.id, reason: 'not deleted' })
      continue
    }
    if (!isExpired(d.deletedAt, now, days)) {
      keep.push({ id: d.id, reason: `${daysRemaining(d.deletedAt, now, days)} days left` })
      continue
    }
    if (purge.length >= max) {
      keep.push({ id: d.id, reason: 'over the per-run cap' })
      continue
    }
    purge.push(d.id)
  }

  return { purge, keep, capped: keep.some((k) => k.reason === 'over the per-run cap') }
}

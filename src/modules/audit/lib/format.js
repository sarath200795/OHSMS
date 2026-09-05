// Dates in this module, in the user's own timezone.
//
// toDate() used to validate only the `new Date(value)` branch, so a corrupt
// Firestore Timestamp came back as an Invalid Date and every consumer took it
// at face value: formatDate printed the literal "Invalid Date", and isOverdue
// compared NaN — false for every operator — so an overdue CAPA reported as on
// time. Every branch is checked now, and toISODate does the checking.
//
// isOverdue compares YYYY-MM-DD strings rather than instants. `d.getTime() <
// Date.now()` treats a date-only string as UTC midnight, so an action due
// TODAY was overdue from 05:30 that morning in IST — for the whole working day
// on which it was still due.
import { toISODate, isOverdueDate } from '../../../shared/lib/dates'

/**
 * A value that may be a Firestore Timestamp, a Date, an ISO string or millis,
 * as a JS Date — or null when it is none of those, or is corrupt.
 */
export function toDate(value) {
  const iso = toISODate(value)
  if (!iso) return null
  // Back through the local calendar fields, not `new Date(iso)`, which would
  // parse UTC midnight and undo the timezone care toISODate just took.
  const [y, m, d] = iso.split('-').map(Number)
  if (typeof value?.toDate === 'function' || value instanceof Date || typeof value === 'number') {
    // These carry a time of day worth keeping for formatDateTime.
    const exact = typeof value?.toDate === 'function' ? value.toDate() : new Date(value)
    if (exact instanceof Date && !Number.isNaN(exact.getTime())) return exact
  }
  return new Date(y, m - 1, d)
}

export function formatDate(value) {
  const d = toDate(value)
  if (!d) return '—'
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function formatDateTime(value) {
  const d = toDate(value)
  if (!d) return '—'
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** True when a due date is before today (and the item isn't closed). */
export function isOverdue(dueDate, closed = false) {
  return isOverdueDate(dueDate, { closed })
}

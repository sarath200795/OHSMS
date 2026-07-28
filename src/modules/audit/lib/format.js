// Convert a value that may be a Firestore Timestamp, a Date, an ISO string, or
// a millis number into a JS Date (or null).
export function toDate(value) {
  if (!value) return null
  if (typeof value.toDate === 'function') return value.toDate()
  if (value instanceof Date) return value
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
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

// True when a due date is in the past (and the item isn't closed).
export function isOverdue(dueDate, closed = false) {
  if (closed) return false
  const d = toDate(dueDate)
  if (!d) return false
  return d.getTime() < Date.now()
}

// "YYYY-MM-DD" string for <input type="date"> default values.
export function dateInputValue(value) {
  const d = toDate(value)
  if (!d) return ''
  return d.toISOString().slice(0, 10)
}

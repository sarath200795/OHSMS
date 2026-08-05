import { format, formatDistanceToNow, isValid, differenceInCalendarDays } from 'date-fns'

// Firestore Timestamp | Date | number | ISO string → Date | null
export function toDate(value) {
  if (!value) return null
  if (typeof value?.toDate === 'function') return value.toDate() // Firestore Timestamp
  if (value instanceof Date) return value
  const d = new Date(value)
  return isValid(d) ? d : null
}

export function formatDate(value, fmt = 'd MMM yyyy') {
  const d = toDate(value)
  return d ? format(d, fmt) : '—'
}

export function formatDateTime(value) {
  const d = toDate(value)
  return d ? format(d, 'd MMM yyyy, HH:mm') : '—'
}

export function fromNow(value) {
  const d = toDate(value)
  return d ? formatDistanceToNow(d, { addSuffix: true }) : '—'
}

// Days until (positive) / since (negative) a date — for expiry & due-date logic.
export function daysUntil(value) {
  const d = toDate(value)
  return d ? differenceInCalendarDays(d, new Date()) : null
}

export function isOverdue(value) {
  const n = daysUntil(value)
  return n != null && n < 0
}

export function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')
}

// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for all due-date math and category derivation.
// Dashboard, repository, and every list import from here so nothing drifts.
// ─────────────────────────────────────────────────────────────────────────────
import { differenceInCalendarDays, parseISO, isValid } from 'date-fns'
import {
  STATUS,
  DUE_SOON_DAYS,
  DEFECT_BY_KEY,
  REFILL_DEFECT_KEYS,
  PHYSICAL_DEFECT_KEYS,
  CATEGORIES,
} from './constants'

/** Parse a stored date (ISO string or Date) safely. Returns null if invalid. */
export function toDate(value) {
  if (!value) return null
  if (value instanceof Date) return isValid(value) ? value : null
  // Firestore Timestamp — validate the result; a corrupt timestamp can yield an
  // Invalid Date, which would later throw "Invalid time value" in date-fns and
  // crash the whole list render.
  if (typeof value === 'object' && typeof value.toDate === 'function') {
    try {
      const d = value.toDate()
      return isValid(d) ? d : null
    } catch {
      return null
    }
  }
  const d = typeof value === 'string' ? parseISO(value) : new Date(value)
  return isValid(d) ? d : null
}

/** Days from today until `value` (negative = overdue). null if no date. */
export function daysUntil(value, today = new Date()) {
  const d = toDate(value)
  if (!d) return null
  return differenceInCalendarDays(d, today)
}

// ── Data-quality: classify a date field ──────────────────────────────────────
// 'ok'      — a valid, parseable date
// 'missing' — no value recorded at all
// 'invalid' — a value is present but doesn't parse (e.g. a corrupt import)
export function dateFieldState(value) {
  if (value === null || value === undefined || value === '') return 'missing'
  return toDate(value) ? 'ok' : 'invalid'
}

/** True when a unit's refill or HPT date is missing or invalid (needs fixing). */
export function hasDateIssue(ext) {
  return (
    dateFieldState(ext?.dateOfNextRefill) !== 'ok' ||
    dateFieldState(ext?.dateOfNextHPT) !== 'ok'
  )
}

/**
 * Derive every flag/category for one extinguisher.
 * Returns an object the rest of the app reads instead of re-computing dates.
 */
export function deriveStatus(ext, today = new Date()) {
  const refillDays = daysUntil(ext.dateOfNextRefill, today)
  const hptDays = daysUntil(ext.dateOfNextHPT, today)

  const activeDefects = Array.isArray(ext.physicalDefects) ? ext.physicalDefects : []
  const refillDefects = activeDefects.filter((k) => REFILL_DEFECT_KEYS.includes(k))
  const physicalDefects = activeDefects.filter((k) => PHYSICAL_DEFECT_KEYS.includes(k))

  const isClosed = ext.status === STATUS.CLOSED
  const inProcess = ext.status === STATUS.IN_PROCESS_REFILLING

  const flags = {
    REFILL_DUE: refillDays !== null && refillDays <= 0,
    REFILL_DUE_30: refillDays !== null && refillDays > 0 && refillDays <= DUE_SOON_DAYS,
    HPT_DUE: hptDays !== null && hptDays <= 0,
    HPT_DUE_30: hptDays !== null && hptDays > 0 && hptDays <= DUE_SOON_DAYS,
  }

  // The set of "category" keys this extinguisher belongs to (for filter chips).
  const categories = []
  refillDefects.forEach((k) => categories.push(k))
  physicalDefects.forEach((k) => categories.push(k))
  if (!isClosed) {
    if (flags.HPT_DUE) categories.push(CATEGORIES.HPT_DUE.key)
    else if (flags.HPT_DUE_30) categories.push(CATEGORIES.HPT_DUE_30.key)
    if (flags.REFILL_DUE) categories.push(CATEGORIES.REFILL_DUE.key)
    else if (flags.REFILL_DUE_30) categories.push(CATEGORIES.REFILL_DUE_30.key)
  }

  const hasPhysicalDefect = physicalDefects.length > 0
  const needsRefillByDefect = refillDefects.length > 0
  const needsRefillByDate = !isClosed && (flags.REFILL_DUE || flags.REFILL_DUE_30 || flags.HPT_DUE || flags.HPT_DUE_30)

  const isHealthy =
    !isClosed && !hasPhysicalDefect && !needsRefillByDefect && !needsRefillByDate && !inProcess

  if (isHealthy) categories.push(CATEGORIES.HEALTHY.key)

  return {
    refillDays,
    hptDays,
    refillDefects,
    physicalDefects,
    hasPhysicalDefect,
    needsRefillByDefect,
    needsRefillByDate,
    isHealthy,
    isClosed,
    inProcess,
    flags,
    categories,
  }
}

// ── List membership (derived, never stored twice) ────────────────────────────

export function isToBeRefilled(ext, today = new Date()) {
  const d = deriveStatus(ext, today)
  if (d.isClosed || d.inProcess) return false
  return ext.status === STATUS.TO_BE_REFILLED || d.needsRefillByDate || d.needsRefillByDefect
}

export function isInProcess(ext) {
  return ext.status === STATUS.IN_PROCESS_REFILLING
}

export function isPhysicalDefect(ext) {
  return deriveStatus(ext).hasPhysicalDefect && ext.status !== STATUS.CLOSED
}

export function isClosed(ext) {
  return ext.status === STATUS.CLOSED
}

/** A vendor quotation has been submitted for the current defect/refill cycle. */
export function hasQuotation(ext) {
  return Boolean(ext.quotation && ext.quotation.submittedAt)
}

/**
 * The item needs a quotation before it may progress to its next step.
 * Applies to everything in To Be Refilled AND every physical-defect item that
 * doesn't yet have a quotation. Cleared once a cycle completes (refill/resolve).
 */
export function needsQuotation(ext, today = new Date()) {
  return (isToBeRefilled(ext, today) || isPhysicalDefect(ext)) && !hasQuotation(ext)
}

/** Soft-deleted (in the recycle bin) — excluded from all normal lists. */
export function isDeleted(ext) {
  return Boolean(ext.deletedAt)
}

/**
 * "Refilled & Closed" = a completed refill cycle. We log this via the
 * `lastRefilledAt` stamp written by markRefilledAndClosed, rather than the
 * CLOSED status — because a refilled unit is reactivated (new due dates) and
 * must keep being tracked, yet should still appear in the Refilled & Closed
 * record. Also include any explicitly CLOSED units for completeness.
 */
export function isRefilledClosed(ext) {
  return Boolean(ext.lastRefilledAt) || ext.status === STATUS.CLOSED
}

export function isHealthy(ext, today = new Date()) {
  return deriveStatus(ext, today).isHealthy
}

/** Human label of the most severe condition, for quick display. */
export function severityLabel(ext, today = new Date()) {
  const d = deriveStatus(ext, today)
  if (d.isClosed) return 'Refilled & Closed'
  if (d.inProcess) return 'In Process of Refilling'
  if (d.refillDefects.length) return DEFECT_BY_KEY[d.refillDefects[0]].label
  if (d.flags.HPT_DUE) return 'HPT Overdue'
  if (d.flags.REFILL_DUE) return 'Refill Overdue'
  if (d.physicalDefects.length) return DEFECT_BY_KEY[d.physicalDefects[0]].label
  if (d.flags.HPT_DUE_30) return 'HPT Due Soon'
  if (d.flags.REFILL_DUE_30) return 'Refill Due Soon'
  return 'Healthy'
}

/** Color that represents the overall health of an extinguisher (row/badge tint). */
export function healthColor(ext, today = new Date()) {
  const d = deriveStatus(ext, today)
  if (d.isHealthy) return CATEGORIES.HEALTHY.color
  if (d.refillDefects.length || d.flags.HPT_DUE || d.flags.REFILL_DUE) return '#dc2626'
  if (d.hasPhysicalDefect) return '#d97706'
  if (d.inProcess) return '#6366f1'
  if (d.isClosed) return '#0ea5e9'
  return '#f59e0b'
}

/** Aggregate counts for the dashboard, computed once over the whole fleet. */
export function fleetSummary(list, today = new Date()) {
  const summary = {
    total: list.filter((e) => !isDeleted(e)).length,
    healthy: 0,
    toBeRefilled: 0,
    inProcess: 0,
    physicalDefects: 0,
    closed: 0,
    categoryCounts: {},
  }
  for (const ext of list) {
    if (isDeleted(ext)) continue // recycle-bin items never count
    const d = deriveStatus(ext, today)
    if (d.isHealthy) summary.healthy++
    if (isToBeRefilled(ext, today)) summary.toBeRefilled++
    if (d.inProcess) summary.inProcess++
    if (d.hasPhysicalDefect && !d.isClosed) summary.physicalDefects++
    if (isRefilledClosed(ext)) summary.closed++
    for (const c of d.categories) {
      summary.categoryCounts[c] = (summary.categoryCounts[c] || 0) + 1
    }
  }
  return summary
}

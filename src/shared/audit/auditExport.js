import { auditLabel } from './audit'

/**
 * The trail, in a form somebody can hand over.
 *
 * A.5.28 asks that evidence be collected — retrievable, and producible in a
 * fixed form outside the system that made it. An append-only log that can only
 * be scrolled in a browser satisfies neither: the reader cannot keep it, cannot
 * attach it to a report, and cannot show that what they read is what was there.
 *
 * Pure. The file-writing half lives in the page; this decides what a row says,
 * which is the part worth testing.
 */

const str = (v) => (v == null ? '' : String(v))

/** Millis from a Firestore Timestamp, a Date, or an ISO string. */
export function atMillis(at) {
  if (at == null) return null
  if (typeof at?.toMillis === 'function') return at.toMillis()
  if (at instanceof Date) return at.getTime()
  if (typeof at === 'object' && typeof at.seconds === 'number') return at.seconds * 1000
  const parsed = Date.parse(String(at))
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * ISO 8601, in UTC, with the offset spelled out.
 *
 * A locale-formatted timestamp is ambiguous the moment the file crosses a
 * timezone, and an audit trail whose times are ambiguous cannot establish an
 * order of events — which is the only thing anyone reads it for.
 */
export function isoAt(at) {
  const ms = atMillis(at)
  return ms == null ? '' : new Date(ms).toISOString()
}

/** One row per entry, in the order a reader scans them. */
export function auditRows(logs = []) {
  return (logs || []).filter(Boolean).map((l) => ({
    'When (UTC)': isoAt(l.at),
    Action: auditLabel(l.action) || str(l.action),
    'Action key': str(l.action),
    Module: str(l.module),
    // Both, deliberately. The name is what a reader recognises; the uid is the
    // fact, and it is the one the rules pin. A row carrying only the name would
    // reproduce exactly the ambiguity the trail exists to remove.
    'Actor name': str(l.actorName),
    'Actor uid': str(l.actorUid),
    Target: str(l.targetLabel || l.target),
    'Target id': str(l.targetId),
    Details: l.details == null ? '' : typeof l.details === 'string' ? l.details : JSON.stringify(l.details),
    'Entry id': str(l.id),
  }))
}

/**
 * A header describing what this file IS, so it can be read a year later.
 *
 * An exported range with no statement of its bounds is indistinguishable from a
 * complete record, and someone will eventually read one as the other. If the
 * query hit its ceiling the file says so, in the file — not in a toast that
 * disappeared.
 */
export function auditExportSummary({ orgName = '', from = '', to = '', count = 0, capped = false } = {}) {
  return [
    ['Organization', orgName || '(unnamed)'],
    ['Range from', from || 'earliest recorded'],
    ['Range to', to || 'latest recorded'],
    ['Entries in this file', String(count)],
    ['Exported at (UTC)', new Date().toISOString()],
    ['Complete for the range', capped ? 'NO — the query limit was reached; narrow the range' : 'yes'],
  ]
}

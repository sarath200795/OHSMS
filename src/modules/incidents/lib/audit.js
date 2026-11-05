// ─────────────────────────────────────────────────────────────────────────────
// Audit-log action constants + pure helpers (no Firestore here, so they're
// unit-testable). The Firestore write itself lives in firestore.js (logAudit).
// ─────────────────────────────────────────────────────────────────────────────
// Format-only, and pure: isEnvelope tests a string's shape and touches no key,
// no network and no Firestore, so importing it here keeps this module as
// unit-testable as it says it is.
import { isEnvelope } from '../../../shared/crypto/envelope'

export const AUDIT = {
  INCIDENT_CREATE: 'incident.create',
  INCIDENT_UPDATE: 'incident.update',
  INCIDENT_STEP: 'incident.step',
  INCIDENT_CLOSE: 'incident.close',
  INCIDENT_DELETE: 'incident.delete',
  INCIDENT_RESTORE: 'incident.restore',
  INCIDENT_PURGE: 'incident.purge',
  ILLNESS_CREATE: 'illness.create',
  ILLNESS_UPDATE: 'illness.update',
  ILLNESS_CLOSE: 'illness.close',
  ILLNESS_DELETE: 'illness.delete',
  ILLNESS_RESTORE: 'illness.restore',
  ILLNESS_PURGE: 'illness.purge',
  ACTION_UPDATE: 'action.update',
  INJURY_SYNC: 'injury.sync',
  INJURY_UPDATE: 'injury.update',
  INJURY_VERIFY: 'injury.verify',
  INJURY_UNVERIFY: 'injury.unverify',
  INJURY_DELETE: 'injury.delete',
  INJURY_RESTORE: 'injury.restore',
  INJURY_PURGE: 'injury.purge',
}

// Top-level incident/illness fields we report old→new changes for on an edit.
const TRACKED_FIELDS = [
  'type',
  'severity',
  'category',
  'location',
  'lifecycle',
  'incidentDate',
  'incidentTime',
  'exposedToAgent',
  'site',
  'date',
  'time',
]

function norm(v) {
  if (Array.isArray(v)) return v.join(', ')
  if (v === undefined || v === null) return ''
  return String(v)
}

/**
 * Build a concise "field: old → new" summary string from a before/after pair.
 * Pure + deterministic so it can be unit-tested. `after` may be a partial
 * (only changed keys); we compare each tracked field present in `after`.
 *
 * ── Why a sealed field reports its NAME and not its values ───────────────────
 *
 * `exposedToAgent` is on the list above and is sealed on /illnesses
 * (src/shared/crypto/policy.js) — the agent a named colleague was exposed to is
 * exactly the special-category detail that collection is gated to managers for.
 * This summary goes to /auditLogs, which is a DIFFERENT audience.
 *
 * Written as "old → new" it would do both of the wrong things at once: print an
 * unreadable envelope where the old value should be, and publish the new value
 * in clear text in a collection the health gate does not cover. That is the
 * "confine the field, publish the second copy" mistake the incident/injury
 * split was made to correct, reappearing in the audit trail.
 *
 * So when either side carries an envelope the entry records THAT the field
 * changed and nothing about what it changed to. The audit trail keeps its
 * purpose — someone edited this, here is when and who — without becoming a
 * plaintext mirror of the record it is auditing.
 *
 * A document written before sealing has plaintext on both sides and still
 * reports values, which is the existing behaviour and correct: nothing about it
 * is confined yet.
 */
export function diffSummary(before = {}, after = {}) {
  const parts = []
  const keys = TRACKED_FIELDS.filter((k) => k in after)
  for (const k of keys) {
    const sealed = isEnvelope(before[k]) || isEnvelope(after[k])
    const a = norm(before[k])
    const b = norm(after[k])
    if (a === b) continue
    parts.push(sealed ? `${k}: changed` : `${k}: ${a || '—'} → ${b || '—'}`)
  }
  return parts.join('; ')
}

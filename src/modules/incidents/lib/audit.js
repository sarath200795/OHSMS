// ─────────────────────────────────────────────────────────────────────────────
// Audit-log action constants + pure helpers (no Firestore here, so they're
// unit-testable). The Firestore write itself lives in firestore.js (logAudit).
// ─────────────────────────────────────────────────────────────────────────────

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
  USER_STATUS: 'user.status',
  USER_ROLE: 'user.role',
  ORG_SETTINGS: 'org.settings',
  BACKUP: 'org.backup',
}

// Human label + color for each action (used by the audit table badge).
export const AUDIT_META = {
  [AUDIT.INCIDENT_CREATE]: { label: 'Incident created', color: '#16a34a' },
  [AUDIT.INCIDENT_UPDATE]: { label: 'Incident updated', color: '#795548' },
  [AUDIT.INCIDENT_STEP]: { label: 'Step completed', color: '#8b5cf6' },
  [AUDIT.INCIDENT_CLOSE]: { label: 'Incident closed', color: '#0ea5e9' },
  [AUDIT.INCIDENT_DELETE]: { label: 'Incident deleted', color: '#dc2626' },
  [AUDIT.INCIDENT_RESTORE]: { label: 'Incident restored', color: '#16a34a' },
  [AUDIT.INCIDENT_PURGE]: { label: 'Incident purged', color: '#991b1b' },
  [AUDIT.ILLNESS_CREATE]: { label: 'Illness created', color: '#16a34a' },
  [AUDIT.ILLNESS_UPDATE]: { label: 'Illness updated', color: '#795548' },
  [AUDIT.ILLNESS_CLOSE]: { label: 'Illness closed', color: '#0ea5e9' },
  [AUDIT.ILLNESS_DELETE]: { label: 'Illness deleted', color: '#dc2626' },
  [AUDIT.ILLNESS_RESTORE]: { label: 'Illness restored', color: '#16a34a' },
  [AUDIT.ILLNESS_PURGE]: { label: 'Illness purged', color: '#991b1b' },
  [AUDIT.ACTION_UPDATE]: { label: 'Action updated', color: '#f59e0b' },
  [AUDIT.INJURY_SYNC]: { label: 'Injury report saved', color: '#16a34a' },
  [AUDIT.INJURY_UPDATE]: { label: 'Injury report edited', color: '#795548' },
  [AUDIT.INJURY_VERIFY]: { label: 'Injury verified', color: '#0ea5e9' },
  [AUDIT.INJURY_UNVERIFY]: { label: 'Injury unverified', color: '#f59e0b' },
  [AUDIT.USER_STATUS]: { label: 'User status', color: '#f59e0b' },
  [AUDIT.USER_ROLE]: { label: 'User role', color: '#795548' },
  [AUDIT.ORG_SETTINGS]: { label: 'Org settings', color: '#64748b' },
  [AUDIT.BACKUP]: { label: 'Downloaded backup', color: '#0891b2' },
}

export function auditMeta(action) {
  return AUDIT_META[action] || { label: action || 'Change', color: '#64748b' }
}

// Top-level incident/illness fields we report old→new changes for on an edit.
const TRACKED_FIELDS = [
  'type', 'severity', 'category', 'location', 'lifecycle',
  'incidentDate', 'incidentTime', 'exposedToAgent', 'site', 'date', 'time',
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
 */
export function diffSummary(before = {}, after = {}) {
  const parts = []
  const keys = TRACKED_FIELDS.filter((k) => k in after)
  for (const k of keys) {
    const a = norm(before[k])
    const b = norm(after[k])
    if (a !== b) parts.push(`${k}: ${a || '—'} → ${b || '—'}`)
  }
  return parts.join('; ')
}

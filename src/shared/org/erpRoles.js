// ─────────────────────────────────────────────────────────────────────────────
// Emergency response roles — stable keys, organization-chosen labels.
//
// The baseline rescue plans are written against ROLES, never against people or
// one company's job titles. "CM", "CLM" and "Safety L1" came from the source
// document's own vocabulary; they are meaningless outside that company, but
// they are also stored on every existing plan, contact and drill record.
//
// So the key stays fixed and only the LABEL is configurable: an organization
// renames "CM" to "Plant Head" or "Facility Director" in Org Settings and every
// plan, poster and drill reads in its own language, without migrating data or
// breaking the role matching that fills a recalled plan with real names.
//
// Defaults below are deliberately generic — a placeholder describing the duty,
// not a title borrowed from any particular employer.
// ─────────────────────────────────────────────────────────────────────────────

export const ERP_ROLES = [
  { key: 'CM', label: 'Site Head', duty: 'Overall command — acts as Incident Commander' },
  { key: 'CLM', label: 'Operations Lead', duty: 'Runs the operational response and continuity' },
  { key: 'Safety L1', label: 'Safety Officer', duty: 'First-line safety response and sweeps' },
  { key: 'Safety L2', label: 'Safety Manager', duty: 'Escalation, investigation and reporting' },
  { key: 'Security', label: 'Security Lead', duty: 'Alarm, access control, guiding responders' },
  { key: 'First Aider', label: 'First Aider', duty: 'Casualty care until medical services arrive' },
  { key: 'HR', label: 'HR Lead', duty: 'People, families, welfare and communications' },
  { key: 'Legal', label: 'Legal Lead', duty: 'Statutory notification and legal exposure' },
  { key: 'Other', label: 'Other', duty: '' },
]

/** Everyone on site — a plan audience, never an escalation contact. */
export const ALL_EMPLOYEES = 'All employees'

export const ERP_ROLE_KEYS = ERP_ROLES.map((r) => r.key)

/**
 * Merge an org's saved overrides over the defaults.
 * Unknown keys are ignored so a stale setting cannot invent a role.
 */
export function normalizeErpRoleLabels(saved) {
  const out = {}
  for (const r of ERP_ROLES) {
    const v = typeof saved?.[r.key] === 'string' ? saved[r.key].trim() : ''
    out[r.key] = v || r.label
  }
  return out
}

/**
 * Display label for a role key. Falls back to the key itself so a role stored
 * before this existed still renders as something meaningful.
 */
export function erpRoleLabel(key, labels) {
  if (!key) return ''
  if (key === ALL_EMPLOYEES) return ALL_EMPLOYEES
  return labels?.[key] || ERP_ROLES.find((r) => r.key === key)?.label || key
}

/**
 * Replace {{role:KEY}} placeholders in baseline text with the org's own titles.
 * Baseline procedures ship with placeholders so one library serves every
 * organization; unknown keys are left visible rather than silently blanked,
 * because a missing responsible party in a rescue plan must be noticeable.
 */
export function renderRoleTokens(text, labels) {
  if (!text) return ''
  return String(text).replace(/\{\{role:([^}]+)\}\}/g, (_, key) => erpRoleLabel(key.trim(), labels))
}

// ─────────────────────────────────────────────────────────────────────────────
// Stakeholder issues: what a customer escalated, and what a regulator did about
// it.
//
// The two are kept as separate records rather than one "issue" with a type,
// because they are owned by different people and answer different questions. An
// escalation is a customer relationship problem — who complained, what was done
// for them. A legal issue is an exposure — which authority turned up, what they
// served, what it will cost. The same event often produces both, so each can
// point at the other, but neither is a field on the other.
// ─────────────────────────────────────────────────────────────────────────────

// ── Customer escalations ─────────────────────────────────────────────────────

export const ESCALATION_STATUS = [
  { key: 'open', label: 'Open', tone: 'red' },
  { key: 'in_progress', label: 'In progress', tone: 'amber' },
  { key: 'resolved', label: 'Resolved', tone: 'emerald' },
  { key: 'closed', label: 'Closed', tone: 'slate' },
]
export const ESCALATION_STATUS_BY_KEY = Object.fromEntries(ESCALATION_STATUS.map((s) => [s.key, s]))

/** How far the complaint travelled. Where it landed drives who has to answer. */
export const ESCALATION_CHANNEL = [
  { key: 'in_person', label: 'In person / at site' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'app', label: 'App / website' },
  { key: 'social', label: 'Social media' },
  { key: 'review', label: 'Public review' },
  { key: 'consumer_forum', label: 'Consumer forum' },
  { key: 'other', label: 'Other' },
]

export const SEVERITY = [
  { key: 'low', label: 'Low', tone: 'slate' },
  { key: 'medium', label: 'Medium', tone: 'blue' },
  { key: 'high', label: 'High', tone: 'amber' },
  { key: 'critical', label: 'Critical', tone: 'red' },
]
export const SEVERITY_BY_KEY = Object.fromEntries(SEVERITY.map((s) => [s.key, s]))

// ── Legal issues ─────────────────────────────────────────────────────────────

/**
 * Authorities that turn up at an Indian site.
 *
 * Grouped by what they regulate rather than listed flat, because the person
 * filling this in knows "the pollution people came", not which statute applies.
 * `other` is deliberate and last: an unrecognised authority must be recordable
 * on the day, not blocked until someone extends this list.
 */
export const DEPARTMENTS = [
  { key: 'police', label: 'Police', group: 'Law & order' },
  { key: 'fire', label: 'Fire Department / Fire NOC', group: 'Safety' },
  { key: 'municipality', label: 'Municipal Corporation', group: 'Civic' },
  { key: 'pollution', label: 'Pollution Control Board', group: 'Environment' },
  { key: 'labour', label: 'Labour Department', group: 'Workforce' },
  { key: 'factories', label: 'Factories / Industrial Safety & Health (DISH)', group: 'Safety' },
  { key: 'esic_pf', label: 'ESIC / EPFO', group: 'Workforce' },
  { key: 'fssai', label: 'FSSAI / Food Safety', group: 'Civic' },
  { key: 'legal_metrology', label: 'Legal Metrology (Weights & Measures)', group: 'Civic' },
  { key: 'electrical', label: 'Electrical Inspectorate / DISCOM', group: 'Utilities' },
  { key: 'water', label: 'Water Board', group: 'Utilities' },
  { key: 'excise', label: 'Excise', group: 'Civic' },
  { key: 'gst', label: 'GST / Commercial Tax', group: 'Revenue' },
  { key: 'consumer_forum', label: 'Consumer Disputes Redressal Forum', group: 'Law & order' },
  { key: 'court', label: 'Court / Tribunal', group: 'Law & order' },
  { key: 'human_rights', label: 'Human Rights / Women’s Commission', group: 'Law & order' },
  { key: 'shops_establishments', label: 'Shops & Establishments', group: 'Civic' },
  { key: 'other', label: 'Other department', group: 'Other' },
]
export const DEPARTMENT_BY_KEY = Object.fromEntries(DEPARTMENTS.map((d) => [d.key, d]))

export const DEPARTMENT_GROUPS = [...new Set(DEPARTMENTS.map((d) => d.group))]

/**
 * What was actually served.
 *
 * Ordered roughly by how much trouble it represents, because the list is read
 * as much as it is picked from, and `none` sits first: a visit that produced no
 * paper is the common case and recording it is the point — it is the evidence
 * that an inspection happened and passed.
 */
export const NOTICE_TYPES = [
  { key: 'none', label: 'No notice served', tone: 'emerald', severe: false },
  { key: 'verbal', label: 'Verbal instruction', tone: 'slate', severe: false },
  { key: 'inspection_report', label: 'Inspection report', tone: 'blue', severe: false },
  { key: 'show_cause', label: 'Show cause notice', tone: 'amber', severe: true },
  { key: 'improvement', label: 'Improvement notice', tone: 'amber', severe: true },
  { key: 'legal_notice', label: 'Legal notice', tone: 'amber', severe: true },
  { key: 'challan', label: 'Challan / fine', tone: 'amber', severe: true },
  { key: 'summons', label: 'Summons', tone: 'red', severe: true },
  { key: 'fir', label: 'FIR', tone: 'red', severe: true },
  { key: 'court_order', label: 'Court order', tone: 'red', severe: true },
  { key: 'sealing', label: 'Sealing / closure order', tone: 'red', severe: true },
  { key: 'other', label: 'Other notice', tone: 'slate', severe: true },
]
export const NOTICE_BY_KEY = Object.fromEntries(NOTICE_TYPES.map((n) => [n.key, n]))

/** Notices that need a reply, a fix or a court date — the ones with a clock. */
export const SEVERE_NOTICES = NOTICE_TYPES.filter((n) => n.severe).map((n) => n.key)

export const LEGAL_STATUS = [
  { key: 'open', label: 'Open', tone: 'red' },
  { key: 'responded', label: 'Responded', tone: 'amber' },
  { key: 'complied', label: 'Complied', tone: 'blue' },
  { key: 'closed', label: 'Closed', tone: 'emerald' },
]
export const LEGAL_STATUS_BY_KEY = Object.fromEntries(LEGAL_STATUS.map((s) => [s.key, s]))

// ─────────────────────────────────────────────────────────────────────────────
// Objectives & Targets — pure KPI computation.
//
// Every KPI is measured from the modules that already own the data, at three
// levels: org → region → site. No numbers are entered by hand; targets are.
// ─────────────────────────────────────────────────────────────────────────────

export const LEVELS = [
  { key: 'org', label: 'Organization' },
  { key: 'region', label: 'Region' },
  { key: 'site', label: 'Site' },
]

/** KPI registry. `levels` limits where a KPI is meaningful. */
export const KPIS = [
  {
    key: 'auditPass',
    label: 'Audit Pass %',
    unit: '%',
    higherIsBetter: true,
    levels: ['org', 'region'],
    byEntity: true,
    defaultTarget: 90,
    help: 'Audits closed with no Major or Minor non-conformity, as a share of audits conducted.',
    source: 'Internal Audit',
  },
  {
    key: 'ticketClosure',
    label: 'Ticket Closure %',
    unit: '%',
    higherIsBetter: true,
    levels: ['org', 'region'],
    byEntity: true,
    defaultTarget: 95,
    help: 'Corrective action tickets completed, as a share of all tickets raised across modules.',
    source: 'Action Tracker',
  },
  {
    key: 'extinguisherUptime',
    label: 'Fire Extinguisher Uptime %',
    unit: '%',
    higherIsBetter: true,
    levels: ['org', 'region', 'site'],
    defaultTarget: 98,
    help: 'Extinguishers with no open physical defect, as a share of all units.',
    source: 'Emergency Equipment',
  },
  {
    key: 'fasUptime',
    label: 'FAS Uptime %',
    unit: '%',
    higherIsBetter: true,
    levels: ['org', 'region', 'site'],
    defaultTarget: 98,
    help: 'Fire alarm system devices in operational status, as a share of all devices.',
    source: 'Emergency Equipment',
  },
  {
    key: 'signageUptime',
    label: 'Signage Uptime %',
    unit: '%',
    higherIsBetter: true,
    levels: ['org', 'region', 'site'],
    defaultTarget: 95,
    help: 'Safety signage in OK condition — not faded, damaged, missing or obstructed.',
    source: 'Emergency Equipment',
  },
  {
    key: 'incidents',
    label: 'Incidents',
    unit: '',
    higherIsBetter: false,
    levels: ['org', 'region', 'site'],
    defaultTarget: 0,
    help: 'Recordable incidents reported. Target is the maximum acceptable for the period.',
    source: 'Incidents',
  },
]

export const KPI_BY_KEY = Object.fromEntries(KPIS.map((k) => [k.key, k]))

// ── Scope filtering ──────────────────────────────────────────────────────────

/** Does a record fall inside {level, scope}? Records carry region/entity/siteId. */
export function inScope(rec, level, scope, entity = 'all') {
  if (!rec) return false
  if (entity !== 'all' && (rec.entity || '') !== entity) return false
  if (level === 'org') return true
  if (level === 'region') return (rec.region || '') === scope
  if (level === 'site') return (rec.siteId || '') === scope
  return false
}

const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null)

// ── Individual KPIs ──────────────────────────────────────────────────────────

/**
 * Audit pass rate. An audit report passes when it raised no Major NC and no
 * Minor NC (observations and OFIs don't fail an audit).
 */
export function auditPass(reports = [], level = 'org', scope = '', entity = 'all') {
  const mine = reports.filter((r) => inScope(scopeOfAudit(r), level, scope, entity))
  const passed = mine.filter(
    (r) => !(r.findings || []).some((f) => /major nc|minor nc/i.test(f?.type || '')),
  ).length
  return { value: pct(passed, mine.length), numerator: passed, denominator: mine.length }
}

/** Audit reports keep their scope under taskDetails; normalise it. */
const scopeOfAudit = (r) => ({
  region: r.region || r.taskDetails?.region || '',
  entity: r.entity || r.taskDetails?.entity || '',
  siteId: r.siteId || r.taskDetails?.siteId || '',
})

/** Ticket closure across all modules (Action Tracker normalised actions). */
export function ticketClosure(actions = [], level = 'org', scope = '', entity = 'all') {
  const mine = actions.filter((a) => inScope(a, level, scope, entity))
  const done = mine.filter((a) => a.status === 'done').length
  return { value: pct(done, mine.length), numerator: done, denominator: mine.length }
}

/** Extinguishers with no open physical defect (resolved defects are removed). */
export function extinguisherUptime(units = [], level = 'org', scope = '', entity = 'all') {
  const mine = units.filter((u) => !u.deletedAt && inScope(u, level, scope, entity))
  const up = mine.filter((u) => (u.physicalDefects || []).length === 0).length
  return { value: pct(up, mine.length), numerator: up, denominator: mine.length }
}

/** Fire alarm devices reporting operational. */
export function fasUptime(devices = [], level = 'org', scope = '', entity = 'all') {
  const mine = devices.filter((d) => !d.deletedAt && inScope(d, level, scope, entity))
  const up = mine.filter((d) => (d.status || 'operational') === 'operational').length
  return { value: pct(up, mine.length), numerator: up, denominator: mine.length }
}

/** Signage in OK condition. */
export function signageUptime(signs = [], level = 'org', scope = '', entity = 'all') {
  const mine = signs.filter((s) => !s.deletedAt && inScope(s, level, scope, entity))
  const up = mine.filter((s) => (s.condition || 'OK') === 'OK').length
  return { value: pct(up, mine.length), numerator: up, denominator: mine.length }
}

/** Incident count (lower is better). */
export function incidentCount(incidents = [], level = 'org', scope = '', entity = 'all') {
  const mine = incidents.filter((i) => inScope(i, level, scope, entity))
  return { value: mine.length, numerator: mine.length, denominator: mine.length }
}

/** Compute one KPI from the raw module data. */
export function computeKpi(key, data, level, scope, entity = 'all') {
  switch (key) {
    case 'auditPass': return auditPass(data.auditReports, level, scope, entity)
    case 'ticketClosure': return ticketClosure(data.actions, level, scope, entity)
    case 'extinguisherUptime': return extinguisherUptime(data.extinguishers, level, scope, entity)
    case 'fasUptime': return fasUptime(data.fas, level, scope, entity)
    case 'signageUptime': return signageUptime(data.signages, level, scope, entity)
    case 'incidents': return incidentCount(data.incidents, level, scope, entity)
    default: return { value: null, numerator: 0, denominator: 0 }
  }
}

// ── Target comparison ────────────────────────────────────────────────────────

export const RAG = {
  on_track: { key: 'on_track', label: 'On target', tone: 'green', color: '#16a34a' },
  at_risk: { key: 'at_risk', label: 'At risk', tone: 'amber', color: '#d97706' },
  off_track: { key: 'off_track', label: 'Off target', tone: 'red', color: '#dc2626' },
  no_data: { key: 'no_data', label: 'No data', tone: 'gray', color: '#8a7660' },
}

/**
 * RAG status of an actual against its target. "At risk" is within 5 points
 * (or 20% of target for count KPIs) of missing.
 */
export function ragFor(kpiKey, value, target) {
  const kpi = KPI_BY_KEY[kpiKey]
  if (value == null || target == null || target === '') return RAG.no_data
  const t = Number(target)
  if (Number.isNaN(t)) return RAG.no_data
  if (kpi?.higherIsBetter) {
    if (value >= t) return RAG.on_track
    return value >= t - 5 ? RAG.at_risk : RAG.off_track
  }
  // Lower is better (incidents)
  if (value <= t) return RAG.on_track
  return value <= t + Math.max(1, t * 0.2) ? RAG.at_risk : RAG.off_track
}

/** Find the target that applies to a KPI at a given scope, falling back to org. */
export function targetFor(objectives = [], kpiKey, level, scope, entity = 'all') {
  const match = (o) =>
    o.kpi === kpiKey && (o.entity || 'all') === entity
  return (
    objectives.find((o) => match(o) && o.level === level && (o.scope || '') === (scope || '')) ||
    objectives.find((o) => match(o) && o.level === 'org') ||
    objectives.find((o) => o.kpi === kpiKey && o.level === 'org' && (o.entity || 'all') === 'all') ||
    null
  )
}

/**
 * Build a scorecard: one row per KPI valid at this level, with actual, target
 * and RAG.
 */
export function buildScorecard(data, objectives, level, scope, entity = 'all') {
  return KPIS.filter((k) => k.levels.includes(level)).map((k) => {
    const result = computeKpi(k.key, data, level, scope, entity)
    const obj = targetFor(objectives, k.key, level, scope, entity)
    const target = obj ? Number(obj.target) : null
    return {
      kpi: k,
      ...result,
      target,
      objective: obj,
      rag: ragFor(k.key, result.value, target),
    }
  })
}

/** Roll a KPI across every scope value at a level — the drill-down table. */
export function breakdown(data, objectives, kpiKey, level, scopes, entity = 'all') {
  return scopes.map((s) => {
    const result = computeKpi(kpiKey, data, level, s.value, entity)
    const obj = targetFor(objectives, kpiKey, level, s.value, entity)
    const target = obj ? Number(obj.target) : null
    return { ...s, ...result, target, rag: ragFor(kpiKey, result.value, target) }
  })
}

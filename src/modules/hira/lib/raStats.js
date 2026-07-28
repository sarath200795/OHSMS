// ─────────────────────────────────────────────────────────────────────────────
// Aggregate hazards across all assessments into the metrics the dashboard shows.
// Residual risk = projected risk (after additional controls) when applicable,
// otherwise the initial risk. ALARP-accepted hazards keep their initial risk.
// ─────────────────────────────────────────────────────────────────────────────
import { riskLevel, BANDS } from './riskMatrix'
import { CONTROL_STATUS, CONTROL_HIERARCHY } from './constants'

/** Initial risk for a hazard. */
export function initialRisk(h) {
  return riskLevel(h.probability, h.severity)
}

/**
 * Residual risk = projected P×S when set, else initial. ALARP no longer changes
 * the score — it only flags that this residual risk is accepted.
 */
export function residualRisk(h) {
  if (h.projectedProbability && h.projectedSeverity) {
    return riskLevel(h.projectedProbability, h.projectedSeverity)
  }
  return initialRisk(h)
}

/** Risk acceptability helpers (Acceptable = score ≤ 6). */
export const isAcceptable = (risk) => !!risk?.acceptable
export const isNonAcceptable = (risk) => !!risk && !risk.acceptable

/** Flatten all hazards with their context + computed risk. */
export function flattenHazards(assessments = []) {
  const out = []
  for (const a of assessments) {
    for (const act of a.activities || []) {
      for (const h of act.hazards || []) {
        out.push({
          assessmentId: a.id,
          assessmentName: a.name || 'Untitled',
          siteName: a.siteName || '',
          activityTitle: act.title || 'Untitled activity',
          hazard: h,
          initial: initialRisk(h),
          residual: residualRisk(h),
        })
      }
    }
  }
  return out
}

/** All controls (existing + additional) across all hazards, flattened. */
export function flattenControls(assessments = []) {
  const out = []
  for (const a of assessments) {
    for (const act of a.activities || []) {
      for (const h of act.hazards || []) {
        for (const c of h.controls || []) out.push(c)
        for (const c of h.additionalControls || []) out.push(c)
      }
    }
  }
  return out
}

/** Hazard label for lists/tables. */
export function hazardLabel(h) {
  return h.hazardType || h.hazardCategory || 'Hazard'
}

/**
 * Split hazards into the registers the Risk Register shows:
 *  - alarp    = hazards marked ALARP
 *  - high     = residual band is High
 *  - critical = residual band is Critical
 * Each item is a flattenHazards row.
 */
export function riskLists(assessments = []) {
  const rows = flattenHazards(assessments)
  return {
    alarp: rows.filter((r) => r.hazard.alarp),
    high: rows.filter((r) => r.residual?.key === 'high'),
    critical: rows.filter((r) => r.residual?.key === 'critical'),
    acceptableInitial: rows.filter((r) => isAcceptable(r.initial)),
    nonAcceptableInitial: rows.filter((r) => isNonAcceptable(r.initial)),
    acceptableResidual: rows.filter((r) => isAcceptable(r.residual)),
    nonAcceptableResidual: rows.filter((r) => isNonAcceptable(r.residual)),
    // Needs attention: residual still non-acceptable and not yet ALARP-accepted.
    actionRequired: rows.filter((r) => isNonAcceptable(r.residual) && !r.hazard.alarp),
  }
}

/** Every additional control across all assessments, with its context. */
export function flattenAdditionalControls(assessments = []) {
  const out = []
  for (const a of assessments) {
    for (const act of a.activities || []) {
      for (const h of act.hazards || []) {
        const initial = initialRisk(h)
        const residual = residualRisk(h)
        for (const c of h.additionalControls || []) {
          out.push({
            assessmentId: a.id,
            assessmentName: a.name || 'Untitled',
            siteName: a.siteName || '',
            members: a.members || [],
            activityId: act.id,
            activityTitle: act.title || 'Untitled activity',
            hazardId: h.id,
            hazardLabel: hazardLabel(h),
            alarp: !!h.alarp,
            initial,
            residual,
            control: c,
          })
        }
      }
    }
  }
  return out
}

/** ISO date (yyyy-mm-dd) for "today" in local time. */
export function todayISO(today = new Date()) {
  const tz = today.getTimezoneOffset() * 60000
  return new Date(today.getTime() - tz).toISOString().slice(0, 10)
}

/** A non-Implemented control whose due date is in the past. */
export function isOverdue(control, today = new Date()) {
  if (!control?.dueDate || control.status === 'Implemented') return false
  return control.dueDate < todayISO(today)
}

export function summarize(assessments = []) {
  const hazards = flattenHazards(assessments)
  const controls = flattenControls(assessments)

  // Count hazards per band (by residual risk).
  const byBand = {}
  for (const b of BANDS) byBand[b.key] = 0
  let permissible = 0
  let highCritical = 0
  let alarp = 0
  const byActivity = {}

  for (const row of hazards) {
    const r = row.residual
    if (r) {
      byBand[r.key] = (byBand[r.key] || 0) + 1
      if (r.permissible) permissible++
      if (r.key === 'high' || r.key === 'critical') highCritical++
    }
    if (row.hazard.alarp) alarp++
    byActivity[row.activityTitle] = (byActivity[row.activityTitle] || 0) + 1
  }

  // Control status breakdown (all controls).
  const controlStatus = {}
  for (const s of CONTROL_STATUS) controlStatus[s.key] = 0
  for (const c of controls) {
    const key = c.status || 'Open'
    controlStatus[key] = (controlStatus[key] || 0) + 1
  }

  // Control-action (CAPA = additional controls) status + overdue count.
  const actions = flattenAdditionalControls(assessments)
  const actionStatus = {}
  for (const s of CONTROL_STATUS) actionStatus[s.key] = 0
  let overdueActions = 0
  for (const r of actions) {
    const key = r.control.status || 'Open'
    actionStatus[key] = (actionStatus[key] || 0) + 1
    if (isOverdue(r.control)) overdueActions++
  }
  const openActions = (actionStatus['Open'] || 0) + (actionStatus['In Progress'] || 0)

  // Control type (hierarchy) breakdown — existing vs additional controls.
  const controlsByHierarchy = {}
  const additionalByHierarchy = {}
  for (const x of CONTROL_HIERARCHY) { controlsByHierarchy[x.key] = 0; additionalByHierarchy[x.key] = 0 }
  for (const a of assessments) {
    for (const act of a.activities || []) {
      for (const h of act.hazards || []) {
        for (const c of h.controls || []) if (c.hierarchy in controlsByHierarchy) controlsByHierarchy[c.hierarchy]++
        for (const c of h.additionalControls || []) if (c.hierarchy in additionalByHierarchy) additionalByHierarchy[c.hierarchy]++
      }
    }
  }

  return {
    totalAssessments: assessments.length,
    totalHazards: hazards.length,
    totalControls: controls.length,
    permissible,
    highCritical,
    alarp,
    byBand,
    byActivity,
    controlStatus,
    actionStatus,
    openActions,
    overdueActions,
    controlsByHierarchy,
    additionalByHierarchy,
    hazards,
  }
}

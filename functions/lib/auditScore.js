// ─────────────────────────────────────────────────────────────────────────────
// The pass-rate readers the ODIN dashboard uses, plus the one-site summary
// the WhatsApp and Telegram lookups send.
//
// day0Of / n7Of / auditPopulation used to live only in the dashboard. A
// second copy is how two tabs once disagreed about the same audits (see the
// comment on auditPopulation). The lookup asks these functions, and the
// dashboard re-exports them, so a score on the phone is the score on the tab.
//
// This file stays free of node builtins and of metabase.js. The dashboard
// bundle imports it, and metabase.js pulls in node:dns. OPEN_POINT_TERMINAL
// mirrors TERMINAL_STATUSES; auditScore.test.js fails if the two drift.
// ─────────────────────────────────────────────────────────────────────────────
import { resolveOdinRows } from './odinJoin.js'

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * Statuses where nothing further is going to happen.
 *
 * The same two values as TERMINAL_STATUSES in metabase.js, and for the same
 * reason: a rejected observation was not fixed, and it is not still open.
 * `status !== 'closed'` counts rejections as work left to do.
 */
export const OPEN_POINT_TERMINAL = ['closed', 'rejected']

/** How many open points a chat message will spell out before "+N more". */
export const OPEN_POINT_CAP = 10

/**
 * The total a pass rate is out of.
 *
 * A stated total wins over a derived one: an audit can have checks that were
 * neither passed nor failed — not applicable, not reached — and the question is
 * the authority on its own denominator. Half a pair derives nothing, because
 * reading a missing fail count as zero turns "8 passed, failures not recorded"
 * into a perfect audit.
 */
export function checksTotalOf(row, suffix = '') {
  const stated = row?.[`checksTotal${suffix}`]
  if (isNum(stated) && stated > 0) return stated
  const p = row?.[`checksPassed${suffix}`]
  const f = row?.[`checksFailed${suffix}`]
  return isNum(p) && isNum(f) && p + f > 0 ? p + f : null
}

/** One row's pass rate on the day of the audit, whichever way it was stated. */
export function day0Of(row) {
  if (isNum(row?.passPct)) return row.passPct
  const total = checksTotalOf(row)
  return total && isNum(row?.checksPassed) ? (row.checksPassed / total) * 100 : null
}

/** The same at the seven-day re-check. */
export function n7Of(row) {
  if (isNum(row?.passPctN7)) return row.passPctN7
  const total = checksTotalOf(row, 'N7')
  return total && isNum(row?.checksPassedN7) ? (row.checksPassedN7 / total) * 100 : null
}

/**
 * The same again with every remediation to date credited, not just seven days.
 *
 * ── Read, but no longer drawn ───────────────────────────────────────────────
 *
 * This is the one reading on the page that is NOT bounded by the dates the
 * reader chose. `passPctToDate` is the centre's score as of today — it credits
 * whatever closed since the audit, so it moves on every refresh while the
 * window stands still. Beside two figures that do answer "what happened between
 * these dates", a third that quietly answers "and where are we now" reads as
 * the same kind of number and is not one.
 *
 * Kept as a mapped column because it costs nothing and a later panel may want
 * it under a heading that says what it is. Nothing charts it today.
 */
export function toDateOf(row) {
  if (isNum(row?.passPctToDate)) return row.passPctToDate
  return null
}

/** Does this row carry a pass rate at all, in either shape? */
export const hasPassData = (row) => isNum(day0Of(row)) || isNum(n7Of(row))

/**
 * The rows that ARE the audits — whichever question they arrived on.
 *
 * The audits question when it carries pass data. Otherwise the findings rows
 * that do, because plenty of warehouses hold one row per checklist line with
 * the result on it, and requiring a second saved question to unlock a chart the
 * data already supports is a configuration tax with nothing behind it.
 *
 * ── Why this is shared rather than repeated ─────────────────────────────────
 *
 * Both the N+7 tab and the Auditors tab are answering questions about the same
 * population, and they disagreed. odinAnalytics had this fallback; the Auditors
 * tab asked for the `audits` dataset directly and had none. On a real tenant
 * whose audit question was configured under `findings` — with the audits slot
 * pointing at a card id that did not exist — the N+7 tab drew 832 audits from
 * the fallback while Auditors showed "Metabase has no saved question with that
 * ID". One number on one screen and an error on the next, from one dataset.
 *
 * So the decision lives here and both callers ask it. `source` is returned
 * because the two are subtly different populations — one row per audit against
 * one row per checklist line — and a reader comparing months has to know if the
 * basis moved under them.
 */
export function auditPopulation(findingRows = [], auditRows = []) {
  const fromAudits = (auditRows || []).some(hasPassData)
  if (fromAudits) return { rows: auditRows, source: 'audits' }
  const fromFindings = (findingRows || []).filter(hasPassData)
  return { rows: fromFindings, source: fromFindings.length ? 'findings' : 'none' }
}

const STATUS_RANK = { open: 0, in_progress: 1, on_hold: 2, unknown: 3 }

function weightOf(row) {
  if (isNum(row?.count)) return row.count > 0 ? row.count : 0
  return 1
}

/** The words a chat can show for one observation. The formatter still caps it. */
export function openPointLabel(row) {
  const checkpoint = String(row?.checkpoint || '').trim()
  const sub = String(row?.subCategory || '').trim()
  const cat = String(row?.category || '').trim()
  const what = checkpoint || sub || cat || 'Observation'
  const prefix = checkpoint && (sub || cat) ? `${sub || cat}: ` : ''
  const weight = weightOf(row)
  const suffix = weight > 1 ? ` (${weight})` : ''
  return `${prefix}${what}${suffix}`
}

function meanReading(rows, read) {
  const values = []
  for (const row of rows) {
    const value = read(row)
    if (isNum(value)) values.push(value)
  }
  if (!values.length) return null
  // One row keeps the warehouse's own figure. Averaging a single percentage
  // with itself would round it, and the dashboard does not round a lone score.
  if (values.length === 1) return values[0]
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10
}

/**
 * The latest scored audit for one site, and the observations from that audit
 * that are still open.
 *
 * `site` is a register record the caller is already allowed to see. Rows are
 * the normalized Metabase shape (metabase.js normalizeRows). Findings and
 * audits are joined to that one site with resolveOdinRows and keepUnplaced
 * false, which is the dashboard's rule for "not this viewer's site": a row
 * that does not match is dropped, not shown under a guessed name.
 *
 * Pass `findingRows` as null when the findings question did not answer. An
 * empty array means it answered and there were no rows — those are different
 * sentences on the phone ("unavailable" against "none").
 *
 * The latest audit is the greatest auditDate among the audit population.
 * An undated row is not "latest": the dashboard already refuses to plot one
 * as a real month, and the phone must not present one as the last audit.
 * Several scored rows on that date (checklist lines, or two audits the same
 * day with no time) share one score: the mean of each reading, rounded the
 * way the dashboard rounds an aggregate. Open points are findings on that
 * date that are not closed and not rejected. When every scored row that day
 * names one audit type, findings of a different type are left out; a finding
 * with no type is kept, because dropping it would hide an observation the
 * warehouse did not know how to file.
 *
 * @returns null when this site has no dated, scored audit in the rows.
 */
export function lastSiteAudit(site, findingRows, auditRows = [], { cap = OPEN_POINT_CAP } = {}) {
  if (!site || typeof site !== 'object') return null
  const findingsKnown = findingRows != null
  const findings = findingsKnown
    ? resolveOdinRows(findingRows, [site], { keepUnplaced: false })
    : []
  const audits = resolveOdinRows(auditRows || [], [site], { keepUnplaced: false })
  const population = auditPopulation(findings, audits)
  // A later row with a date and no pass rate is not the last audit. The
  // audits question includes checklist lines that never carried a score, and
  // taking the max date among those would title the reply with a visit whose
  // score is blank.
  const dated = population.rows.filter((row) => row?.auditDate && hasPassData(row))
  if (!dated.length) return null

  const date = dated.reduce((max, row) => (row.auditDate > max ? row.auditDate : max), '')
  const onDay = dated.filter((row) => row.auditDate === date)
  const types = new Set(onDay.map((row) => String(row.auditType || '').trim()).filter(Boolean))
  const onlyType = types.size === 1 ? [...types][0] : ''

  let openPoints = []
  let openTotal = 0
  let openMore = 0
  if (findingsKnown) {
    const open = findings
      .filter((row) => {
        if (row.auditDate !== date) return false
        if (OPEN_POINT_TERMINAL.includes(row.status)) return false
        if (onlyType && row.auditType && row.auditType !== onlyType) return false
        return weightOf(row) > 0
      })
      .map((row) => ({ row, label: openPointLabel(row), weight: weightOf(row) }))
      .sort((a, b) => {
        const rankA = STATUS_RANK[a.row.status] ?? 4
        const rankB = STATUS_RANK[b.row.status] ?? 4
        if (rankA !== rankB) return rankA - rankB
        return a.label.localeCompare(b.label)
      })
    openTotal = open.reduce((sum, item) => sum + item.weight, 0)
    const shown = open.slice(0, cap)
    const shownWeight = shown.reduce((sum, item) => sum + item.weight, 0)
    openPoints = shown.map((item) => item.label)
    openMore = Math.max(0, openTotal - shownWeight)
  }

  return {
    date,
    scoreOnDay: meanReading(onDay, day0Of),
    scoreAfter7: meanReading(onDay, n7Of),
    source: population.source,
    findingsKnown,
    openPoints,
    openTotal,
    openMore,
  }
}

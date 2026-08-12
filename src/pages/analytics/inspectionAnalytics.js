// ─────────────────────────────────────────────────────────────────────────────
// What the inspection programme is actually finding, and what happened next.
//
// Two questions, and they are not the same one. "Where do we keep failing" is
// answered by grouping failures under the category their question was filed
// under — the reason categories exist on a checklist at all. "Is anything being
// fixed" is answered by the state of the actions those failures opened, which
// is the only measure that distinguishes a safety programme from a survey.
//
// Pure: no React, no Firestore. The tab renders these; the tests pin them.
// ─────────────────────────────────────────────────────────────────────────────

const UNCATEGORIZED = 'General'

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v))

/** The date a record belongs to, as YYYY-MM-DD. */
export function recordDate(record = {}) {
  const raw = record.completedAt || record.scheduledFor || record.dueString || ''
  return str(raw).slice(0, 10)
}

/** Its month, as YYYY-MM — the granularity the shared filter bar works in. */
export function recordMonth(record = {}) {
  return recordDate(record).slice(0, 7)
}

/**
 * Narrow records by site, month range and checklist.
 *
 * `from`/`to` are months (YYYY-MM) because that is what the shared FilterBar
 * offers, and comparing them as strings is correct for that format. A record
 * with no usable date is kept when no range is set and dropped once one is —
 * silently including undated rows in a bounded total is the kind of wrong that
 * makes a chart untrustworthy without ever looking broken.
 */
export function filterRecords(records = [], f = {}) {
  const { siteId = 'all', from = '', to = '', templateId = 'all' } = f
  return (records || []).filter((r) => {
    if (!r) return false
    if (siteId !== 'all' && r.siteId !== siteId) return false
    if (templateId !== 'all' && r.templateId !== templateId) return false
    if (from || to) {
      const m = recordMonth(r)
      if (!m) return false
      if (from && m < from) return false
      if (to && m > to) return false
    }
    return true
  })
}

/** Every checklist represented in the records, for the tab's own picker. */
export function checklistOptions(records = []) {
  const byId = new Map()
  for (const r of records || []) {
    if (!r?.templateId) continue
    if (!byId.has(r.templateId)) byId.set(r.templateId, str(r.templateTitle) || 'Untitled checklist')
  }
  return [...byId.entries()]
    .map(([id, title]) => ({ id, title }))
    .sort((a, b) => a.title.localeCompare(b.title))
}

/** Months present, ascending — feeds the From/To pickers. */
export function monthOptions(records = []) {
  return [...new Set((records || []).map(recordMonth).filter(Boolean))].sort()
}

/**
 * Observations per category.
 *
 * An "observation" here is a FAILED check — the thing that generated work. The
 * category comes off the response, not the live checklist, because a question
 * re-filed later must not silently re-file every inspection ever done against
 * it: history would change under a chart someone is reading.
 *
 * Also carries pass/na so a category with 40 checks and 2 failures is not read
 * the same as one with 2 checks and 2 failures.
 */
export function byCategory(records = []) {
  const rows = new Map()
  const row = (name) => {
    if (!rows.has(name)) rows.set(name, { category: name, observations: 0, pass: 0, na: 0, checks: 0 })
    return rows.get(name)
  }

  for (const rec of records || []) {
    for (const r of Object.values(rec?.responses || {})) {
      if (!r) continue
      const answer = r.answer
      if (answer !== 'Fail' && answer !== 'Pass' && answer !== 'N/A') continue
      const e = row(str(r.category).trim() || UNCATEGORIZED)
      e.checks += 1
      if (answer === 'Fail') e.observations += 1
      else if (answer === 'Pass') e.pass += 1
      else e.na += 1
    }
  }

  return [...rows.values()]
    .map((e) => ({ ...e, failRate: e.checks ? Math.round((e.observations / e.checks) * 100) : 0 }))
    // Most observations first — the chart is read to find where the problems
    // are, and ties break by name so the order does not wobble between renders.
    .sort((a, b) => b.observations - a.observations || a.category.localeCompare(b.category))
}

/**
 * Progress of the actions those failures opened.
 *
 * Mirrors how the Action Tracker derives them (modules/actions/lib/sources.js):
 * a Fail is an action, and its state lives on the response as `actionStatus`,
 * defaulting to open. Overdue is counted against actionDue, and only for items
 * that are still open — a closed action that closed late is history, not a
 * thing anybody needs to chase today.
 */
export function actionProgress(records = [], today = '') {
  const out = { total: 0, open: 0, inProgress: 0, done: 0, overdue: 0, unassigned: 0 }

  for (const rec of records || []) {
    for (const r of Object.values(rec?.responses || {})) {
      if (!r || r.answer !== 'Fail') continue
      out.total += 1
      const status = str(r.actionStatus) || 'open'
      if (status === 'closed' || status === 'done') out.done += 1
      else if (status === 'in_progress') out.inProgress += 1
      else out.open += 1

      if (status !== 'closed' && status !== 'done') {
        const due = str(r.actionDue)
        if (today && due && due < today) out.overdue += 1
        if (!str(r.actionOwner).trim() && !str(rec.inspector).trim()) out.unassigned += 1
      }
    }
  }

  out.completion = out.total ? Math.round((out.done / out.total) * 100) : 0
  return out
}

/** Headline counts for the tab's stat row. */
export function summary(records = []) {
  let checks = 0
  let observations = 0
  let scored = 0
  let scoreTotal = 0

  for (const rec of records || []) {
    for (const r of Object.values(rec?.responses || {})) {
      if (!r) continue
      if (r.answer === 'Fail') { observations += 1; checks += 1 }
      else if (r.answer === 'Pass' || r.answer === 'N/A') checks += 1
    }
    if (Number.isFinite(rec?.score)) { scored += 1; scoreTotal += rec.score }
  }

  return {
    inspections: (records || []).length,
    checks,
    observations,
    // Averaged over records that HAVE a score, not over all of them — dividing
    // by records that never carried one drags the average toward zero and makes
    // a clean month look like a bad one.
    avgScore: scored ? Math.round(scoreTotal / scored) : null,
  }
}

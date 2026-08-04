// ─────────────────────────────────────────────────────────────────────────────
// What the last inspection found here.
//
// An inspection run cold repeats itself: the same loose handrail gets written
// up month after month because the inspector had no way to know it was written
// up last time. Carrying the previous run's failures into the current one turns
// each inspection into a check on the last one — which is what a recurring
// inspection is supposed to be.
//
// "Previous" is deliberately narrow: the same form, at the same site. A
// different form asks different questions, and the same form at another site is
// about a different handrail. Comparing across either would produce findings
// that cannot be verified, which is worse than showing none.
// ─────────────────────────────────────────────────────────────────────────────

const time = (r) => {
  const t = Date.parse(r?.completedAt || '')
  return Number.isFinite(t) ? t : 0
}

/**
 * The most recent completed inspection of the same form at the same site.
 *
 * `excludeId` drops the record being viewed, so opening a saved inspection
 * shows the one before it rather than itself.
 */
export function findLastInspection(records = [], { templateId, siteId, excludeId } = {}) {
  if (!templateId) return null
  const matches = records.filter((r) =>
    r
    && r.id !== excludeId
    && r.templateId === templateId
    // Both blank counts as a match: a template with no site still has a history.
    && (r.siteId || '') === (siteId || '')
  )
  if (matches.length === 0) return null
  return matches.reduce((best, r) => (time(r) > time(best) ? r : best))
}

/**
 * The failed items of a record, in the form's own question order where it is
 * known, so the list reads down the sheet rather than in object order.
 */
export function openFindings(record, fields = []) {
  const responses = record?.responses || {}
  const order = new Map(fields.map((f, i) => [f.id, i]))

  const out = []
  for (const [fieldId, r] of Object.entries(responses)) {
    if (r?.answer !== 'Fail') continue
    out.push({
      fieldId,
      label: r.label || fieldId,
      observation: (r.observation || '').trim(),
      hasPhoto: Boolean(r.photoEvidence),
    })
  }

  out.sort((a, b) => {
    const ai = order.has(a.fieldId) ? order.get(a.fieldId) : Number.MAX_SAFE_INTEGER
    const bi = order.has(b.fieldId) ? order.get(b.fieldId) : Number.MAX_SAFE_INTEGER
    return ai - bi || a.label.localeCompare(b.label)
  })
  return out
}

/**
 * Everything the Execute screen needs about the previous run.
 *
 * `byField` is what drives the per-question marker: the inspector should see
 * "failed last time" on the question itself, at the moment they answer it, not
 * only in a summary at the top they scrolled past.
 */
export function previousInspection(records, { templateId, siteId, excludeId, fields = [] } = {}) {
  const record = findLastInspection(records, { templateId, siteId, excludeId })
  if (!record) return null
  const findings = openFindings(record, fields)
  return {
    record,
    findings,
    byField: new Map(findings.map((f) => [f.fieldId, f])),
    completedAt: record.completedAt || '',
    inspector: record.inspectorName || record.createdByName || '',
    score: typeof record.score === 'number' ? record.score : null,
    result: record.passFailResult || '',
    docId: record.docId || '',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pre-launch readiness, per site.
//
// The document library answers "what has this site filed?". This answers the
// question a launch actually turns on: "what does it still owe?" — the handover
// schedule in modules/documents/lib/prelaunch.js, measured against every site
// the viewer can see.
//
// ── Why it does not go through attachSites ───────────────────────────────────
//
// Every other tab resolves a record to a site by id and then by matching a
// free-text centre name, because those collections predate siteId. Documents do
// not: `siteId` is written by the folder a document is filed into, and the
// security rule reads the same field. A name fallback here would attribute a
// document to a site the rules never let it near, which in a readiness figure
// means a site reading 30 of 35 on somebody else's certificates.
//
// So: siteId, exactly, or the document does not count towards any site.
//
// ── Denominator ─────────────────────────────────────────────────────────────
//
// Every site owes the whole schedule, so the denominator is the number of SITES
// times PRE_LAUNCH_TOTAL, not the number of documents anybody happens to have
// created. A percentage whose denominator grows as work is done cannot fall,
// and a readiness figure that cannot fall is not a measurement.
// ─────────────────────────────────────────────────────────────────────────────

import {
  PRE_LAUNCH_CATEGORIES, PRE_LAUNCH_TOTAL, pct, prelaunchReadiness,
} from '../../modules/documents/lib/prelaunch'

const clean = (v) => String(v ?? '').trim()

const UNSET = 'Unassigned'

/** Green only at 100%; see the same rule in the library's own readiness bar. */
export const readyColor = (percent) =>
  (percent >= 100 ? '#22c55e' : percent > 0 ? '#f59e0b' : '#e5e0d8')

/**
 * One row per site, plus the totals across them.
 *
 * @param docs  the documents the viewer may read — already scoped, because who
 *              may see which site is decided by the service, not here
 * @param sites the sites the viewer may see
 * @param filters { siteId, region, entity } — no date range, because a
 *              handover pack is a state, not a series of events
 */
export function prelaunchAnalytics(docs = [], sites = [], filters = {}) {
  const { siteId = 'all', region = 'all', entity = 'all' } = filters

  // One pass over the documents rather than one per site: an org with a
  // thousand documents and eighty sites is eighty thousand comparisons the
  // other way round, on every keystroke in the filter bar.
  const bySite = new Map()
  for (const d of docs || []) {
    if (!d || d.deletedAt || !clean(d.prelaunchKey)) continue
    const id = clean(d.siteId)
    if (!id) continue
    if (!bySite.has(id)) bySite.set(id, [])
    bySite.get(id).push(d)
  }

  const rows = (sites || [])
    .filter((s) => s && clean(s.id))
    .filter((s) => (siteId === 'all' || clean(s.id) === siteId))
    .filter((s) => (region === 'all' || (clean(s.region) || UNSET) === region))
    .filter((s) => (entity === 'all' || (clean(s.entity) || UNSET) === entity))
    .map((s) => {
      const id = clean(s.id)
      return {
        key: id,
        siteId: id,
        name: clean(s.name) || id,
        region: clean(s.region) || UNSET,
        entity: clean(s.entity) || UNSET,
        ...prelaunchReadiness(bySite.get(id) || []),
      }
    })
    // Least ready first: this tab exists to be a worklist, and the sites that
    // need doing are the ones nobody has to be told about the finished ones.
    .sort((a, b) => a.pct - b.pct || a.name.localeCompare(b.name))

  const required = rows.length * PRE_LAUNCH_TOTAL
  const ready = rows.reduce((n, r) => n + r.ready, 0)
  const logged = rows.reduce((n, r) => n + r.logged, 0)

  return {
    rows,
    sites: rows.length,
    required,
    ready,
    logged,
    stub: logged - ready,
    missing: required - logged,
    pct: pct(ready, required),
    complete: rows.filter((r) => r.complete).length,
    // A site nobody has started at all reads differently from one that is
    // half done — it usually means the pack was never begun, not that it
    // stalled, and those get chased by different people.
    untouched: rows.filter((r) => r.logged === 0).length,
    byCategory: categoryRollup(rows),
    bySite: rows.map((r) => ({
      key: r.key, name: r.name, value: r.pct, color: readyColor(r.pct),
    })),
    byRegion: groupRollup(rows, (r) => r.region),
    byEntity: groupRollup(rows, (r) => r.entity),
  }
}

/**
 * Each category's readiness across every site in scope.
 *
 * Which part of the schedule the estate is worst at — the question that says
 * whether the gap is one site's problem or the electrical contractor's.
 */
function categoryRollup(rows) {
  return PRE_LAUNCH_CATEGORIES.map((c) => {
    let ready = 0
    let total = 0
    for (const r of rows) {
      const mine = r.byCategory.find((x) => x.key === c.key)
      if (!mine) continue
      ready += mine.ready
      total += mine.total
    }
    const percent = pct(ready, total)
    return {
      key: c.key, name: c.name, numeral: c.numeral,
      ready, total, pct: percent, value: percent, color: readyColor(percent),
    }
  })
}

/** Readiness by region or entity: ready documents over documents owed. */
function groupRollup(rows, key) {
  const m = new Map()
  for (const r of rows) {
    const k = key(r)
    const at = m.get(k) || { ready: 0, total: 0, sites: 0 }
    at.ready += r.ready
    at.total += r.total
    at.sites += 1
    m.set(k, at)
  }
  return [...m.entries()]
    .map(([name, v]) => {
      const percent = pct(v.ready, v.total)
      return { key: name, name, value: percent, color: readyColor(percent), sites: v.sites }
    })
    .sort((a, b) => a.value - b.value || a.name.localeCompare(b.name))
}

/** The region and entity values worth offering in the filter bar. */
export function prelaunchFacets(sites = []) {
  const regions = new Set()
  const entities = new Set()
  for (const s of sites || []) {
    if (!s) continue
    if (clean(s.region)) regions.add(clean(s.region))
    if (clean(s.entity)) entities.add(clean(s.entity))
  }
  return { regions: [...regions].sort(), entities: [...entities].sort() }
}

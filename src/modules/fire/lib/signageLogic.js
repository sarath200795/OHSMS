import { FLOOR_SIGNAGE_TYPES, SIGNAGE_TYPES } from './constants'

// Scoring rules for safety signage, shared by the Signage matrix (the register)
// and the Signage Compliance dashboard so both read a site the same way. Keeping
// them in one place is the point: a site that shows "covered" on the matrix and
// "gap" on the dashboard is worse than having no dashboard at all.

// Conditions that mean the signage exists but needs attention.
export const ISSUE_CONDITIONS = ['Faded', 'Damaged', 'Obstructed']

// Every fire extinguisher should have a "Fire Extinguisher Sign", so this type
// is scored against the number of extinguishers at the site (from the
// Repository) rather than mere presence.
export const EXT_SIGN_TYPE = 'Fire Extinguisher Sign'

export const isFerp = (type) => FLOOR_SIGNAGE_TYPES.includes(type)
// Floors that have FERP, given a record.
export const ferpCovered = (s) => (s.allFloors ? s.totalFloors || 0 : s.floorsCovered || 0)

/**
 * Site name → region / entity. The extinguisher register carries these fields
 * on nearly every unit, so it wins; signage fills the sites that have no
 * extinguisher yet. First non-empty value per site.
 */
export function siteAttributeMap(field, extinguishers = [], signages = []) {
  const m = {}
  for (const e of extinguishers) if (e.centerName && e[field] && !m[e.centerName]) m[e.centerName] = e[field]
  for (const s of signages) if (s.centerName && s[field] && !m[s.centerName]) m[s.centerName] = s[field]
  return m
}

/** Site name → number of extinguishers, i.e. the required count of ext signs. */
export function extCountBySite(extinguishers = []) {
  const m = {}
  for (const e of extinguishers) {
    if (!e.centerName) continue
    m[e.centerName] = (m[e.centerName] || 0) + 1
  }
  return m
}

/**
 * Status of one (site, type) cell from the records already narrowed to it.
 * → { count, status: 'ok' | 'issue' | 'missing' | 'none', label? }
 * `required` is the site's extinguisher count, used only for EXT_SIGN_TYPE.
 */
export function signageCell(recs, type, required = 0) {
  if (type === EXT_SIGN_TYPE) {
    const present = recs.filter((r) => r.condition !== 'Missing')
    const recorded = present.reduce((a, r) => a + (Number(r.quantity) || 1), 0)
    if (recs.length === 0 && required === 0) return { count: 0, status: 'none' }
    let status
    if (required === 0) status = recorded > 0 ? 'ok' : 'none'
    else if (recorded === 0) status = 'missing'
    else if (recorded < required) status = 'issue'
    else status = 'ok'
    if (status === 'ok' && present.some((r) => ISSUE_CONDITIONS.includes(r.condition))) status = 'issue'
    const label = required > 0 ? `${recorded}/${required}` : (recorded > 0 ? String(recorded) : '—')
    return { count: recs.length, status, label }
  }

  if (recs.length === 0) return { count: 0, status: 'none' }
  // FERP shows floor coverage (covered / total) rather than a plain count.
  if (isFerp(type)) {
    const rec = recs.reduce((a, b) => ((b.totalFloors || 0) > (a.totalFloors || 0) ? b : a), recs[0])
    const total = rec.totalFloors || 0
    const covered = ferpCovered(rec)
    const missing = recs.some((r) => r.condition === 'Missing')
    let status = 'ok'
    if (missing || covered === 0) status = 'missing'
    else if (total > 0 && covered < total) status = 'issue'
    return { count: recs.length, status, label: total > 0 ? `${covered}/${total}` : '✓' }
  }
  if (recs.some((r) => r.condition === 'Missing')) return { count: recs.length, status: 'missing' }
  if (recs.some((r) => ISSUE_CONDITIONS.includes(r.condition))) return { count: recs.length, status: 'issue' }
  return { count: recs.length, status: 'ok' }
}

/**
 * A type counts toward a site's coverage when its cell is satisfied. The
 * fire-extinguisher column requires a FULL match to the fleet (status 'ok'),
 * not mere presence.
 *
 * Everywhere else, covered means the sign IS THERE — 'ok', or 'issue' where it
 * is faded or obstructed but present. Deliberately not `count > 0`: a record
 * whose condition is Missing is a surveyor reporting the sign is absent, and
 * counting it as covered made a recorded absence read as compliance. That is
 * the one answer this dashboard exists to give, and it gave the opposite: the
 * matrix drew the cell red while the coverage total counted it green.
 */
export const isTypeCovered = (type, cell) =>
  type === EXT_SIGN_TYPE ? cell.status === 'ok' : cell.status === 'ok' || cell.status === 'issue'

/**
 * Compliance across a set of sites.
 *
 * A "cell" is one (site, signage type) pair — the unit the matrix scores and the
 * unit compliance is measured in, so a site with ten types and one gap reads as
 * 90 %, not as a plain pass/fail.
 *
 * → {
 *     sites, records, types,
 *     cells, covered, ok, issue, missing, notRecorded, compliance,
 *     fullyCompliant, sitesWithGaps,
 *     byType: [{ type, covered, gaps, issues, records, compliance }],
 *     bySite: [{ site, region, entity, covered, total, gaps, issues, records, compliance, missingTypes }],
 *     byCondition: { [condition]: count },
 *   }
 */
export function signageSummary(sites, signages, extinguishers, types = SIGNAGE_TYPES) {
  const regionOf = siteAttributeMap('region', extinguishers, signages)
  const entityOf = siteAttributeMap('entity', extinguishers, signages)
  const extCounts = extCountBySite(extinguishers)

  // Bucket the register by site once — signageSummary runs over every site ×
  // every type, and re-scanning the whole register in each cell is what makes a
  // 2 000-record fleet feel broken.
  const bySiteRecords = new Map(sites.map((s) => [s, []]))
  let records = 0
  const byCondition = {}
  for (const s of signages) {
    if (!bySiteRecords.has(s.centerName)) continue
    bySiteRecords.get(s.centerName).push(s)
    records++
    const c = s.condition || 'OK'
    byCondition[c] = (byCondition[c] || 0) + 1
  }

  const byType = types.map((t) => ({ type: t, covered: 0, gaps: 0, issues: 0, records: 0, compliance: 0 }))
  const typeIndex = new Map(byType.map((r, i) => [r.type, i]))

  const totals = { ok: 0, issue: 0, missing: 0, notRecorded: 0 }
  const bySite = []

  for (const site of sites) {
    const siteRecs = bySiteRecords.get(site) || []
    const row = {
      site,
      region: regionOf[site] || '',
      entity: entityOf[site] || '',
      covered: 0,
      total: types.length,
      gaps: 0,
      issues: 0,
      records: siteRecs.length,
      compliance: 0,
      missingTypes: [],
    }
    for (const type of types) {
      const recs = siteRecs.filter((r) => r.type === type)
      const cell = signageCell(recs, type, extCounts[site] || 0)
      const t = byType[typeIndex.get(type)]
      t.records += recs.length
      totals[cell.status === 'none' ? 'notRecorded' : cell.status]++
      if (isTypeCovered(type, cell)) {
        row.covered++
        t.covered++
      } else {
        row.gaps++
        t.gaps++
        row.missingTypes.push(type)
      }
      if (cell.status === 'issue') {
        row.issues++
        t.issues++
      }
    }
    row.compliance = row.total ? Math.round((row.covered / row.total) * 100) : 0
    bySite.push(row)
  }

  const cells = sites.length * types.length
  const covered = bySite.reduce((n, r) => n + r.covered, 0)
  for (const t of byType) t.compliance = sites.length ? Math.round((t.covered / sites.length) * 100) : 0

  return {
    sites: sites.length,
    records,
    types: types.length,
    cells,
    covered,
    ...totals,
    compliance: cells ? Math.round((covered / cells) * 100) : 0,
    fullyCompliant: bySite.filter((r) => r.gaps === 0).length,
    sitesWithGaps: bySite.filter((r) => r.gaps > 0).length,
    byType: byType.sort((a, b) => a.compliance - b.compliance || a.type.localeCompare(b.type)),
    bySite: bySite.sort((a, b) => b.gaps - a.gaps || b.issues - a.issues || a.site.localeCompare(b.site)),
    byCondition,
  }
}

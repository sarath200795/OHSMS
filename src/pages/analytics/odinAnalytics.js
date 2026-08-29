// ─────────────────────────────────────────────────────────────────────────────
// ODIN — the arithmetic, with no React and no network in it.
//
// The rows arrive already mapped onto a canonical shape by the server
// (functions/lib/metabase.js), so nothing here knows what a warehouse column is
// called. What it does know is the awkward middle: a Metabase question rarely
// carries coordinates, statuses come back in whatever words the source system
// uses, and a pass percentage averaged across sites of wildly different size is
// a number that reads as fact and is not one.
//
// Three rules run through all of it.
//
//   Nothing is silently dropped. A finding whose site cannot be placed on the
//   map is still counted in every bar; the map says how many it could not show.
//
//   Nothing is silently invented. An unrecognised status is not folded into
//   "Open" — it is counted separately and reported, because a chart nobody can
//   tell is wrong is worse than a chart with a caveat under it.
//
//   Percentages are weighted where the data allows it. Averaging "100% of 4
//   checks" with "50% of 400" gives 75%, and the honest answer is 50.5%.
// ─────────────────────────────────────────────────────────────────────────────

// Mirrors STATUSES in functions/lib/metabase.js, which is the authority on the
// mapping. Duplicated rather than imported because functions/ is a separate
// package with its own node_modules and is not part of the browser bundle; the
// four keys are a contract between them, and odinAnalytics.test.js pins them.
export const STATUS_META = [
  { key: 'open', label: 'Open', color: '#ef4444' },
  { key: 'in_progress', label: 'In Progress', color: '#f59e0b' },
  { key: 'on_hold', label: 'On Hold', color: '#8b5cf6' },
  { key: 'closed', label: 'Closed', color: '#22c55e' },
]
export const STATUS_KEYS = STATUS_META.map((s) => s.key)
export const STATUS_BY_KEY = Object.fromEntries(STATUS_META.map((s) => [s.key, s]))

/** A palette for sub-categories, which are free text and can be anything. */
const PALETTE = [
  '#0d9488', '#dc2626', '#2563eb', '#d97706', '#7c3aed', '#059669',
  '#db2777', '#0891b2', '#ca8a04', '#4f46e5', '#e11d48', '#65a30d',
]
export const paletteColor = (i) => PALETTE[i % PALETTE.length]

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const norm = (s) => String(s || '').trim().toLowerCase()

const UNPLACED = '(not stated)'

/**
 * Fill in what the warehouse did not say, from the site register this app
 * already holds.
 *
 * A Metabase question almost never carries coordinates, and asking an
 * organization to add latitude and longitude columns to their analytics
 * warehouse in order to see a map is asking them to duplicate a register they
 * are already maintaining here. So the join runs the other way: match on site
 * id first — an exact key beats a name every time — then on the site's name,
 * case- and space-insensitively.
 *
 * Region and entity are filled in the same way and only where the row is
 * SILENT. A row that states its own region wins: the warehouse is the system of
 * record for the finding, and quietly overwriting what it said with what our
 * register believes is how two dashboards start disagreeing.
 *
 * ── keepUnplaced, which is the scoping ──────────────────────────────────────
 *
 * `sites` is the list the viewer may SEE, not the whole register — every
 * analytics tab is handed it that way. So a row matching none of them is either
 * a site outside this viewer's grant or a name our register does not carry, and
 * the two are indistinguishable from here.
 *
 * For someone who can see every site, it is the second: keep it, or a finding
 * whose warehouse spelling differs from ours vanishes from the totals. For
 * anyone else it is most likely the first, and showing them another region's
 * findings because the join happened to fail is the scoping mistake this whole
 * page is most exposed to. Same rule, same parameter name, as resolveIncidents.
 */
export function resolveOdinRows(rows = [], sites = [], { keepUnplaced = true } = {}) {
  const byId = new Map()
  const byName = new Map()
  for (const s of sites || []) {
    if (s?.id) byId.set(String(s.id), s)
    if (s?.name) byName.set(norm(s.name), s)
  }

  return (rows || []).filter(Boolean).map((r) => {
    const site = (r.siteId && byId.get(String(r.siteId))) || (r.site && byName.get(norm(r.site))) || null
    return {
      ...r,
      site: r.site || site?.name || '',
      region: r.region || site?.region || '',
      entity: r.entity || site?.entity || '',
      lat: isNum(r.lat) ? r.lat : (isNum(site?.lat) ? site.lat : null),
      lng: isNum(r.lng) ? r.lng : (isNum(site?.lng) ? site.lng : null),
      // Where the coordinates came from, because "why is this site not on the
      // map" is the question this panel gets asked, and the answer is either
      // "your question has no lat/lng" or "that site has none in Sites".
      placedFrom: isNum(r.lat) && isNum(r.lng) ? 'query' : (isNum(site?.lat) && isNum(site?.lng) ? 'register' : ''),
      // Whether it matched a site THIS VIEWER may see, which is what the
      // filter below turns into scoping. Distinct from matchedSiteId, which
      // keeps whatever id the warehouse supplied so the map can still group by
      // it — an id we do not recognise is still an id.
      inScope: Boolean(site),
      matchedSiteId: site?.id || r.siteId || '',
    }
  }).filter((r) => keepUnplaced || r.inScope)
}

/** Every value present in the data, for the filter bar. Never the filtered set. */
export function odinFacets(rows = []) {
  const regions = new Set()
  const entities = new Set()
  const subCategories = new Set()
  const months = new Set()
  // Which Metabase instance each row came from. Only offered as a filter when
  // there is more than one — a picker with a single option is furniture.
  const sources = new Map()
  for (const r of rows) {
    if (r.region) regions.add(r.region)
    if (r.entity) entities.add(r.entity)
    if (r.subCategory) subCategories.add(r.subCategory)
    if (r.auditDate) months.add(r.auditDate.slice(0, 7))
    if (r.sourceId) sources.set(r.sourceId, r.sourceLabel || r.sourceId)
  }
  const sorted = (s) => [...s].sort((a, b) => a.localeCompare(b))
  return {
    regions: sorted(regions),
    entities: sorted(entities),
    subCategories: sorted(subCategories),
    months: sorted(months),
    sources: [...sources.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  }
}

/**
 * Apply the filter bar.
 *
 * A month range is inclusive at both ends and compares 'YYYY-MM' strings, which
 * sort chronologically — the same trick FilterBar uses everywhere else, so a
 * reader switching tabs gets the same behaviour from the same controls.
 *
 * A row with no date passes a date filter rather than being hidden by it. The
 * alternative silently removes findings from every total the moment anyone
 * touches the range, and an undated finding is a data-quality problem to be
 * seen, not one to be filtered away.
 */
export function filterOdinRows(rows = [], f = {}) {
  const { region = 'all', entity = 'all', status = 'all', subCategory = 'all', source = 'all', from = '', to = '' } = f
  return rows.filter((r) => {
    if (source !== 'all' && r.sourceId !== source) return false
    if (region !== 'all' && r.region !== region) return false
    if (entity !== 'all' && r.entity !== entity) return false
    if (status !== 'all' && r.status !== status) return false
    if (subCategory !== 'all' && r.subCategory !== subCategory) return false
    const month = r.auditDate ? r.auditDate.slice(0, 7) : ''
    if (month) {
      if (from && month < from) return false
      if (to && month > to) return false
    }
    return true
  })
}

const sum = (rows) => rows.reduce((n, r) => n + (isNum(r.count) ? r.count : 1), 0)

/** Totals per status, plus the unrecognised ones, which are reported not hidden. */
export function statusTotals(rows = []) {
  const out = Object.fromEntries(STATUS_KEYS.map((k) => [k, 0]))
  let unknown = 0
  const unknownLabels = new Set()
  for (const r of rows) {
    const n = isNum(r.count) ? r.count : 1
    if (out[r.status] === undefined) {
      unknown += n
      if (r.rawStatus) unknownLabels.add(r.rawStatus)
    } else {
      out[r.status] += n
    }
  }
  return { ...out, unknown, unknownLabels: [...unknownLabels].sort(), total: sum(rows) }
}

/**
 * One stacked bar per region: Open / In Progress / On Hold / Closed.
 *
 * Sorted by total descending — the region with the most open issues is the one
 * the meeting is about, and alphabetical order buries it. Regions the data does
 * not state are grouped under a named bucket rather than dropped, because
 * "eleven findings we cannot attribute to a region" is itself a finding.
 */
export function statusByRegion(rows = []) {
  const groups = new Map()
  for (const r of rows) {
    const key = r.region || UNPLACED
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }
  return [...groups.entries()]
    .map(([region, list]) => ({ region, ...statusTotals(list) }))
    .sort((a, b) => b.total - a.total || a.region.localeCompare(b.region))
}

/**
 * Findings by sub-category, biggest first, coloured stably.
 *
 * `limit` folds the tail into "Other" for the pie, where twenty slices are a
 * colour wheel rather than a chart. The bar chart takes them all — it has a
 * vertical axis and can afford the rows.
 */
export function bySubCategory(rows = [], { limit = 0 } = {}) {
  const groups = new Map()
  for (const r of rows) {
    const key = r.subCategory || '(not stated)'
    groups.set(key, (groups.get(key) || 0) + (isNum(r.count) ? r.count : 1))
  }
  const all = [...groups.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))

  const shown = limit > 0 && all.length > limit ? all.slice(0, limit) : all
  const rest = limit > 0 && all.length > limit ? all.slice(limit) : []
  const out = shown.map((d, i) => ({ ...d, color: paletteColor(i) }))
  if (rest.length) {
    out.push({
      name: `Other (${rest.length} sub-categories)`,
      value: rest.reduce((n, d) => n + d.value, 0),
      color: '#94a3b8',
    })
  }
  return out
}

/**
 * One pin per site, with the mix of statuses on it.
 *
 * Returns the unplaceable ones too, as a count and a list of names. A map that
 * shows eleven of nineteen sites and says nothing is a map that will be read as
 * showing all nineteen.
 */
export function sitePins(rows = []) {
  const groups = new Map()
  for (const r of rows) {
    const key = r.matchedSiteId || r.site || UNPLACED
    if (!groups.has(key)) groups.set(key, { key, site: r.site || UNPLACED, region: r.region, entity: r.entity, rows: [] })
    groups.get(key).rows.push(r)
  }

  const pins = []
  const unplaced = []
  for (const g of groups.values()) {
    const withCoords = g.rows.find((r) => isNum(r.lat) && isNum(r.lng))
    const totals = statusTotals(g.rows)
    const entry = {
      id: g.key,
      site: g.site,
      region: g.region || '',
      entity: g.entity || '',
      total: totals.total,
      byStatus: totals,
    }
    if (withCoords) pins.push({ ...entry, lat: withCoords.lat, lng: withCoords.lng, placedFrom: withCoords.placedFrom })
    else unplaced.push(entry)
  }
  pins.sort((a, b) => b.total - a.total)
  unplaced.sort((a, b) => b.total - a.total)
  return { pins, unplaced }
}

/** The status a pin is coloured by: the worst one it actually has. */
export const leadStatus = (byStatus) =>
  STATUS_KEYS.find((k) => byStatus[k] > 0) || 'closed'

// ── Pass and fail ────────────────────────────────────────────────────────────
//
// A warehouse states an audit result one of two ways, and ODIN accepts both:
// a percentage, or a pair of counts (how many checks passed, how many failed).
// The counts are the better input, because they carry the SIZE of the audit,
// and size is what separates a weighted pass rate from an average of
// percentages — see the basis note in passRates.
//
// The helpers below are the seam. Everything downstream asks them for "the
// pass rate of this row" and never has to know which shape the question used.

const pct = (n) => Math.round(n * 10) / 10

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

/** Does this row carry a pass rate at all, in either shape? */
export const hasPassData = (row) => isNum(day0Of(row)) || isNum(n7Of(row))

/**
 * The headline pass and fail figures across a set of audits.
 *
 * Counts where counts exist, because "412 checks passed, 88 failed" is a
 * sentence a safety meeting can act on in a way "83.4%" is not. Audits that
 * gave only a percentage contribute to `pct` and to nothing else — they have no
 * checks to count — and `counted` says how many did, so a partial denominator
 * cannot be mistaken for the whole estate.
 */
export function passTotals(rows = []) {
  let passed = 0
  let failed = 0
  let counted = 0
  const pcts = []
  for (const r of rows || []) {
    if (!r) continue
    const total = checksTotalOf(r)
    if (total && isNum(r.checksPassed)) {
      passed += r.checksPassed
      failed += isNum(r.checksFailed) ? r.checksFailed : total - r.checksPassed
      counted += 1
    }
    const d0 = day0Of(r)
    if (isNum(d0)) pcts.push(d0)
  }
  const checks = passed + failed
  return {
    passed,
    failed,
    checks,
    counted,
    audits: (rows || []).filter(Boolean).length,
    // Weighted when there are checks to weight by; otherwise the mean of the
    // percentages, which is the only thing those rows can support.
    pct: checks > 0 ? pct((passed / checks) * 100)
      : pcts.length ? pct(pcts.reduce((n, v) => n + v, 0) / pcts.length) : null,
    basis: checks > 0 ? 'weighted' : 'mean',
  }
}

/**
 * Pass rate on the day of the audit and at N+7, grouped by region or by entity.
 *
 * Two ways of aggregating, and which one ran is REPORTED rather than assumed,
 * because they can disagree by a lot:
 *
 *   weighted  when every audit in the group carries check counts. Sum the
 *             checks, divide once. This is the true pass rate for the group.
 *   mean      otherwise. The arithmetic mean of the audits' own percentages,
 *             which treats a four-point audit and a four-hundred-point audit as
 *             equals — sometimes what is wanted, never what should be assumed.
 *
 * N+7 is weighted by the audit's size when that is known, because the re-check
 * covers the same audit and so carries the same weight; it falls back to the
 * mean the same way. An audit with no N+7 figure yet contributes to neither —
 * `n7Audits` says how many did, so a group where the re-checks have not
 * happened cannot masquerade as one that scored badly.
 */
export function passRates(auditRows = [], key = 'region') {
  const groups = new Map()
  for (const r of auditRows || []) {
    if (!r) continue
    const name = String(r[key] || '').trim() || UNPLACED
    if (!groups.has(name)) groups.set(name, [])
    groups.get(name).push(r)
  }

  return [...groups.entries()]
    .map(([name, list]) => {
      const scored = list.map((r) => ({ row: r, d0: day0Of(r), n7: n7Of(r), size: checksTotalOf(r) }))
      const day0Rows = scored.filter((s) => isNum(s.d0))
      const n7Rows = scored.filter((s) => isNum(s.n7))
      // Weighted only when EVERY audit that contributes a figure also carries a
      // size. A partial weighting counts the sizeless audits as weightless,
      // which is neither a mean nor a weighted average — it is a third number
      // with no name and no defensible meaning.
      const canWeight = day0Rows.length > 0 && day0Rows.every((s) => isNum(s.size))

      let day0 = null
      let n7 = null
      if (canWeight) {
        const total = day0Rows.reduce((n, s) => n + s.size, 0)
        day0 = total > 0 ? pct(day0Rows.reduce((n, s) => n + (s.d0 / 100) * s.size, 0) / total * 100) : null
        const n7Weighable = n7Rows.filter((s) => isNum(s.size))
        const n7Total = n7Weighable.reduce((n, s) => n + s.size, 0)
        n7 = n7Total > 0
          ? pct(n7Weighable.reduce((n, s) => n + s.n7 * s.size, 0) / n7Total)
          : null
      } else {
        day0 = day0Rows.length ? pct(day0Rows.reduce((n, s) => n + s.d0, 0) / day0Rows.length) : null
        n7 = n7Rows.length ? pct(n7Rows.reduce((n, s) => n + s.n7, 0) / n7Rows.length) : null
      }

      const totals = passTotals(list)
      return {
        name,
        day0,
        n7,
        // The change is the point of putting the two side by side: it is what
        // the seven days of remediation bought.
        delta: isNum(day0) && isNum(n7) ? pct(n7 - day0) : null,
        audits: list.length,
        n7Audits: n7Rows.length,
        // The raw counts behind the percentage, where the question gave them.
        // A tooltip reading "412 of 500 checks" is what makes a bar auditable.
        passed: totals.passed,
        failed: totals.failed,
        checks: totals.checks,
        basis: canWeight ? 'weighted' : 'mean',
      }
    })
    .sort((a, b) => (a.day0 ?? 101) - (b.day0 ?? 101) || a.name.localeCompare(b.name))
}

/**
 * Everything the ODIN tab draws, from one filtered population.
 *
 * One function so nothing on screen can disagree with anything else on screen —
 * the same contract every other analytics tab in this app holds to.
 */
export function odinAnalytics(rows = [], audits = [], sites = [], f = {}, { keepUnplaced = true } = {}) {
  const resolved = resolveOdinRows(rows, sites, { keepUnplaced })
  const filtered = filterOdinRows(resolved, f)
  const { pins, unplaced } = sitePins(filtered)

  // The audits question is filtered on the dimensions it shares with the
  // findings — region, entity, month. Status and sub-category are properties of
  // a finding, not of an audit, so applying them here would silently shrink the
  // pass-rate population every time somebody clicked a status.
  //
  // Site scoping DOES apply: an audit of a site this viewer cannot see is as
  // out of bounds as a finding at one.
  const auditsResolved = resolveOdinRows(audits, sites, { keepUnplaced })
  const auditsFiltered = filterOdinRows(auditsResolved, {
    region: f.region, entity: f.entity, source: f.source, from: f.from, to: f.to,
  })

  // ── Where the pass rates come from ────────────────────────────────────────
  //
  // The audits question when it carries them. Otherwise the FINDINGS question,
  // if its rows carry pass/fail columns — plenty of warehouses hold one table
  // per checklist line, with the pass or fail on the same row as the finding,
  // and requiring a second saved question to unlock a chart the data already
  // supports is a configuration tax with nothing behind it.
  //
  // The fallback is narrowed to the rows that actually carry a pass figure, not
  // applied to all of them: a findings table where only the failures are rows
  // would otherwise report a 0% pass rate with total confidence.
  //
  // Which source ran is returned, because the two answer subtly different
  // questions — one is per audit, the other per checklist line — and a reader
  // comparing this month with last has to know if the basis moved under them.
  const auditsHavePass = auditsFiltered.some(hasPassData)
  const findingsWithPass = filtered.filter(hasPassData)
  const passRows = auditsHavePass ? auditsFiltered : findingsWithPass
  const passSource = auditsHavePass ? 'audits' : findingsWithPass.length ? 'findings' : 'none'

  return {
    rows: filtered,
    totals: statusTotals(filtered),
    byRegion: statusByRegion(filtered),
    bySubCategoryAll: bySubCategory(filtered),
    bySubCategoryTop: bySubCategory(filtered, { limit: 8 }),
    pins,
    unplaced,
    passByRegion: passRates(passRows, 'region'),
    passByEntity: passRates(passRows, 'entity'),
    passOverall: passTotals(passRows),
    passSource,
    passRowCount: passRows.length,
    auditCount: auditsFiltered.length,
  }
}

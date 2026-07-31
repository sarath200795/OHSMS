// ─────────────────────────────────────────────────────────────────────────────
// Incident analytics — every number the Incidents tab shows.
//
// Pure on purpose. These figures get read as fact and quoted in reviews, and
// the segmentation is exactly where a mistake hides: an incident attributed to
// the wrong region moves a number in two places at once, and nothing on screen
// would look wrong.
//
// One rule throughout: an incident is counted once, against the site it
// resolves to. Where it carries no region or entity of its own, those are read
// off that site rather than guessed, so a site's rollup and a region's rollup
// can never disagree about the same record.
// ─────────────────────────────────────────────────────────────────────────────
import { HSE_CATEGORY_BY_KEY, INCIDENT_TYPE_BY_KEY, LIFECYCLE } from '../../modules/incidents/lib/constants'

const norm = (s) => String(s ?? '').trim().toLowerCase()

/** The month an incident belongs to, as YYYY-MM. '' when it has no usable date. */
export function monthOf(inc) {
  const raw = inc.incidentDate || ''
  return /^\d{4}-\d{2}/.test(raw) ? raw.slice(0, 7) : ''
}

/**
 * Attach each incident to a site, plus the region and entity that follow from
 * it. Historical incidents predate the site link and carry only free text, so
 * the name fallback is what keeps them from vanishing out of every breakdown.
 */
export function resolveIncidents(incidents = [], sites = [], { keepUnplaced = true } = {}) {
  const byId = new Map(sites.map((s) => [s.id, s]))
  return incidents
    .filter((i) => i && !i.deletedAt)
    .map((inc) => {
      let site = inc.siteId ? byId.get(inc.siteId) : null
      if (!site) {
        site = sites.find((s) => {
          const n = norm(s.name)
          return !!n && (norm(inc.location).includes(n) || norm(inc.site).includes(n))
        }) || null
      }
      return {
        inc,
        site,
        siteId: site?.id || '',
        siteName: site?.name || inc.site || 'Unassigned',
        region: inc.region || site?.region || 'Unassigned',
        entity: inc.entity || site?.entity || 'Unassigned',
        month: monthOf(inc),
      }
    })
    // An incident matching none of the visible sites is only truly unassigned
    // when the viewer can see every site; for anyone else it is most likely
    // another site's, and must not be counted for them at all.
    .filter((r) => keepUnplaced || r.siteId)
}

/**
 * Narrow to what the filters ask for. `siteId`, `region` and `entity` take the
 * literal 'all'; `from`/`to` are YYYY-MM and inclusive.
 *
 * Incidents with no usable date survive a month filter rather than being
 * dropped — an undated record is a data-quality problem to surface, not one to
 * hide by making it invisible whenever a range is set.
 */
export function filterIncidents(rows, { siteId = 'all', region = 'all', entity = 'all', from = '', to = '' } = {}) {
  return rows.filter((r) => {
    if (siteId !== 'all' && r.siteId !== siteId) return false
    if (region !== 'all' && r.region !== region) return false
    if (entity !== 'all' && r.entity !== entity) return false
    if (r.month) {
      if (from && r.month < from) return false
      if (to && r.month > to) return false
    }
    return true
  })
}

const countBy = (rows, key) => {
  const m = new Map()
  for (const r of rows) {
    const k = key(r)
    if (k === null || k === undefined || k === '') continue
    m.set(k, (m.get(k) || 0) + 1)
  }
  return m
}

const toSorted = (map, label = (k) => k, color = () => undefined) =>
  [...map.entries()]
    .map(([key, value]) => ({ key, name: label(key), value, color: color(key) }))
    .sort((a, b) => b.value - a.value)

/**
 * The five headline figures.
 *
 * Fire is deliberately not one of the four injury types — it is a category, so
 * a fire that caused a lost-time injury is counted in both. Presenting them as
 * five mutually exclusive buckets would be wrong, which is why the tab labels
 * fire separately rather than lining all five up as if they partition the set.
 */
export function headline(rows) {
  const ofType = (t) => rows.filter((r) => r.inc.type === t).length
  return {
    nearMiss: ofType('near_miss'),
    firstAid: ofType('first_aid'),
    lostTime: ofType('lost_time'),
    reportable: ofType('reportable'),
    fire: rows.filter((r) => r.inc.category === 'fire_explosion').length,
    total: rows.length,
  }
}

/** Month-by-month totals split by incident type, oldest first. */
export function byMonth(rows) {
  const months = [...new Set(rows.map((r) => r.month).filter(Boolean))].sort()
  return months.map((month) => {
    const inMonth = rows.filter((r) => r.month === month)
    const row = { month, label: prettyMonth(month), total: inMonth.length }
    for (const t of ['near_miss', 'first_aid', 'lost_time', 'reportable', 'property_damage']) {
      row[t] = inMonth.filter((r) => r.inc.type === t).length
    }
    return row
  })
}

function prettyMonth(m) {
  const [y, mo] = m.split('-')
  const d = new Date(Number(y), Number(mo) - 1, 1)
  return Number.isNaN(d.getTime()) ? m : d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
}

/** Everything the tab renders, for one filter selection. */
export function incidentAnalytics(incidents = [], sites = [], filters = {}, opts = {}) {
  const resolved = resolveIncidents(incidents, sites, opts)
  const rows = filterIncidents(resolved, filters)

  return {
    rows,
    headline: headline(rows),
    byStatus: toSorted(
      countBy(rows, (r) => r.inc.lifecycle || 'reporting'),
      (k) => LIFECYCLE.find((l) => l.key === k)?.label || k,
      (k) => LIFECYCLE.find((l) => l.key === k)?.color || '#8a7660',
    ),
    byType: toSorted(
      countBy(rows, (r) => r.inc.type),
      (k) => INCIDENT_TYPE_BY_KEY[k]?.label || k,
      (k) => INCIDENT_TYPE_BY_KEY[k]?.color || '#8a7660',
    ),
    byCategory: toSorted(
      countBy(rows, (r) => r.inc.category),
      (k) => HSE_CATEGORY_BY_KEY[k]?.label || k,
      (k) => HSE_CATEGORY_BY_KEY[k]?.color || '#8a7660',
    ),
    byRegion: toSorted(countBy(rows, (r) => r.region)),
    byEntity: toSorted(countBy(rows, (r) => r.entity)),
    bySite: toSorted(countBy(rows, (r) => r.siteName)),
    byMonth: byMonth(rows),
  }
}

/** Filter option lists, derived from what the viewer can actually see. */
export function facets(rows) {
  return {
    regions: [...new Set(rows.map((r) => r.region))].filter((v) => v !== 'Unassigned').sort(),
    entities: [...new Set(rows.map((r) => r.entity))].filter((v) => v !== 'Unassigned').sort(),
    months: [...new Set(rows.map((r) => r.month).filter(Boolean))].sort(),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregation for the Mock Drills, Emergency Equipment and HSE Committee tabs.
//
// All three answer the same shape of question — how many, of what kind, where,
// and in what state — over three collections that record it differently. The
// site resolution is shared so a drill, a defect and a meeting all attribute to
// a site the same way, and region and entity are always read off that resolved
// site rather than trusted from the record.
// ─────────────────────────────────────────────────────────────────────────────
import { linkAssets } from '../admin/siteStats'
import { DEFECT_BY_KEY, CATEGORIES } from '../../modules/fire/lib/constants'
import { deriveStatus } from '../../modules/fire/lib/extinguisherLogic'

const norm = (s) => String(s ?? '').trim().toLowerCase()

/** YYYY-MM from a YYYY-MM-DD field; '' when unusable. */
export const monthOf = (v) => (/^\d{4}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 7) : '')

export function prettyMonth(m) {
  const [y, mo] = String(m).split('-')
  const d = new Date(Number(y), Number(mo) - 1, 1)
  return Number.isNaN(d.getTime()) ? m : d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
}

/**
 * Attach a site (and its region/entity) to each record.
 *
 * Records carry a siteId when created recently and a free-text centre name
 * otherwise, so both are tried — without the name fallback every breakdown
 * reads zero for exactly the records that have been there longest.
 */
export function attachSites(rows = [], sites = [], { keepUnplaced = true } = {}) {
  const byId = new Map(sites.map((s) => [s.id, s]))
  return rows
    .filter((r) => r && !r.deletedAt)
    .map((r) => {
      let site = r.siteId ? byId.get(r.siteId) : null
      if (!site) {
        const n = norm(r.centerName || r.site || r.location)
        site = n ? sites.find((s) => norm(s.name) === n || n.includes(norm(s.name))) || null : null
      }
      return {
        row: r,
        siteId: site?.id || '',
        siteName: site?.name || r.centerName || 'Unassigned',
        region: site?.region || r.region || 'Unassigned',
        entity: site?.entity || r.entity || 'Unassigned',
        month: monthOf(r.date),
      }
    })
    // A record that matches none of the visible sites is only genuinely
    // "Unassigned" when the viewer can see every site. For anyone else it is
    // most likely someone else's site, and bucketing it as Unassigned would
    // show them a count they have no right to — so it is dropped instead.
    .filter((r) => keepUnplaced || r.siteId)
}

export function applyFilters(rows, { siteId = 'all', region = 'all', entity = 'all', from = '', to = '' } = {}) {
  return rows.filter((r) => {
    if (siteId !== 'all' && r.siteId !== siteId) return false
    if (region !== 'all' && r.region !== region) return false
    if (entity !== 'all' && r.entity !== entity) return false
    // Undated records survive a range rather than vanishing — a missing date is
    // a data-quality problem to surface, not one to hide.
    if (r.month) {
      if (from && r.month < from) return false
      if (to && r.month > to) return false
    }
    return true
  })
}

const tally = (rows, key) => {
  const m = new Map()
  for (const r of rows) {
    const k = key(r)
    if (k === '' || k === null || k === undefined) continue
    m.set(k, (m.get(k) || 0) + 1)
  }
  return [...m.entries()].map(([name, value]) => ({ key: name, name, value })).sort((a, b) => b.value - a.value)
}

export function facetsOf(rows) {
  return {
    regions: [...new Set(rows.map((r) => r.region))].filter((v) => v !== 'Unassigned').sort(),
    entities: [...new Set(rows.map((r) => r.entity))].filter((v) => v !== 'Unassigned').sort(),
    months: [...new Set(rows.map((r) => r.month).filter(Boolean))].sort(),
  }
}

const STATUSES = ['Open', 'In Progress', 'Closed']
const STATUS_COLOR = { Open: '#ef4444', 'In Progress': '#f59e0b', Closed: '#22c55e' }

/** Count a list of {status} rows into the three fixed states. */
function statusTally(items) {
  const c = { Open: 0, 'In Progress': 0, Closed: 0 }
  for (const a of items) {
    const s = STATUSES.includes(a?.status) ? a.status : 'Open'
    c[s] += 1
  }
  return STATUSES.map((s) => ({ key: s, name: s, value: c[s], color: STATUS_COLOR[s] }))
}

// ── Mock drills ───────────────────────────────────────────────────────────────

export function drillAnalytics(drills = [], sites = [], filters = {}, opts = {}) {
  const all = attachSites(drills, sites, opts)
  const rows = applyFilters(all, filters)
  const capa = rows.flatMap((r) => r.row.capa || [])

  return {
    rows,
    total: rows.length,
    // Real emergencies are recorded in the same collection and must not be
    // counted as drills — they are the thing drills exist to prepare for.
    drills: rows.filter((r) => r.row.eventType !== 'Real Emergency').length,
    emergencies: rows.filter((r) => r.row.eventType === 'Real Emergency').length,
    byScenario: tally(rows, (r) => r.row.scenario || 'Unspecified'),
    byOutcome: tally(rows, (r) => r.row.outcome || 'Unrecorded'),
    bySite: tally(rows, (r) => r.siteName),
    byRegion: tally(rows, (r) => r.region),
    byEntity: tally(rows, (r) => r.entity),
    observations: statusTally(capa),
    observationTotal: capa.length,
    // Observations per drill, busiest first — the drills that generated the
    // most follow-up are the ones worth reading.
    perDrill: rows
      .map((r) => ({
        key: r.row.id || r.row.docId,
        name: r.row.docId || r.row.scenario || 'Drill',
        site: r.siteName,
        value: (r.row.capa || []).length,
        open: (r.row.capa || []).filter((c) => (c.status || 'Open') !== 'Closed').length,
      }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value),
    byMonth: monthSeries(rows, (inMonth) => ({
      drills: inMonth.filter((r) => r.row.eventType !== 'Real Emergency').length,
      emergencies: inMonth.filter((r) => r.row.eventType === 'Real Emergency').length,
    })),
  }
}

// ── HSE committee ─────────────────────────────────────────────────────────────

export function committeeAnalytics(consultations = [], sites = [], filters = {}, opts = {}) {
  const all = attachSites(consultations, sites, opts)
  const rows = applyFilters(all, filters)
  const actions = rows.flatMap((r) => r.row.actions || [])

  return {
    rows,
    total: rows.length,
    actionTotal: actions.length,
    observations: statusTally(actions),
    bySite: tally(rows, (r) => r.siteName),
    byType: tally(rows, (r) => r.row.type || 'Meeting'),
    byMonth: monthSeries(rows, (inMonth) => {
      const acts = inMonth.flatMap((r) => r.row.actions || [])
      const c = statusTally(acts)
      return {
        meetings: inMonth.length,
        Open: c[0].value,
        'In Progress': c[1].value,
        Closed: c[2].value,
      }
    }),
  }
}

function monthSeries(rows, build) {
  const months = [...new Set(rows.map((r) => r.month).filter(Boolean))].sort()
  return months.map((month) => ({
    month,
    label: prettyMonth(month),
    ...build(rows.filter((r) => r.month === month)),
  }))
}

// ── Emergency equipment ───────────────────────────────────────────────────────

const AED_BAD = new Set(['out_of_service', 'service_due'])
const FAS_BAD = new Set(['faulty', 'service_due'])

/**
 * Fleet health and where the defects are.
 *
 * A defect here means anything that would stop the asset working when needed:
 * a logged physical defect on an extinguisher, or an AED or panel that is not
 * in its ready state. Counting only extinguisher defects would report a fleet
 * as healthy while its defibrillators were out of service.
 */
/**
 * Everything wrong with one extinguisher.
 *
 * A logged defect is only half of it. An extinguisher whose refill or hydraulic
 * test has come due is not fit for purpose either, and those are dates rather
 * than flags — nobody ticks a box to say a unit went out of test. deriveStatus
 * is the fire module's own reading of both, so the analytics and the Fire
 * dashboard cannot disagree about whether a unit is due.
 *
 * Due-in-30 is reported separately from overdue: one is a purchase order, the
 * other is an extinguisher that should not be on the wall.
 */
function extinguisherFindings(e, at, today) {
  const d = deriveStatus(e, today)
  const cat = (c) => ({ asset: e, kind: 'Extinguisher', siteId: at, type: c.label, color: c.color })
  const out = [...d.physicalDefects, ...d.refillDefects].map((k) => ({
    asset: e, kind: 'Extinguisher', siteId: at,
    type: DEFECT_BY_KEY[k]?.label || k, color: DEFECT_BY_KEY[k]?.color || '#dc2626',
  }))
  if (d.isClosed) return out
  if (d.flags.HPT_DUE) out.push(cat(CATEGORIES.HPT_DUE))
  else if (d.flags.HPT_DUE_30) out.push(cat(CATEGORIES.HPT_DUE_30))
  if (d.flags.REFILL_DUE) out.push(cat(CATEGORIES.REFILL_DUE))
  else if (d.flags.REFILL_DUE_30) out.push(cat(CATEGORIES.REFILL_DUE_30))
  return out
}

export function equipmentAnalytics({
  extinguishers = [], aeds = [], fas = [], sites = [], siteId = 'all', defectType = 'all',
  keepUnplaced = true, today = new Date(),
} = {}) {
  const links = linkAssets([...extinguishers, ...aeds, ...fas], sites)
  const visible = new Set(sites.map((s) => s.id))
  const siteOf = (r) => links.get(r) || r.siteId || ''
  const inScope = (r) => {
    if (r.deletedAt) return false
    const at = siteOf(r)
    if (siteId !== 'all') return at === siteId
    // Under "all sites", an asset that resolves to no visible site belongs to
    // somewhere the viewer cannot see — counting it would inflate their fleet
    // with equipment that is not theirs.
    return keepUnplaced || visible.has(at)
  }

  const ext = extinguishers.filter(inScope)
  const aed = aeds.filter(inScope)
  const fasRows = fas.filter(inScope)

  // One flat list of findings, each already attributed to a site.
  const findings = [
    ...ext.flatMap((e) => extinguisherFindings(e, siteOf(e), today)),
    ...aed.filter((a) => AED_BAD.has(a.status)).map((a) => ({
      asset: a, kind: 'AED', siteId: siteOf(a),
      type: a.status === 'out_of_service' ? 'AED out of service' : 'AED service due',
      color: a.status === 'out_of_service' ? '#dc2626' : '#f59e0b',
    })),
    ...fasRows.filter((f) => FAS_BAD.has(f.status)).map((f) => ({
      asset: f, kind: 'Fire alarm', siteId: siteOf(f),
      type: f.status === 'faulty' ? 'Panel faulty' : 'Panel service due',
      color: f.status === 'faulty' ? '#dc2626' : '#f59e0b',
    })),
  ]

  const filtered = defectType === 'all' ? findings : findings.filter((f) => f.type === defectType)

  const total = ext.length + aed.length + fasRows.length
  // An asset can carry more than one finding — a damaged unit that is also
  // overdue for test — so health counts assets, not findings. Otherwise one
  // badly-off extinguisher would look worse than a whole site out of service.
  const faulty = new Set(findings.map((f) => f.asset)).size

  const byId = new Map(sites.map((s) => [s.id, s]))
  const group = (key) => {
    const m = new Map()
    for (const f of filtered) {
      const s = byId.get(f.siteId)
      const k = key(s) || 'Unassigned'
      m.set(k, (m.get(k) || 0) + 1)
    }
    return [...m.entries()].map(([name, value]) => ({ key: name, name, value })).sort((a, b) => b.value - a.value)
  }

  return {
    total,
    faulty,
    healthy: total - faulty,
    healthPct: total ? Math.round(((total - faulty) / total) * 100) : null,
    defectTypes: [...new Set(findings.map((f) => f.type))].sort(),
    byType: (() => {
      const m = new Map()
      for (const f of filtered) m.set(f.type, (m.get(f.type) || 0) + 1)
      return [...m.entries()]
        .map(([name, value]) => ({ key: name, name, value, color: filtered.find((f) => f.type === name)?.color }))
        .sort((a, b) => b.value - a.value)
    })(),
    bySite: group((s) => s?.name),
    byRegion: group((s) => s?.region),
    byEntity: group((s) => s?.entity),
    // Only mapped sites can carry a pin; the rest are reported in the lists.
    pins: sites
      .filter((s) => typeof s.lat === 'number' && typeof s.lng === 'number')
      .map((s) => ({
        id: s.id, name: s.name, lat: s.lat, lng: s.lng,
        region: s.region || '', entity: s.entity || '',
        defects: filtered.filter((f) => f.siteId === s.id).length,
      }))
      .filter((p) => p.defects > 0),
  }
}

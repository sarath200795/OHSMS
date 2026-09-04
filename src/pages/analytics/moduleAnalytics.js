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
import { DEFECT_BY_KEY, CATEGORIES, FIRST_AID_ITEM_NAMES } from '../../modules/fire/lib/constants'
import { deriveStatus } from '../../modules/fire/lib/extinguisherLogic'
import { dueState } from '../../modules/fire/lib/assetLogic'
import { firstAidCell, isExpiringSoon, ISSUE_CONDITIONS } from '../../modules/fire/lib/firstAidLogic'

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

/**
 * What is wrong with one stretcher, or null.
 *
 * Reads the inspection date as well as the status, the way the extinguisher
 * rule above does and unlike the AED and panel rules below it, because that
 * date is the ONLY one on a stretcher record: a unit whose inspection lapsed
 * two years ago still carries status 'ready' until somebody opens the record
 * and changes it, and a status-only reading would call it healthy forever.
 */
function stretcherFinding(s, at) {
  const insp = dueState(s.nextInspection)
  if (s.status === 'out_of_service') return { kind: 'Stretcher', siteId: at, type: 'Stretcher out of service', color: '#dc2626' }
  if (insp === 'expired') return { kind: 'Stretcher', siteId: at, type: 'Stretcher inspection overdue', color: '#dc2626' }
  if (s.status === 'service_due' || insp === 'due') return { kind: 'Stretcher', siteId: at, type: 'Stretcher service due', color: '#f59e0b' }
  return null
}

/**
 * First aid is not a fleet of assets, so its unit here is a (site, item) pair —
 * the same unit the First Aid register and its dashboard score.
 *
 * Grouping matters rather than being tidy: the required quantity is asked of
 * the SITE, and a site may spread it over several boxes. Scoring record by
 * record would report a site holding half the requirement in each of two boxes
 * as two separate shortages, and its health as 0 % when it is fully stocked.
 */
function firstAidCells(rows, siteOf) {
  const groups = new Map()
  for (const r of rows) {
    const at = siteOf(r)
    const key = `${at}::${r.item}`
    if (!groups.has(key)) groups.set(key, { siteId: at, item: r.item, recs: [] })
    groups.get(key).recs.push(r)
  }
  return [...groups.values()]
}

/**
 * What is wrong with one (site, item) pair, or null.
 *
 * One finding per pair, worst first, so health counts pairs rather than
 * reasons — an item that is both short AND expiring is one gap, not two.
 */
function firstAidFinding(cell, today) {
  const c = firstAidCell(cell.recs, cell.item, today)
  if (c.status === 'ok') return null
  const at = { kind: 'First aid', siteId: cell.siteId }
  // Expired stock leads even when the cell is merely an issue: a box holding
  // enough in-date antiseptic beside an out-of-date bottle is a box somebody
  // will reach into in a hurry.
  if (c.expired > 0) return { ...at, type: 'First aid item expired', color: '#dc2626' }
  if (c.status === 'missing') return { ...at, type: 'First aid item missing', color: '#b91c1c' }
  if (c.qty < c.required) return { ...at, type: 'First aid item short', color: '#f59e0b' }
  if (cell.recs.some((r) => ISSUE_CONDITIONS.includes(r.condition))) return { ...at, type: 'First aid item damaged', color: '#ea580c' }
  if (cell.recs.some((r) => isExpiringSoon(r, today))) return { ...at, type: 'First aid item expiring soon', color: '#b45309' }
  // Every non-ok status is named above; anything reaching here would be a new
  // status firstAidCell learned to return, and silently dropping it would take
  // the gap off this page without taking it off the register.
  return { ...at, type: 'First aid item unavailable', color: '#dc2626' }
}

export const ASSET_KINDS = ['Extinguisher', 'AED', 'Fire alarm', 'Stretcher', 'First aid']

export function equipmentAnalytics({
  extinguishers = [], aeds = [], fas = [], stretchers = [], firstAid = [], sites = [],
  siteId = 'all', defectType = 'all', kind = 'all', keepUnplaced = true, today = new Date(),
} = {}) {
  const links = linkAssets([...extinguishers, ...aeds, ...fas, ...stretchers, ...firstAid], sites)
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
  const stretcherRows = stretchers.filter(inScope)
  const aidCells = firstAidCells(firstAid.filter(inScope), siteOf)

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
    ...stretcherRows.map((s) => {
      const f = stretcherFinding(s, siteOf(s))
      return f && { asset: s, ...f }
    }).filter(Boolean),
    // The "asset" of a first aid finding is the (site, item) pair itself, which
    // is what the health figure below counts. Each pair is a distinct object,
    // so the faulty-asset Set de-duplicates them exactly as it does for a
    // twice-flagged extinguisher.
    ...aidCells.map((c) => {
      const f = firstAidFinding(c, today)
      return f && { asset: c, ...f }
    }).filter(Boolean),
  ]

  const filtered = findings
    .filter((f) => defectType === 'all' || f.type === defectType)
    .filter((f) => kind === 'all' || f.kind === kind)

  const pool = { Extinguisher: ext, AED: aed, 'Fire alarm': fasRows, Stretcher: stretcherRows, 'First aid': aidCells }
  const inKind = (k) => kind === 'all' || k === kind

  const total = ASSET_KINDS.filter(inKind).reduce((n, k) => n + pool[k].length, 0)
  // An asset can carry more than one finding — a damaged unit that is also
  // overdue for test — so health counts assets, not findings. Otherwise one
  // badly-off extinguisher would look worse than a whole site out of service.
  const faultySet = new Set(findings.filter((f) => inKind(f.kind)).map((f) => f.asset))
  const faulty = faultySet.size

  // The three kinds fail for unrelated reasons and are maintained by different
  // people, so a single fleet figure hides the answer everyone actually wants:
  // which of the three is the problem.
  const fleetByKind = ASSET_KINDS.map((k) => {
    const assets = pool[k]
    const bad = new Set(findings.filter((f) => f.kind === k).map((f) => f.asset)).size
    return {
      key: k,
      name: k,
      total: assets.length,
      faulty: bad,
      healthy: assets.length - bad,
      healthPct: assets.length ? Math.round(((assets.length - bad) / assets.length) * 100) : null,
    }
  })

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

  // (site, item) pairs nobody has recorded at all.
  //
  // This page can only score what exists, so first aid health above is health
  // OF THE ITEMS SOMEBODY CHECKED — a figure that RISES as coverage falls, and
  // reads 100 % at a site where one bandage was logged and nothing else. That
  // is the opposite of what it looks like, so the number that corrects it is
  // returned alongside rather than left for the reader to infer. The First Aid
  // dashboard scores every pair and is the honest denominator.
  const scopedSites = siteId === 'all' ? sites : sites.filter((s) => s.id === siteId)
  const firstAidUnrecorded = Math.max(0, scopedSites.length * FIRST_AID_ITEM_NAMES.length - aidCells.length)

  return {
    total,
    faulty,
    healthy: total - faulty,
    firstAidUnrecorded,
    healthPct: total ? Math.round(((total - faulty) / total) * 100) : null,
    fleetByKind,
    // Defect types are offered for whichever kind is being looked at, so the
    // filter never lists an option that would return nothing.
    defectTypes: [...new Set(findings.filter((f) => inKind(f.kind)).map((f) => f.type))].sort(),
    byKind: ASSET_KINDS
      .map((k) => ({ key: k, name: k, value: filtered.filter((f) => f.kind === k).length }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value),
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

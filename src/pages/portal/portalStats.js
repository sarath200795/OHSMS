// ─────────────────────────────────────────────────────────────────────────────
// Portal home aggregates.
//
// Every number on the home screen is scoped to the sites the viewer may see —
// which is the whole reason this is a separate, pure module. Scoping is the
// part that can be silently wrong: a count that quietly includes a site the
// person has no permission for is a data leak, and one that quietly excludes a
// site they own is a wrong answer they will act on.
//
// Assets resolve to a site through the same linkAssets used by the admin site
// rollup, so equipment counted here and equipment counted there cannot diverge.
// ─────────────────────────────────────────────────────────────────────────────
import { linkAssets } from '../admin/siteStats'

const norm = (s) => String(s ?? '').trim().toLowerCase()

/** Compliant signage conditions. Everything else is a finding. */
const SIGNAGE_OK = new Set(['ok'])

/**
 * Which asset site-ids are in scope.
 * `siteId` of 'all' means every site the viewer can see.
 */
export function scopeIds(sites = [], siteId = 'all') {
  return new Set(
    siteId === 'all' ? sites.map((s) => s.id) : sites.filter((s) => s.id === siteId).map((s) => s.id)
  )
}

const inScope = (rec, links, ids) => {
  const linked = links.get(rec) || rec.siteId
  return !!linked && ids.has(linked)
}

/**
 * Incidents carry a siteId when raised from the portal, and free-text location
 * or site otherwise. The name fallback exists because most historical incidents
 * predate the site link entirely — without it a site's incident count reads
 * zero however many it actually had.
 */
function incidentInScope(inc, sites, ids) {
  if (inc.siteId) return ids.has(inc.siteId)
  const scoped = sites.filter((s) => ids.has(s.id))
  return scoped.some((s) => {
    const n = norm(s.name)
    return !!n && (norm(inc.location).includes(n) || norm(inc.site).includes(n))
  })
}

const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : null)

/**
 * Everything the home screen shows, for one scope.
 *
 * Compliance percentages return null rather than 0 when there is nothing to
 * measure — "no signage recorded" and "all signage failing" are opposite
 * situations and must not render as the same number.
 */
export function portalStats({
  sites = [], siteId = 'all',
  extinguishers = [], aeds = [], fas = [], signages = [], incidents = [],
  assignments = [], users = [],
} = {}) {
  const ids = scopeIds(sites, siteId)
  const links = linkAssets([...extinguishers, ...aeds, ...fas, ...signages], sites)

  const alive = (r) => !r.deletedAt
  const mine = (list) => list.filter((r) => alive(r) && inScope(r, links, ids))

  const ext = mine(extinguishers)
  const aed = mine(aeds)
  const fasRows = mine(fas)
  const sig = mine(signages)
  const inc = incidents.filter((i) => alive(i) && incidentInScope(i, sites, ids))

  // Training is per person, not per asset, so it scopes through the employee's
  // own site rather than through linkAssets.
  const scopedUids = new Set(
    users.filter((u) => u.siteId && ids.has(u.siteId)).map((u) => u.uid).filter(Boolean)
  )
  // With nobody mapped to a site, scoping by person would report 0% for an org
  // that simply has not filled in siteId yet — so fall back to counting
  // everyone. That fallback is only safe when the viewer can see some site: for
  // someone with no sites at all it would answer a question about the whole org
  // to a person entitled to none of it.
  const relevant = scopedUids.size
    ? assignments.filter((a) => scopedUids.has(a.employeeUid))
    : ids.size ? assignments : []
  const live = relevant.filter((a) => a.status !== 'cancelled')
  const completed = live.filter((a) => a.status === 'completed')

  const signageOk = sig.filter((s) => SIGNAGE_OK.has(norm(s.condition)))

  return {
    counts: {
      extinguishers: ext.length,
      aeds: aed.length,
      fas: fasRows.length,
      incidents: inc.length,
    },
    trainingCompliance: pct(completed.length, live.length),
    trainingTotal: live.length,
    signageCompliance: pct(signageOk.length, sig.length),
    signageTotal: sig.length,
    incidentsByType: countBy(inc, (i) => i.type || 'unspecified'),
    equipmentBySite: equipmentBySite(sites, ids, links, { ext, aed, fas: fasRows }),
  }
}

function countBy(rows, key) {
  const m = new Map()
  for (const r of rows) m.set(key(r), (m.get(key(r)) || 0) + 1)
  return [...m.entries()].map(([k, value]) => ({ key: k, value })).sort((a, b) => b.value - a.value)
}

/**
 * Equipment per site, busiest first.
 *
 * Sites with no equipment at all are dropped: a bar chart whose bars are mostly
 * zero-height rows tells the reader nothing except that the list is long.
 */
function equipmentBySite(sites, ids, links, { ext, aed, fas }) {
  const rows = sites
    .filter((s) => ids.has(s.id))
    .map((s) => {
      const count = (list) => list.filter((r) => (links.get(r) || r.siteId) === s.id).length
      const e = count(ext)
      const a = count(aed)
      const f = count(fas)
      return { id: s.id, name: s.name, extinguishers: e, aeds: a, fas: f, total: e + a + f }
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)
  return rows
}

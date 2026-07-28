// Roll up cross-module records for a site. Because the source modules weren't
// built around a shared site registry, matching is best-effort:
//   • Equipment (extinguishers / AEDs) — matched by region + entity (the
//     fire-marshal model), falling back to the site name in sitesCovered/site.
//   • Incidents — matched by the site name appearing in the free-text location.
//   • Employees — users explicitly mapped to the site (user.siteId).
const norm = (s) => (s == null ? '' : String(s)).trim().toLowerCase()

function matchEquip(rec, site) {
  const r = norm(site.region)
  const e = norm(site.entity)
  if (r && e) return norm(rec.region) === r && norm(rec.entity) === e
  const n = norm(site.name)
  if (!n) return false
  const covered = rec.sitesCovered
  if (Array.isArray(covered)) return covered.some((c) => norm(c).includes(n))
  return norm(covered).includes(n) || norm(rec.site).includes(n) || norm(rec.location).includes(n)
}

function matchIncident(inc, site) {
  if (inc.siteId && inc.siteId === site.id) return true // precise link (new incidents)
  const n = norm(site.name)
  if (!n) return false
  return norm(inc.location).includes(n) || norm(inc.site).includes(n)
}

const alive = (r) => !r.deletedAt

export function siteStats(site, { extinguishers = [], aeds = [], incidents = [], users = [] }) {
  const inc = incidents.filter((i) => alive(i) && matchIncident(i, site))
  return {
    extinguishers: extinguishers.filter((x) => alive(x) && matchEquip(x, site)).length,
    aeds: aeds.filter((x) => alive(x) && matchEquip(x, site)).length,
    firstAidBoxes: Number(site.firstAidBoxes) || 0,
    incidentsTotal: inc.length,
    byType: {
      fire: inc.filter((i) => i.category === 'fire_explosion' || i.type === 'fire').length,
      property: inc.filter((i) => i.type === 'property_damage').length,
      nearMiss: inc.filter((i) => i.type === 'near_miss').length,
      firstAid: inc.filter((i) => i.type === 'first_aid').length,
    },
    openActions: inc.reduce(
      (sum, i) =>
        sum +
        (i.capa || []).filter((a) => a.status && a.status !== 'closed' && a.status !== 'completed')
          .length,
      0
    ),
    employees: users.filter((u) => {
      if (u.siteId === site.id) return true
      const a = u.access || {}
      return (
        (a.sites || []).includes(site.id) ||
        (a.regions || []).includes(site.region) ||
        (a.entities || []).includes(site.entity)
      )
    }),
  }
}

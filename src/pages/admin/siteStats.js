// Roll up cross-module records for a site. Because the source modules weren't
// built around a shared site registry, matching is best-effort:
//   • Equipment (extinguishers / AEDs) — an explicit siteId if the asset has
//     one, otherwise its center name resolved through the same normalisation
//     and override table the linking pass uses.
//   • Incidents — matched by the site name appearing in the free-text location.
//   • Employees — users explicitly mapped to the site (user.siteId).
import { indexSites, resolveSite } from '../../modules/fire/lib/siteLink'

const norm = (s) => (s == null ? '' : String(s)).trim().toLowerCase()

/**
 * Resolve every asset to a site id, once for the whole registry.
 *
 * This exists because only extinguishers were ever put through the linking
 * pass, so only they carry a siteId. AEDs still hold the free-text center name
 * they arrived with, and comparing that to the site name directly fails on
 * exactly the differences siteLink was written to absorb — the missing "Gym",
 * the locality suffixes, the source-data typos. Deployed AEDs were therefore
 * counted as zero against sites that plainly had them.
 *
 * Resolving here rather than per site matters: the stats are recomputed for
 * every site against every asset, so doing this inside the match would rebuild
 * the name index tens of thousands of times per render.
 */
export function linkAssets(assets, sites) {
  const links = new Map()
  if (!sites?.length) return links
  const idx = indexSites(sites)
  for (const a of assets) {
    if (!a || a.deletedAt) continue
    if (a.siteId) { links.set(a, a.siteId); continue }
    const hit = resolveSite(a.centerName, sites, idx)
    if (hit) links.set(a, hit.site.id)
  }
  return links
}

function matchEquip(rec, site, links) {
  // An explicit link wins outright — either stored on the asset by the linking
  // pass, or resolved from its center name above. Both are immune to the two
  // sides being worded differently.
  const linked = links?.get(rec) || rec.siteId
  if (linked) return linked === site.id

  // Otherwise fall back to the site's name appearing on the record. Region +
  // entity used to be tried first, but it attributes every asset in a region to
  // every site in it: with 161 sites in one region the counts were simply wrong.
  const n = norm(site.name)
  if (!n) return false
  if (norm(rec.centerName) === n) return true
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

export function siteStats(site, { extinguishers = [], aeds = [], fas = [], incidents = [], users = [], links }) {
  const inc = incidents.filter((i) => alive(i) && matchIncident(i, site))
  return {
    extinguishers: extinguishers.filter((x) => alive(x) && matchEquip(x, site, links)).length,
    aeds: aeds.filter((x) => alive(x) && matchEquip(x, site, links)).length,
    fas: fas.filter((x) => alive(x) && matchEquip(x, site, links)).length,
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

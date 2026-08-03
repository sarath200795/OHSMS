// ─────────────────────────────────────────────────────────────────────────────
// Defects rolled up per site, for export.
//
// The per-unit export answers "which extinguisher is faulty". The question a
// site manager actually opens the file to answer is "which of my sites needs a
// visit, and what am I bringing" — so this counts the defects at each site,
// names the types, and carries the address, entity, region and a map link so
// the row is enough to act on without opening the app.
//
// Address and coordinates live on the site registry, not on the equipment, so
// the rows are joined back to it. Sites are matched by name because that is the
// only key the defect rows carry, and matched leniently for the same reason
// bulk upload does: "Cult Gym Ameerpet" and "Cult Ameerpet" are one place.
// ─────────────────────────────────────────────────────────────────────────────
import { indexSites, resolveSite } from './siteLink'

/** Google Maps at a pin, which is what "link to location" has to mean to be useful. */
export function mapsLink(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return ''
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
}

/**
 * One row per site that has at least one defect.
 *
 * Sites with no defects are left out: this is a defect report, and a file where
 * most rows say zero buries the ones that do not.
 *
 * @param defectRows rows from the defect log — each carries centerName, entity,
 *                   region and defectLabel
 * @param sites      the site registry, for address and coordinates
 */
export function summariseDefectsBySite(defectRows = [], sites = []) {
  const idx = indexSites(sites)

  const groups = new Map()
  for (const row of defectRows) {
    const name = (row.centerName || '').trim() || 'Unassigned'
    // Two units whose site is spelled differently must not become two rows, so
    // the registry match is the grouping key wherever there is one.
    const site = resolveSite(name, sites, idx)?.site || null
    const key = site ? `id:${site.id}` : `name:${name.toLowerCase()}`
    let g = groups.get(key)
    if (!g) {
      // Prefer the registry's spelling, which is the one the org agreed on.
      g = { name: site?.name || name, site, entity: row.entity || '', region: row.region || '', count: 0, types: new Map() }
      groups.set(key, g)
    }
    g.count += 1
    // Entity and region come from the equipment, which can disagree between two
    // units at one site. First non-empty wins rather than blanking the column.
    if (!g.entity && row.entity) g.entity = row.entity
    if (!g.region && row.region) g.region = row.region
    const label = row.defectLabel || row.defectType || 'Unspecified'
    g.types.set(label, (g.types.get(label) || 0) + 1)
  }

  const rows = []
  for (const g of groups.values()) {
    const site = g.site
    rows.push({
      Site: g.name,
      'No. of Defects': g.count,
      'Type of Defects': [...g.types.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([label, n]) => (n > 1 ? `${label} (${n})` : label))
        .join(', '),
      Address: site?.address || '',
      Entity: g.entity || site?.entity || '',
      Region: g.region || site?.region || '',
      'Location Link': mapsLink(site?.lat, site?.lng),
    })
  }

  // Worst first — the file is a work list, not an index.
  rows.sort((a, b) => b['No. of Defects'] - a['No. of Defects'] || a.Site.localeCompare(b.Site))
  return rows
}

// ─────────────────────────────────────────────────────────────────────────────
// Filling in an asset's site details from the registry.
//
// Assets carry `centerName`, `region` and `entity` denormalised onto them, so a
// list can render without a join. That works once linkExtinguishersToSites has
// run — but a unit added by import, or by seed, or before its site existed,
// carries only a `siteId`. Its row then shows a blank Entity, a blank Center
// and a dash for Region, which reads as "this data was never captured" when in
// fact the site is known and one lookup away.
//
// So resolve at display time, and never write: the denormalised fields stay
// whatever they are, the backfill action keeps its job, and the screen stops
// lying about what is on record.
//
// Pure — the fallback rules are exactly the kind of thing that gets quietly
// inverted later.
// ─────────────────────────────────────────────────────────────────────────────

const clean = (v) => String(v ?? '').trim()

/** siteId → site, for resolving an asset's registry details. */
export function siteIndex(sites = []) {
  return new Map(sites.filter((s) => clean(s?.id)).map((s) => [clean(s.id), s]))
}

/**
 * An asset with its site details filled in where they are missing.
 *
 * The asset's OWN value always wins. A unit deliberately labelled with a center
 * name that differs from its site record is describing something real — a wing,
 * a floor, a leased corner — and overwriting that with the site name would lose
 * it. Only blanks are filled.
 */
export function withSite(asset, index = new Map()) {
  if (!asset) return asset
  const site = index.get(clean(asset.siteId))
  if (!site) return asset

  const centerName = clean(asset.centerName) || clean(site.name)
  const region = clean(asset.region) || clean(site.region)
  const entity = clean(asset.entity) || clean(site.entity)

  // Return the same object when nothing changed, so React sees a stable
  // reference and a list of thousands does not re-render on every pass.
  if (centerName === clean(asset.centerName) && region === clean(asset.region) && entity === clean(asset.entity)) {
    return asset
  }
  return { ...asset, centerName, region, entity }
}

/** The same over a list, preserving order. */
export function withSites(assets = [], sites = []) {
  const index = siteIndex(sites)
  if (index.size === 0) return assets
  return assets.map((a) => withSite(a, index))
}

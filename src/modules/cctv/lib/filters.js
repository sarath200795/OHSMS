// ─────────────────────────────────────────────────────────────────────────────
// Scoping the inventory by site, entity and region.
//
// Devices only ever store a siteId. Entity and region live on the site record,
// so filtering by either means resolving device → site → attribute, and the
// device is not the place to duplicate them: a site moved from one entity to
// another would leave every camera under it claiming the old one forever.
//
// The other thing this has to get right is WHICH site id to use. A camera can
// inherit its site from the DVR it records to, so the id on the document is not
// always the answer — the resolved one from the health pass is. The caller
// supplies it, and everything here works on ids alone.
//
// Pure, so the "does this device match?" rule can be tested without a page.
// ─────────────────────────────────────────────────────────────────────────────

const clean = (v) => String(v ?? '').trim()

/** siteId → { id, name, entity, region }, for resolving a device's attributes. */
export function siteMeta(sites = []) {
  return new Map(
    sites.filter((s) => clean(s?.id)).map((s) => [
      clean(s.id),
      { id: clean(s.id), name: clean(s.name), entity: clean(s.entity), region: clean(s.region) },
    ])
  )
}

export const EMPTY_SCOPE = { siteId: '', entity: '', region: '' }

export const isScoped = (scope = {}) =>
  Boolean(clean(scope.siteId) || clean(scope.entity) || clean(scope.region))

/**
 * Does a device at `siteId` fall inside the chosen scope?
 *
 * A device whose site is unknown — blank, or an id no longer in the registry —
 * matches only when nothing is selected. It cannot be shown to belong to a
 * region, and quietly including it would make a filtered count wrong in the
 * direction nobody checks. It stays visible unfiltered, where it is a data
 * problem someone can see and fix.
 */
export function matchesScope(siteId, scope = {}, meta = new Map()) {
  const wantSite = clean(scope.siteId)
  const wantEntity = clean(scope.entity)
  const wantRegion = clean(scope.region)
  if (!wantSite && !wantEntity && !wantRegion) return true

  const site = meta.get(clean(siteId))
  if (!site) return false

  if (wantSite && site.id !== wantSite) return false
  if (wantEntity && site.entity !== wantEntity) return false
  if (wantRegion && site.region !== wantRegion) return false
  return true
}

/**
 * Filter rows by scope.
 *
 * `siteIdOf` exists because the id to test is not always `row.siteId` — for a
 * camera it is the one the health pass resolved, which may have come from its
 * DVR.
 */
export function filterByScope(rows = [], scope = {}, meta = new Map(), siteIdOf = (r) => r?.siteId) {
  if (!isScoped(scope)) return rows
  return rows.filter((r) => matchesScope(siteIdOf(r), scope, meta))
}

/**
 * The sites worth offering once an entity or region is chosen.
 *
 * Leaving every site in the list would let someone pick a combination that can
 * only ever return nothing — "entity COCO, site North Plant" when North Plant
 * belongs to FOFO — and then wonder where their cameras went.
 */
export function narrowSites(sites = [], scope = {}) {
  const entity = clean(scope.entity)
  const region = clean(scope.region)
  return sites.filter(
    (s) => (!entity || clean(s.entity) === entity) && (!region || clean(s.region) === region)
  )
}

/**
 * Correct a scope that its own selections have invalidated.
 *
 * Picking a region after a site can leave the site outside it. Rather than
 * showing an empty table, drop the site and keep the broader choice — the one
 * just made is the one meant.
 */
export function reconcileScope(scope = {}, sites = []) {
  const siteId = clean(scope.siteId)
  if (!siteId) return scope
  const stillValid = narrowSites(sites, scope).some((s) => clean(s.id) === siteId)
  return stillValid ? scope : { ...scope, siteId: '' }
}

/** Facets present in a site list, for the dropdowns. */
export function scopeFacets(sites = []) {
  return {
    entities: [...new Set(sites.map((s) => clean(s?.entity)).filter(Boolean))].sort(),
    regions: [...new Set(sites.map((s) => clean(s?.region)).filter(Boolean))].sort(),
  }
}

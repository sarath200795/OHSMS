// ─────────────────────────────────────────────────────────────────────────────
// Site-scoped access model. A user's granted access is a union of:
//   • specific sites        (access.sites: siteId[])
//   • whole regions         (access.regions: string[])  → every site in the region
//   • whole entities        (access.entities: string[]) → every site in the entity
// Admins implicitly access every site. Requests are stored on the profile as
// `accessRequest` and applied by an admin (see orgData.grantAccessRequest).
// ─────────────────────────────────────────────────────────────────────────────

export const DEPARTMENTS = ['Safety', 'Facility', 'Operation', 'Projects']

/**
 * Org-configured department list (Org Settings → General), falling back to the
 * built-in defaults. Use this everywhere a department dropdown is shown so
 * admin-added departments populate across all modules.
 */
export function orgDepartments(org) {
  const list = Array.isArray(org?.departments) ? org.departments.filter(Boolean) : []
  return list.length ? list : DEPARTMENTS
}

const arr = (v) => (Array.isArray(v) ? v : [])

/** Distinct regions / entities present in the site inventory (for dropdowns). */
export const regionsOf = (sites) =>
  [...new Set(arr(sites).map((s) => s.region).filter(Boolean))].sort()
export const entitiesOf = (sites) =>
  [...new Set(arr(sites).map((s) => s.entity).filter(Boolean))].sort()

/**
 * The concrete list of sites a user can access.
 *
 * Their own posting counts. `siteId` is where the employee actually works — set
 * when an admin provisions them — and until now it granted nothing, so someone
 * mapped to a site still resolved to zero and saw an empty portal: no counts,
 * no pending work, nothing about the place they stand in every day. An explicit
 * access grant remains the way to reach *other* sites; this only stops a person
 * being locked out of their own.
 */
export function resolveAccessibleSites(user, sites, { isAdmin } = {}) {
  const list = arr(sites)
  if (isAdmin || user?.role === 'admin') return list
  const a = user?.access || {}
  const s = new Set(arr(a.sites))
  if (user?.siteId) s.add(user.siteId)
  const r = new Set(arr(a.regions))
  const e = new Set(arr(a.entities))
  return list.filter((site) => s.has(site.id) || r.has(site.region) || e.has(site.entity))
}

export const hasAccessGrant = (user) => {
  const a = user?.access || {}
  return arr(a.sites).length + arr(a.regions).length + arr(a.entities).length > 0
}

export const hasPendingAccessRequest = (user) => {
  const r = user?.accessRequest
  return !!r && (arr(r.sites).length + arr(r.regions).length + arr(r.entities).length > 0)
}

/** Short human summary of a granted (or requested) scope. */
export function accessSummary(scope, sites = []) {
  if (!scope) return 'No access'
  const s = arr(scope.sites)
  const r = arr(scope.regions)
  const e = arr(scope.entities)
  if (s.length + r.length + e.length === 0) return 'No access'
  const nameOf = (id) => sites.find((x) => x.id === id)?.name || id
  const parts = []
  if (e.length) parts.push(`${e.length} ${e.length === 1 ? 'entity' : 'entities'}`)
  if (r.length) parts.push(`${r.length} region${r.length === 1 ? '' : 's'}`)
  if (s.length) parts.push(`${s.length} site${s.length === 1 ? '' : 's'}${s.length <= 2 ? ` (${s.map(nameOf).join(', ')})` : ''}`)
  return parts.join(' · ')
}

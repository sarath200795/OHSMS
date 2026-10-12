// ─────────────────────────────────────────────────────────────────────────────
// "Which of my sites is near me?" — for a user who could not name the site.
//
// Distances are great-circle (haversine) from the shared point to each site's
// registry lat/lng. Only sites the user already reaches are passed in; a site
// without coordinates is skipped, not guessed at.
//
// Up to five within 25 km. If none is that close, the nearest three anyway:
// "nothing nearby" is a dead end, and someone travelling between sites still
// wants the closest one.
// ─────────────────────────────────────────────────────────────────────────────

export const NEAR_RADIUS_KM = 25
export const NEAR_MAX = 5
export const NEAR_FALLBACK = 3
const EARTH_KM = 6371.0088

const rad = (d) => (d * Math.PI) / 180

/** Great-circle distance in km. */
export function haversineKm(lat1, lng1, lat2, lng2) {
  const dLat = rad(lat2 - lat1)
  const dLng = rad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** A site's coordinates, or null when it has none usable. */
export function siteCoords(site) {
  const lat = Number(site?.lat)
  const lng = Number(site?.lng)
  if (site?.lat == null || site?.lng == null || site.lat === '' || site.lng === '') return null
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
    return null
  if (lat === 0 && lng === 0) return null
  return { lat, lng }
}

/**
 * @returns { sites: [{ site, km }], within: boolean, located: number }
 *   `within` false means none was inside the radius and these are the nearest anyway;
 *   `located` is how many reachable sites had coordinates at all.
 */
export function nearestSites(sites = [], latitude, longitude, opts = {}) {
  const { radiusKm = NEAR_RADIUS_KM, max = NEAR_MAX, fallback = NEAR_FALLBACK } = opts
  const ranked = (sites || [])
    .map((site) => ({ site, c: siteCoords(site) }))
    .filter((x) => x.site?.id && x.c)
    .map(({ site, c }) => ({ site, km: haversineKm(latitude, longitude, c.lat, c.lng) }))
    .sort(
      (a, b) => a.km - b.km || String(a.site.name || '').localeCompare(String(b.site.name || ''))
    )
  const near = ranked.filter((x) => x.km <= radiusKm)
  if (near.length) return { sites: near.slice(0, max), within: true, located: ranked.length }
  return { sites: ranked.slice(0, fallback), within: false, located: ranked.length }
}

/** "850 m", "3.2 km", "41 km" */
export function formatKm(km) {
  if (km < 1) return `${Math.max(10, Math.round((km * 1000) / 10) * 10)} m`
  if (km < 10) return `${km.toFixed(1)} km`
  return `${Math.round(km)} km`
}

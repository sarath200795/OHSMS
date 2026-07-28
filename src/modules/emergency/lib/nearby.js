// ─────────────────────────────────────────────────────────────────────────────
// Nearest emergency services via OpenStreetMap's Nominatim search API (free,
// no key, CORS-enabled — far more responsive than public Overpass mirrors).
// Given a site's coordinates, finds the closest named Hospital, Police station
// and Fire station within ~10 km. Phone comes from OSM tags when mapped;
// otherwise falls back to 112 (the international emergency number).
// ─────────────────────────────────────────────────────────────────────────────

const NOMINATIM = 'https://nominatim.openstreetmap.org/search'
const BOX_DEG = 0.09 // ≈ 10 km
const FALLBACK_PHONE = '112'

const CATEGORIES = [
  { q: 'hospital', role: 'Hospital' },
  { q: 'police station', role: 'Police' },
  { q: 'fire station', role: 'Fire Brigade' },
]

const toRad = (d) => (d * Math.PI) / 180
function distanceKm(aLat, aLng, bLat, bLng) {
  const R = 6371
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

const phoneOf = (extratags) => {
  const t = extratags || {} // Nominatim sends extratags: null when a place has none
  return t.phone || t['contact:phone'] || t['phone:emergency'] || ''
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function searchCategory(cat, lat, lng) {
  // Bounded viewbox search around the site (lng1,lat1,lng2,lat2).
  const viewbox = `${lng - BOX_DEG},${lat + BOX_DEG},${lng + BOX_DEG},${lat - BOX_DEG}`
  const url =
    `${NOMINATIM}?format=jsonv2&q=${encodeURIComponent(cat.q)}` +
    `&viewbox=${viewbox}&bounded=1&limit=10&extratags=1&addressdetails=0`
  const resp = await fetch(url, {
    // Nominatim policy wants an identifying agent. Browsers drop the UA header
    // (forbidden) and send their own — which Nominatim accepts; Node uses this.
    headers: { Accept: 'application/json', 'User-Agent': 'WEHS-OHSMS/1.0 (emergency-contacts autofill)' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!resp.ok) throw new Error(`Map lookup failed (${resp.status}) — try again in a minute`)
  const rows = await resp.json()

  let best = null
  for (const row of rows) {
    const name = row.name || (row.display_name || '').split(',')[0]
    if (!name) continue
    const d = distanceKm(lat, lng, Number(row.lat), Number(row.lon))
    if (!best || d < best.distanceKm) {
      const osmPhone = phoneOf(row.extratags)
      best = {
        role: cat.role,
        name,
        phone: osmPhone || FALLBACK_PHONE,
        phoneSource: osmPhone ? 'osm' : 'fallback',
        distanceKm: d,
      }
    }
  }
  return best ? { ...best, distanceKm: Math.round(best.distanceKm * 10) / 10 } : null
}

/**
 * Nearest named service per category. Resolves to
 * [{ role, name, phone, phoneSource:'osm'|'fallback', distanceKm }] — categories
 * with nothing found nearby are omitted. Queries run sequentially with a small
 * gap to respect Nominatim's 1-request-per-second usage policy.
 */
export async function findNearestServices(lat, lng) {
  const results = []
  for (let i = 0; i < CATEGORIES.length; i++) {
    if (i > 0) await sleep(1100)
    const best = await searchCategory(CATEGORIES[i], lat, lng)
    if (best) results.push(best)
  }
  return results
}

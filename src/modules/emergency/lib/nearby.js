// ─────────────────────────────────────────────────────────────────────────────
// Nearest emergency services from OpenStreetMap, by the site's coordinates.
//
// Uses the Overpass API rather than Nominatim: Nominatim rejects requests that
// carry no identifying User-Agent (HTTP 403), and `User-Agent` is a forbidden
// header in browsers — so a browser can never satisfy it. Overpass is
// CORS-open, takes a structured amenity query, and returns full OSM tags
// (including phone numbers), which is what we actually need.
//
// Phone coverage in OSM is uneven — many police and fire stations have no
// number mapped. So per category we prefer the nearest service that HAS a
// phone, falling back to the nearest one overall with the phone left blank
// (never a generic helpline masquerading as the station's own number).
// ─────────────────────────────────────────────────────────────────────────────

// Public Overpass instances, tried in order — individual mirrors rate-limit.
const ENDPOINTS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]

const RADIUS_M = 8000
const WIDE_RADIUS_M = 20000 // retry for rural sites with nothing close by

const CATEGORIES = [
  { amenity: 'hospital', role: 'Hospital' },
  { amenity: 'police', role: 'Police' },
  { amenity: 'fire_station', role: 'Fire Brigade' },
]

const toRad = (d) => (d * Math.PI) / 180
function distanceKm(aLat, aLng, bLat, bLng) {
  const R = 6371
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

/** First usable phone from the OSM tags, normalised to a single number. */
const phoneOf = (t = {}) => {
  const raw = t.phone || t['contact:phone'] || t['contact:mobile'] || t['phone:emergency'] || t['emergency:phone'] || ''
  // OSM often lists several numbers separated by ; or ,
  return String(raw).split(/[;,]/)[0].trim()
}

async function overpass(query) {
  let lastErr = null
  for (const endpoint of ENDPOINTS) {
    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(30_000),
      })
      if (!resp.ok) { lastErr = new Error(`Map service returned ${resp.status}`); continue }
      return await resp.json()
    } catch (e) {
      lastErr = e?.name === 'TimeoutError' ? new Error('Map service timed out') : e
    }
  }
  throw lastErr || new Error('Could not reach the map service — check your connection and retry')
}

/**
 * Nominatim fallback for when every Overpass mirror is rate-limited.
 * Works from browsers (they send their own User-Agent, which Nominatim
 * requires) but not from Node without one — hence Overpass first.
 */
async function nominatimAround(lat, lng, radius) {
  const box = radius / 111_000 // metres → rough degrees
  const viewbox = `${lng - box},${lat + box},${lng + box},${lat - box}`
  const out = []
  for (const cat of CATEGORIES) {
    const term = cat.amenity === 'fire_station' ? 'fire station' : cat.amenity
    const url =
      `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(term)}` +
      `&viewbox=${viewbox}&bounded=1&limit=20&extratags=1&addressdetails=0`
    try {
      const resp = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
      if (!resp.ok) continue
      for (const row of await resp.json()) {
        const name = row.name || (row.display_name || '').split(',')[0]
        if (!name) continue
        out.push({
          amenity: cat.amenity,
          name,
          phone: phoneOf(row.extratags || {}),
          distanceKm: Math.round(distanceKm(lat, lng, Number(row.lat), Number(row.lon)) * 10) / 10,
        })
      }
    } catch { /* try the next category */ }
    await new Promise((r) => setTimeout(r, 1100)) // Nominatim: ≤1 request/second
  }
  return out
}

async function fetchAround(lat, lng, radius) {
  const amenities = CATEGORIES.map((c) => c.amenity).join('|')
  const query =
    `[out:json][timeout:25];` +
    `nwr["amenity"~"^(${amenities})$"]["name"](around:${radius},${lat},${lng});` +
    `out center tags 400;`
  let data
  try {
    data = await overpass(query)
  } catch (e) {
    const viaNominatim = await nominatimAround(lat, lng, radius)
    if (viaNominatim.length) return viaNominatim
    throw e
  }
  return (data.elements || [])
    .map((el) => {
      const eLat = el.lat ?? el.center?.lat
      const eLng = el.lon ?? el.center?.lon
      if (eLat == null || eLng == null || !el.tags?.name) return null
      return {
        amenity: el.tags.amenity,
        name: el.tags.name,
        phone: phoneOf(el.tags),
        distanceKm: Math.round(distanceKm(lat, lng, eLat, eLng) * 10) / 10,
      }
    })
    .filter(Boolean)
}

/**
 * Nearest Hospital / Police / Fire Brigade to a coordinate.
 *
 * Resolves to [{ role, name, phone, distanceKm, phoneSource, alternatives }]:
 *   phoneSource 'osm'  — the service's own number, from OpenStreetMap
 *   phoneSource 'none' — nothing mapped; `phone` is '' and must be filled in
 * `alternatives` holds the next few nearest of that type so the UI can offer a
 * different pick (useful when the closest one has no number).
 */
export async function findNearestServices(lat, lng) {
  let all = await fetchAround(lat, lng, RADIUS_M)
  if (!all.length) all = await fetchAround(lat, lng, WIDE_RADIUS_M)

  return CATEGORIES.map((cat) => {
    const group = all
      .filter((x) => x.amenity === cat.amenity)
      .sort((a, b) => a.distanceKm - b.distanceKm)
    if (!group.length) return null

    // Prefer the closest one that actually publishes a number.
    const withPhone = group.find((x) => x.phone)
    const chosen = withPhone || group[0]
    return {
      role: cat.role,
      name: chosen.name,
      phone: chosen.phone || '',
      distanceKm: chosen.distanceKm,
      phoneSource: chosen.phone ? 'osm' : 'none',
      nearestName: group[0].name,
      nearestDistanceKm: group[0].distanceKm,
      alternatives: group.slice(0, 6).map(({ name, phone, distanceKm }) => ({ name, phone, distanceKm })),
    }
  }).filter(Boolean)
}

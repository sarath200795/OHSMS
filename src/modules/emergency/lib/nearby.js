// ─────────────────────────────────────────────────────────────────────────────
// Nearest emergency services for a site's coordinates.
//
// OpenStreetMap via the Overpass API, with Google Places when a key is
// configured. Nominatim is only the last resort: it ranks by importance, not
// distance, so a famous hospital in the box can beat the one across the road.
// It is used when every Overpass mirror has failed, and the result is flagged.
//
// Overpass rather than Nominatim as the normal path: Nominatim rejects
// requests that carry no identifying User-Agent (HTTP 403), and `User-Agent`
// is a forbidden header in browsers. Overpass is CORS-open and returns the
// tags, including phone and address.
//
// What this has to get right:
//
// 1. THE NEAREST PLACE OF THAT TYPE. A previous version widened the search
//    until it found a phone number, then stored that farther station. The
//    number belongs to the nearest facility when it publishes one, and is
//    blank when it does not. Distance is straight-line (haversine). Checked
//    against road distance for the Manyata case: the straight-line order and
//    the driving order were the same, and the facility the old code stored
//    was several kilometres further by either measure. A routing API would
//    not have corrected it.
//
// 2. THE TAGS THAT MEAN THAT TYPE. Hospitals in OSM are `amenity=hospital`
//    or, under the healthcare scheme, `healthcare=hospital` with no amenity
//    tag. Fire stations are `amenity=fire_station` or `emergency=fire_station`.
//    Police stations and posts are `amenity=police` (a chowki is a police
//    post, not a different tag). Clinics, pharmacies and doctors are not
//    queried. The result cap used to be `out … 600` across all three types
//    in quadtile order, so in a dense city the nearest could be the one the
//    cap dropped. Each tier now asks only for the types still missing, with
//    no cap, and stops a type once a real facility is inside the radius.
//
// 3. COORDINATE ORDER. Overpass `around` is `(radius, latitude, longitude)`.
//    Site records store `lat` and `lng` in that order; this module does not
//    swap them. A swapped pair is a bad site record, not something to guess.
//
// 4. WHAT COUNTS. The classifier rejects vendors, pharmacies, police housing
//    and roads ("Fire Station Lane"). A tagged facility whose name has no
//    English category word is kept.
// ─────────────────────────────────────────────────────────────────────────────

import { searchNearbyGoogle } from './providers/googlePlaces'
import { classifyPlace, isRealFacility, pickBest } from './classify'

// Google Places is used when a key is configured; OpenStreetMap is the fallback.
// Guarded because this module is also exercised from plain Node scripts, where
// `import.meta.env` does not exist.
export function googleKey() {
  try {
    return import.meta.env?.VITE_GOOGLE_MAPS_API_KEY || ''
  } catch {
    return ''
  }
}

/** Which source a lookup will use, for the UI to explain itself. */
export const activeProvider = () => (googleKey() ? 'google' : 'osm')

// Tried in order. The public instances fail independently (502, 504, 500);
// starting with one that is down spends the whole timeout before a live
// mirror is asked. overpass-api.de is kept — it answers, slowly.
export const ENDPOINTS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]

// Stop a category once it has a real facility. 5 km covers a city block of
// hospitals; 15 km then 30 km are for a station that genuinely is not closer.
const TIERS_M = [5000, 15000, 30000]

export const CATEGORIES = [
  { amenity: 'hospital', role: 'Hospital' },
  { amenity: 'police', role: 'Police' },
  { amenity: 'fire_station', role: 'Fire Brigade' },
]

const toRad = (d) => (d * Math.PI) / 180

export function distanceKm(aLat, aLng, bLat, bLng) {
  const R = 6371
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

/**
 * Site coordinates as numbers. Does not swap lat/lng: Indian longitudes are
 * inside the latitude range, so a swap would look like a valid point in the
 * wrong country and "correcting" it would also move a real high-latitude site.
 */
export function coerceLatLng(lat, lng) {
  // Number(null) is 0, which is a real point in the Atlantic. A missing
  // coordinate has to fail before that coercion.
  if (lat == null || lng == null || String(lat).trim() === '' || String(lng).trim() === '') {
    throw new Error('This site has no usable coordinates')
  }
  const la = typeof lat === 'string' ? Number(lat.trim()) : Number(lat)
  const ln = typeof lng === 'string' ? Number(lng.trim()) : Number(lng)
  if (!Number.isFinite(la) || !Number.isFinite(ln)) {
    throw new Error('This site has no usable coordinates')
  }
  if (la < -90 || la > 90 || ln < -180 || ln > 180) {
    throw new Error('Site coordinates are out of range')
  }
  return { lat: la, lng: ln }
}

/**
 * A name that ends in a street type is a road, not a station — OSM contains
 * ways like "Fire Station Lane" and free-text searches happily return them.
 */
const STREET_SUFFIX =
  /\b(lane|road|rd|street|st|avenue|ave|close|drive|dr|crescent|court|walk|way|path|marg|circle|boulevard|blvd)\.?$/i

const looksLikeStreet = (name) => STREET_SUFFIX.test(String(name || '').trim())

// "Fire St." is a station (way 357036757 in Hyderabad is a building tagged
// fire_station). "St" in the street list is what made the nearer station look
// like a road. "Fire Station Lane" does not match this and stays a road.
const STATION_ABBREV = /^(fire|police)\s+st\.?$/i

/**
 * Reject junk in the phone tag: placeholders, "N/A", and the national helplines
 * — dialling 112 is correct advice, but it is not a station's own line.
 */
const GENERIC = new Set(['112', '100', '101', '102', '108', '999', '911', '1091', '1098'])

export function isPlausiblePhone(v) {
  const s = String(v || '').trim()
  if (!s || /[a-z]{2}/i.test(s)) return false
  const digits = s.replace(/\D/g, '')
  return digits.length >= 6 && digits.length <= 15 && !GENERIC.has(digits)
}

export function usablePhone(v) {
  const first = String(v || '')
    .split(/[;,]/)[0]
    .trim()
  return isPlausiblePhone(first) ? first : ''
}

/** First usable phone from the OSM tags, normalised to a single number. */
export function phoneOf(t = {}) {
  const raw =
    t.phone ||
    t['contact:phone'] ||
    t['contact:mobile'] ||
    t['phone:emergency'] ||
    t['emergency:phone'] ||
    ''
  return usablePhone(raw)
}

/** Street address from OSM addr:* tags. Blank when the map has none. */
export function addressFromTags(t = {}) {
  const full = String(t['addr:full'] || '').trim()
  if (full) return full
  const city = t['addr:city'] || t['addr:town'] || t['addr:village'] || ''
  const line = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ')
  const suburb = t['addr:suburb'] && t['addr:suburb'] !== city ? t['addr:suburb'] : ''
  return [line, suburb, city, t['addr:state'], t['addr:postcode']].filter(Boolean).join(', ')
}

/** Which of our three types an OSM element is, or null. Clinics are not hospitals. */
export function amenityOf(tags = {}) {
  const amenity = tags.amenity || ''
  const healthcare = tags.healthcare || ''
  if (
    amenity === 'pharmacy' ||
    amenity === 'clinic' ||
    amenity === 'doctors' ||
    amenity === 'dentist' ||
    healthcare === 'pharmacy' ||
    healthcare === 'clinic'
  ) {
    return null
  }
  if (amenity === 'hospital' || healthcare === 'hospital') return 'hospital'
  if (amenity === 'police') return 'police'
  if (amenity === 'fire_station' || tags.emergency === 'fire_station') return 'fire_station'
  return null
}

/** Prefer a Latin name:en when `name` is only in a local script. */
export function displayName(tags = {}) {
  const name = String(tags.name || '').trim()
  const en = String(tags['name:en'] || '').trim()
  if (en && !/[A-Za-z]/.test(name)) return en
  return name
}

export function candidateNames(tags = {}) {
  const keys = ['name', 'name:en', 'name:hi', 'name:kn', 'name:te', 'name:ta']
  const out = []
  for (const key of keys) {
    const s = String(tags[key] || '').trim()
    if (s.length >= 3 && !out.includes(s)) out.push(s)
  }
  return out
}

/**
 * Overpass query for the types still missing. Hospitals include the healthcare
 * tagging scheme; fire stations include `emergency=fire_station`. No element
 * cap — `out … 600` was not distance-ordered.
 */
export function buildOverpassQuery(amenities, radius, lat, lng) {
  const parts = []
  if (amenities.includes('hospital')) {
    parts.push(`nwr["amenity"="hospital"]["name"](around:${radius},${lat},${lng});`)
    // `!~` is true only when the key exists, so it dropped the very rows this
    // clause is for: healthcare=hospital with no amenity tag. `!=` is true
    // when the key is missing. amenity=hospital is already in the clause above.
    parts.push(
      `nwr["healthcare"="hospital"]["amenity"!="hospital"]["amenity"!="clinic"]` +
        `["amenity"!="pharmacy"]["amenity"!="doctors"]["amenity"!="dentist"]` +
        `["name"](around:${radius},${lat},${lng});`
    )
  }
  if (amenities.includes('police')) {
    parts.push(`nwr["amenity"="police"]["name"](around:${radius},${lat},${lng});`)
  }
  if (amenities.includes('fire_station')) {
    parts.push(`nwr["amenity"="fire_station"]["name"](around:${radius},${lat},${lng});`)
    parts.push(
      `nwr["emergency"="fire_station"]["amenity"!="fire_station"]["name"](around:${radius},${lat},${lng});`
    )
  }
  return `[out:json][timeout:25];(${parts.join('')});out center tags;`
}

export function mapOsmElement(el, originLat, originLng, source = 'overpass') {
  const tags = el?.tags || {}
  const amenity = amenityOf(tags)
  const eLat = el?.lat ?? el?.center?.lat
  const eLng = el?.lon ?? el?.center?.lon
  const name = displayName(tags)
  if (!amenity || !name || eLat == null || eLng == null) return null
  return {
    amenity,
    name,
    names: candidateNames(tags).length ? candidateNames(tags) : [name],
    phone: phoneOf(tags),
    address: addressFromTags(tags),
    distanceKm: Math.round(distanceKm(originLat, originLng, Number(eLat), Number(eLng)) * 10) / 10,
    source,
    tagged: true,
  }
}

/**
 * Is this candidate really the amenity we asked for? Street-style names are
 * roads; the classifier then removes vendors, pharmacies and police housing.
 * Hospitals are allowed to end in "Road" — "Apollo Hospital, MG Road" is a
 * hospital. "Fire Station Lane" is not a fire station.
 */
export function isValidCandidate(c) {
  if (!c?.name || c.name.length < 3) return false
  if (
    c.amenity !== 'hospital' &&
    looksLikeStreet(c.name) &&
    !(c.tagged && STATION_ABBREV.test(c.name.trim()))
  ) {
    return false
  }
  return classifyPlace(c.name, c.amenity, { tagged: !!c.tagged, names: c.names }).ok
}

/** Categories that still have no hospital / station / post inside the results. */
export function categoriesStillMissing(candidates) {
  return CATEGORIES.filter(
    (cat) => !candidates.some((c) => c.amenity === cat.amenity && isRealFacility(c))
  ).map((c) => c.amenity)
}

/**
 * Same place coming back from two tiers, or as both a node and a way.
 * Same name within 0.3 km is one place; two "Government Hospital"s kilometres
 * apart stay two places. The closer distance wins, and a phone or address
 * from either copy is kept.
 */
export function mergeCandidates(groups) {
  const list = []
  for (const c of groups.flat()) {
    if (!c) continue
    const name = c.name.trim().toLowerCase()
    const prev = list.find(
      (p) =>
        p.amenity === c.amenity &&
        p.name.trim().toLowerCase() === name &&
        Math.abs(p.distanceKm - c.distanceKm) <= 0.3
    )
    if (!prev) {
      list.push({ ...c })
      continue
    }
    if (!prev.phone && c.phone) prev.phone = c.phone
    if (!prev.address && c.address) prev.address = c.address
    if (c.distanceKm < prev.distanceKm) {
      prev.distanceKm = c.distanceKm
      prev.names = c.names || prev.names
      prev.tagged = prev.tagged || c.tagged
      prev.source = c.source || prev.source
    }
  }
  return list
}

async function overpass(query) {
  let lastErr = null
  for (const endpoint of ENDPOINTS) {
    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(40_000),
      })
      if (!resp.ok) {
        lastErr = new Error(`Map service returned ${resp.status}`)
        continue
      }
      const data = await resp.json()
      if (!Array.isArray(data?.elements)) {
        lastErr = new Error(data?.remark || 'Map service returned no data')
        continue
      }
      return data
    } catch (e) {
      lastErr = e?.name === 'TimeoutError' ? new Error('Map service timed out') : e
    }
  }
  throw lastErr || new Error('Could not reach the map service — check your connection and retry')
}

function nominatimAddress(row) {
  const a = row?.address || {}
  const city = a.city || a.town || a.village || ''
  const line = [a.house_number, a.road].filter(Boolean).join(' ')
  const suburb = a.suburb && a.suburb !== city ? a.suburb : ''
  const built = [line, suburb, city, a.state].filter(Boolean).join(', ')
  if (built) return built
  return String(row?.display_name || '')
    .split(',')
    .slice(1, 4)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(', ')
}

/**
 * Nominatim fallback for when every Overpass mirror fails.
 * Rows are whatever Nominatim ranks as important inside the box, then we
 * keep the closest of those. That set is not "every facility", so callers
 * flag the source.
 */
async function nominatimAround(lat, lng, radius, amenities) {
  const box = radius / 111_000
  const viewbox = `${lng - box},${lat + box},${lng + box},${lat - box}`
  const wanted = CATEGORIES.filter((c) => amenities.includes(c.amenity))
  const out = []
  for (const [i, cat] of wanted.entries()) {
    const term = cat.amenity === 'fire_station' ? 'fire station' : cat.amenity
    const url =
      `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(term)}` +
      `&viewbox=${viewbox}&bounded=1&limit=40&extratags=1&addressdetails=1`
    try {
      const resp = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      })
      if (resp.ok) {
        for (const row of await resp.json()) {
          const type = row.type === 'fire_station' ? 'fire_station' : row.type
          if (row.category !== 'amenity' || type !== cat.amenity) continue
          // The type check above is what makes this a hospital rather than a
          // road the search term happened to match. mapOsmElement only trusts
          // the tags, so the amenity has to be on them.
          const tags = {
            ...(row.extratags || {}),
            amenity: cat.amenity,
            name: row.name || (row.display_name || '').split(',')[0],
          }
          if (!tags.name) continue
          const mapped = mapOsmElement(
            { lat: Number(row.lat), lon: Number(row.lon), tags },
            lat,
            lng,
            'nominatim'
          )
          if (!mapped) continue
          mapped.address = mapped.address || nominatimAddress(row)
          out.push(mapped)
        }
      }
    } catch {
      /* try the next category */
    }
    if (i < wanted.length - 1) await new Promise((r) => setTimeout(r, 1100))
  }
  return out.filter(isValidCandidate)
}

async function fetchAroundGoogle(lat, lng, radius, amenities, key) {
  const out = []
  for (const cat of CATEGORIES) {
    if (!amenities.includes(cat.amenity)) continue
    out.push(...(await searchNearbyGoogle(lat, lng, radius, cat.amenity, key)))
  }
  return out.filter(isValidCandidate)
}

async function fetchAround(lat, lng, radius, amenities) {
  const query = buildOverpassQuery(amenities, radius, lat, lng)
  let data
  try {
    data = await overpass(query)
  } catch (e) {
    const viaNominatim = await nominatimAround(lat, lng, radius, amenities)
    if (viaNominatim.length) return viaNominatim
    throw e
  }
  return (data.elements || [])
    .map((el) => mapOsmElement(el, lat, lng))
    .filter(Boolean)
    .filter(isValidCandidate)
}

/**
 * One result per category: the nearest real facility, with its own phone and
 * address when the map has them.
 */
export function selectServices(candidates, searchedKm) {
  const all = mergeCandidates([candidates])
  return CATEGORIES.map((cat) => {
    const group = all.filter((x) => x.amenity === cat.amenity)
    const best = pickBest(group)
    if (!best) return null
    const { chosen, usable, fallback } = best
    const phone = usablePhone(chosen.phone)
    return {
      role: cat.role,
      name: chosen.name,
      phone,
      address: chosen.address || '',
      distanceKm: chosen.distanceKm,
      phoneSource: phone ? chosen.source : 'none',
      source: chosen.source,
      limited: !!chosen.limited,
      fallback: !!fallback,
      searchedKm,
      alternatives: usable.slice(0, 8).map(({ name, phone: p, address, distanceKm, limited }) => ({
        name,
        phone: usablePhone(p),
        address: address || '',
        distanceKm,
        limited: !!limited,
      })),
    }
  }).filter(Boolean)
}

/**
 * Nearest Hospital / Police / Fire Brigade to a coordinate.
 *
 * Resolves to [{ role, name, phone, address, distanceKm, phoneSource, … }].
 * `phone` is that facility's own number, or '' when it publishes none.
 */
export async function findNearestServices(lat, lng, { onTier, apiKey } = {}) {
  const { lat: la, lng: ln } = coerceLatLng(lat, lng)
  const collected = []
  let pending = CATEGORIES.map((c) => c.amenity)
  let lastError = null
  let reached = TIERS_M[0]

  let key = apiKey ?? googleKey()
  let provider = key ? 'google' : 'osm'

  for (const radius of TIERS_M) {
    if (!pending.length) break
    reached = radius
    onTier?.({ radiusKm: radius / 1000, pending: pending.length, provider })
    try {
      collected.push(
        provider === 'google'
          ? await fetchAroundGoogle(la, ln, radius, pending, key)
          : await fetchAround(la, ln, radius, pending)
      )
    } catch (e) {
      if (provider === 'google') {
        provider = 'osm'
        key = ''
        onTier?.({
          radiusKm: radius / 1000,
          pending: pending.length,
          provider,
          fellBack: e?.message,
        })
        try {
          collected.push(await fetchAround(la, ln, radius, pending))
        } catch (e2) {
          lastError = e2
          continue
        }
      } else {
        lastError = e
        continue
      }
    }
    pending = categoriesStillMissing(mergeCandidates(collected))
  }

  const all = mergeCandidates(collected)
  if (!all.length && lastError) throw lastError
  return selectServices(all, reached / 1000)
}

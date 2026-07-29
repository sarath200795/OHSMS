// ─────────────────────────────────────────────────────────────────────────────
// Nearest emergency services from OpenStreetMap, by the site's coordinates.
//
// Uses the Overpass API rather than Nominatim: Nominatim rejects requests that
// carry no identifying User-Agent (HTTP 403), and `User-Agent` is a forbidden
// header in browsers — so a browser can never satisfy it. Overpass is
// CORS-open, takes a structured amenity query, and returns full OSM tags
// (including phone numbers), which is what we actually need.
//
// Three things this has to get right, each learned the hard way:
//
// 1. RADIUS. Phone coverage in OSM is sparse and uneven. A single 8 km search
//    routinely finds stations but no numbers — measured around Leeds, Bristol,
//    Hyderabad and Bengaluru, the nearest station WITH a published number sat
//    at 8–15 km while the nearest station overall was 1–3 km. So we widen the
//    search in tiers until a number turns up.
//
// 2. DISTANCE SANITY. Widening cannot be unbounded. Around Leeds the closest
//    police station publishing a number is 43 km away — that is not anybody's
//    emergency contact. Past MAX_PHONE_KM we keep the genuinely nearest station
//    and leave the number blank rather than print a reassuring but useless one.
//
// 3. WHAT COUNTS AS A STATION. The old Nominatim fallback free-text searched
//    "fire station" and labelled every hit a fire station, so a road named
//    "Fire Station Lane" became an emergency contact. Candidates are now
//    validated: the source must classify them as that amenity, street-style
//    names are rejected, and phone strings must actually look like numbers.
// ─────────────────────────────────────────────────────────────────────────────

import { searchNearbyGoogle } from './providers/googlePlaces'
import { classifyPlace, pickBest } from './classify'

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

// Public Overpass instances, tried in order — individual mirrors rate-limit.
const ENDPOINTS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]

// Widen until a category has a usable number. Measured coverage says 30 km is
// where the returns stop: past it we are picking a different town's station.
const TIERS_M = [8000, 15000, 30000]
const MAX_PHONE_KM = 25

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

/**
 * A name that ends in a street type is a road, not a station — OSM contains
 * ways like "Fire Station Lane" and free-text searches happily return them.
 * Real stations end in Station / Hospital / Centre / a proper noun.
 */
const STREET_SUFFIX =
  /\b(lane|road|rd|street|st|avenue|ave|close|drive|dr|crescent|court|walk|way|path|marg|circle|boulevard|blvd)\.?$/i

const looksLikeStreet = (name) => STREET_SUFFIX.test(String(name || '').trim())

/** First usable phone from the OSM tags, normalised to a single number. */
function phoneOf(t = {}) {
  const raw =
    t.phone || t['contact:phone'] || t['contact:mobile'] ||
    t['phone:emergency'] || t['emergency:phone'] || ''
  // OSM often lists several numbers separated by ; or ,
  const first = String(raw).split(/[;,]/)[0].trim()
  return isPlausiblePhone(first) ? first : ''
}

/**
 * Reject junk in the phone tag: placeholders, "N/A", and the national helplines
 * — dialling 112 is correct advice, but it is not a station's own line and
 * storing it as one is what made these contacts untrustworthy before.
 */
const GENERIC = new Set(['112', '100', '101', '102', '108', '999', '911', '1091', '1098'])
function isPlausiblePhone(v) {
  const s = String(v || '').trim()
  if (!s || /[a-z]{2}/i.test(s)) return false
  const digits = s.replace(/\D/g, '')
  return digits.length >= 6 && digits.length <= 15 && !GENERIC.has(digits)
}

/**
 * Is this candidate really the amenity we asked for? Street-style names are
 * roads mis-tagged in OSM; the classifier then removes vendors, trade bodies,
 * police housing, pharmacies and other things that cannot answer a call.
 */
function isValidCandidate(c) {
  if (!c.name || c.name.length < 3) return false
  if (c.amenity !== 'hospital' && looksLikeStreet(c.name)) return false
  return classifyPlace(c.name, c.amenity).ok
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
 *
 * Only accepts rows Nominatim itself classifies as the amenity we asked for
 * (`category`/`type` in the jsonv2 response). The previous version trusted the
 * search term instead, which is how roads ended up as fire stations.
 */
async function nominatimAround(lat, lng, radius) {
  const box = radius / 111_000 // metres → rough degrees
  const viewbox = `${lng - box},${lat + box},${lng + box},${lat - box}`
  const out = []
  for (const cat of CATEGORIES) {
    const term = cat.amenity === 'fire_station' ? 'fire station' : cat.amenity
    const url =
      `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(term)}` +
      `&viewbox=${viewbox}&bounded=1&limit=30&extratags=1&addressdetails=0`
    try {
      const resp = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
      if (!resp.ok) continue
      for (const row of await resp.json()) {
        // Cross-check the classification instead of trusting the search term.
        const type = row.type === 'fire_station' ? 'fire_station' : row.type
        if (row.category !== 'amenity' || type !== cat.amenity) continue
        const name = row.name || (row.display_name || '').split(',')[0]
        if (!name) continue
        out.push({
          amenity: cat.amenity,
          name,
          phone: phoneOf(row.extratags || {}),
          emergency: (row.extratags || {}).emergency === 'yes',
          distanceKm: Math.round(distanceKm(lat, lng, Number(row.lat), Number(row.lon)) * 10) / 10,
          source: 'nominatim',
        })
      }
    } catch { /* try the next category */ }
    await new Promise((r) => setTimeout(r, 1100)) // Nominatim: ≤1 request/second
  }
  return out
}

/**
 * One tier of Google results across all three categories.
 * A failure here (bad key, quota, billing disabled) propagates so the caller
 * can drop to OSM for the whole run instead of half-filling from two sources.
 */
async function fetchAroundGoogle(lat, lng, radius, key) {
  const out = []
  for (const cat of CATEGORIES) {
    out.push(...(await searchNearbyGoogle(lat, lng, radius, cat.amenity, key)))
  }
  return out.filter(isValidCandidate)
}

async function fetchAround(lat, lng, radius) {
  const amenities = CATEGORIES.map((c) => c.amenity).join('|')
  const query =
    `[out:json][timeout:40];` +
    `nwr["amenity"~"^(${amenities})$"]["name"](around:${radius},${lat},${lng});` +
    `out center tags 600;`
  let data
  try {
    data = await overpass(query)
  } catch (e) {
    const viaNominatim = await nominatimAround(lat, lng, radius)
    if (viaNominatim.length) return viaNominatim.filter(isValidCandidate)
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
        emergency: el.tags.emergency === 'yes',
        distanceKm: Math.round(distanceKm(lat, lng, eLat, eLng) * 10) / 10,
        source: 'overpass',
      }
    })
    .filter(Boolean)
    .filter(isValidCandidate)
}

/** Merge tiers, keeping one entry per name+distance and the richest phone. */
function mergeCandidates(groups) {
  const byKey = new Map()
  for (const c of groups.flat()) {
    const key = `${c.amenity}|${c.name}|${c.distanceKm}`
    const prev = byKey.get(key)
    if (!prev) byKey.set(key, c)
    else if (!prev.phone && c.phone) byKey.set(key, c)
  }
  return [...byKey.values()]
}

/**
 * Nearest Hospital / Police / Fire Brigade to a coordinate.
 *
 * Resolves to [{ role, name, phone, distanceKm, phoneSource, … }]:
 *   phoneSource 'google' | 'overpass' | 'nominatim' — the service's own number
 *   phoneSource 'none' — nothing published within MAX_PHONE_KM; `phone` is ''
 *
 * When the station carrying the number is not the closest one, `nearestName` /
 * `nearestDistanceKm` describe the closer station that publishes nothing, so
 * the UI can explain the swap instead of silently relocating the contact.
 * `alternatives` holds the nearest few of that type for manual correction —
 * every one of these sources gets things wrong sometimes.
 */
export async function findNearestServices(lat, lng, { onTier, apiKey } = {}) {
  const collected = []
  let pending = CATEGORIES.map((c) => c.amenity)
  let lastError = null

  // Google when configured, OpenStreetMap otherwise. If Google fails outright
  // (key rejected, billing off, quota spent) we fall back for the rest of the
  // run rather than mixing a curated source with a patchy one mid-lookup.
  let key = apiKey ?? googleKey()
  let provider = key ? 'google' : 'osm'

  for (const radius of TIERS_M) {
    if (!pending.length) break
    onTier?.({ radiusKm: radius / 1000, pending: pending.length, provider })
    try {
      collected.push(
        provider === 'google'
          ? await fetchAroundGoogle(lat, lng, radius, key)
          : await fetchAround(lat, lng, radius)
      )
    } catch (e) {
      if (provider === 'google') {
        // Retry this same tier on OSM, then stay there.
        provider = 'osm'
        key = ''
        onTier?.({ radiusKm: radius / 1000, pending: pending.length, provider, fellBack: e?.message })
        try { collected.push(await fetchAround(lat, lng, radius)) } catch (e2) { lastError = e2; continue }
      } else {
        lastError = e
        continue
      }
    }
    const merged = mergeCandidates(collected)
    // Keep widening only for the categories still missing a usable number.
    pending = pending.filter((amenity) => {
      const withPhone = merged.find((c) => c.amenity === amenity && c.phone && c.distanceKm <= MAX_PHONE_KM)
      return !withPhone
    })
  }

  const all = mergeCandidates(collected)
  if (!all.length && lastError) throw lastError

  return CATEGORIES.map((cat) => {
    const group = all.filter((x) => x.amenity === cat.amenity)
    // pickBest drops anything that cannot answer an emergency call, then
    // prefers a genuine station we can phone over a nearer one we cannot.
    const best = pickBest(group, MAX_PHONE_KM)
    if (!best) return null
    const { chosen, nearest, usable } = best

    return {
      role: cat.role,
      name: chosen.name,
      phone: chosen.phone || '',
      distanceKm: chosen.distanceKm,
      phoneSource: chosen.phone ? chosen.source : 'none',
      source: chosen.source,
      nearestName: nearest.name,
      nearestDistanceKm: nearest.distanceKm,
      searchedKm: TIERS_M[TIERS_M.length - 1] / 1000,
      alternatives: usable.slice(0, 8).map(({ name, phone, distanceKm, strong }) => ({
        name, phone, distanceKm, strong,
      })),
    }
  }).filter(Boolean)
}

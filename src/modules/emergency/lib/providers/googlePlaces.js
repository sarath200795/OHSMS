// ─────────────────────────────────────────────────────────────────────────────
// Google Places (New) — the preferred source for nearest emergency services.
//
// OpenStreetMap is community-maintained and, for this job, unreliable: measured
// against four sites it returned traffic-police units instead of emergency
// stations, a police station in a different force area 13 km away, entries
// named "Fire Station (19)", and no phone number at all for most stations.
// Google's records are curated and carry a phone number for the large majority
// of hospitals, police and fire stations, so we use it whenever a key exists
// and fall back to OSM when one does not.
//
// Uses the Places API (New) REST endpoint, which supports CORS from browsers —
// the older Places web service does not, and would need a backend we do not
// have. The field mask is what controls billing here: we ask for phone numbers
// in the search itself so no follow-up Place Details call is needed.
//
// Setup (see DEPLOYMENT.md): enable "Places API (New)", create a key,restrict
// it to your hosting domain, and set VITE_GOOGLE_MAPS_API_KEY.
// ─────────────────────────────────────────────────────────────────────────────

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchNearby'

const FIELD_MASK = [
  'places.displayName',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.location',
  'places.formattedAddress',
  'places.primaryType',
  'places.businessStatus',
].join(',')

/** OSM amenity → Google place type, so both providers speak one vocabulary. */
export const GOOGLE_TYPE = {
  hospital: 'hospital',
  police: 'police',
  fire_station: 'fire_station',
}

const toRad = (d) => (d * Math.PI) / 180
export function distanceKm(aLat, aLng, bLat, bLng) {
  const R = 6371
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

/**
 * Map one Google place onto the shape the rest of the module expects.
 * Returns null for records we should not offer as an emergency contact.
 * Pure — unit tested without touching the network.
 */
export function mapGooglePlace(place, amenity, lat, lng) {
  const name = place?.displayName?.text || ''
  const pos = place?.location
  if (!name || pos?.latitude == null || pos?.longitude == null) return null
  // Permanently closed stations must never reach a poster.
  if (place.businessStatus && place.businessStatus !== 'OPERATIONAL') return null

  return {
    amenity,
    name,
    // Prefer the national format — that is what somebody dials locally.
    phone: (place.nationalPhoneNumber || place.internationalPhoneNumber || '').trim(),
    address: place.formattedAddress || '',
    emergency: amenity === 'hospital' && place.primaryType === 'hospital',
    distanceKm: Math.round(distanceKm(lat, lng, pos.latitude, pos.longitude) * 10) / 10,
    source: 'google',
  }
}

/**
 * Nearest places of one type, ranked by distance.
 * Throws on auth/quota problems so the caller can fall back to OSM rather than
 * silently reporting "nothing found nearby".
 */
export async function searchNearbyGoogle(lat, lng, radiusM, amenity, apiKey) {
  const resp = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify({
      includedTypes: [GOOGLE_TYPE[amenity]],
      maxResultCount: 20,
      rankPreference: 'DISTANCE',
      locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: radiusM } },
    }),
    signal: AbortSignal.timeout(20_000),
  })

  if (!resp.ok) {
    let detail = ''
    try { detail = (await resp.json())?.error?.message || '' } catch { /* body not JSON */ }
    throw new Error(`Google Places ${resp.status}${detail ? `: ${detail}` : ''}`)
  }

  const data = await resp.json()
  return (data.places || [])
    .map((p) => mapGooglePlace(p, amenity, lat, lng))
    .filter(Boolean)
}

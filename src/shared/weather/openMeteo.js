// ─────────────────────────────────────────────────────────────────────────────
// Current conditions for a coordinate, from Open-Meteo.
//
// Chosen because it needs no API key and sets CORS headers, so the browser can
// call it directly and there is no secret to leak from a client bundle and no
// proxy to run. Note it is free for non-commercial use — a commercial licence
// is a paid plan, which is a decision for whoever operates this deployment.
//
// Site coordinates leave the app to reach it. That is unavoidable for any
// weather provider, but it is why coordinates are rounded to ~1 km before they
// are sent: the weather is identical at that resolution and the exact position
// of a workplace is not something to hand out for free. Nothing else about the
// site — not its name, org, or id — is included in the request.
//
// The cache is what makes this usable on a map: a hundred pins in one city
// share a handful of grid squares, and hovering the same pin twice costs
// nothing.
// ─────────────────────────────────────────────────────────────────────────────

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast'

/** ~1.1 km at the equator, and the key the cache is bucketed by. */
const GRID = 2
const TTL_MS = 15 * 60 * 1000
const TIMEOUT_MS = 12_000

const cache = new Map() // key -> { at, obs }
const inflight = new Map() // key -> Promise

const keyFor = (lat, lng) => `${lat.toFixed(GRID)},${lng.toFixed(GRID)}`

/** Test seam — the cache is module state and would otherwise leak across tests. */
export function _clearWeatherCache() {
  cache.clear()
  inflight.clear()
}

/**
 * Shape Open-Meteo's response into the observation `assessWeather` expects.
 *
 * Visibility and UV are hourly-only series, so the reading for the hour the
 * `current` block reports is picked out rather than assuming index 0 — the
 * series starts at midnight local, so index 0 is the middle of last night.
 */
export function normalizeOpenMeteo(json) {
  const cur = json?.current || {}
  const hourly = json?.hourly || {}
  const times = hourly.time || []

  let hi = -1
  if (cur.time) {
    const hour = String(cur.time).slice(0, 13) // YYYY-MM-DDTHH
    hi = times.findIndex((t) => String(t).slice(0, 13) === hour)
  }
  const at = (series) => (hi >= 0 && Array.isArray(series) ? pick(series[hi]) : null)

  return {
    tempC: pick(cur.temperature_2m),
    apparentTempC: pick(cur.apparent_temperature),
    precipMmHr: pick(cur.precipitation),
    windKph: pick(cur.wind_speed_10m),
    gustKph: pick(cur.wind_gusts_10m),
    weatherCode: pick(cur.weather_code),
    visibilityM: at(hourly.visibility),
    uvIndex: at(hourly.uv_index),
    observedAt: cur.time || null,
  }
}

function pick(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * Fetch current conditions near a coordinate.
 *
 * Resolves to `null` rather than throwing when the service is unreachable:
 * weather is a decoration on a site card, and a map that fails to render
 * because a third party is down would be a worse outcome than a card with no
 * weather on it.
 */
export async function fetchWeather(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  const key = keyFor(lat, lng)

  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.obs

  // Two pins in the same grid square hovered together make one request.
  if (inflight.has(key)) return inflight.get(key)

  const [gLat, gLng] = key.split(',')
  const url =
    `${ENDPOINT}?latitude=${gLat}&longitude=${gLng}` +
    '&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m' +
    '&hourly=visibility,uv_index' +
    '&wind_speed_unit=kmh&timezone=auto&forecast_days=1'

  const req = (async () => {
    try {
      const resp = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!resp.ok) return null
      const obs = normalizeOpenMeteo(await resp.json())
      cache.set(key, { at: Date.now(), obs })
      return obs
    } catch {
      return null // offline, blocked, rate-limited or timed out — all the same here
    } finally {
      inflight.delete(key)
    }
  })()

  inflight.set(key, req)
  return req
}

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

// Open-Meteo's free tier is metered per minute, per hour and per day, and it
// answers 429 for the rest of the window once a limit is crossed. Asking again
// inside that window cannot succeed — it only spends another request and prints
// another red line in the console — so the first 429 stops all of them until the
// window has plausibly passed.
const COOLOFF_MS = 60_000
const COOLOFF_MAX_MS = 15 * 60 * 1000

// The cache outlives the page because the quota does. A map of sixty sites
// costs its handful of requests once per quarter hour, not once per reload —
// and a reload is the cheapest thing in the world to do while working.
// Readings only: a failure is never stored, so a bad minute cannot be inherited
// by the next session. Bounded so a fleet that moves around the country cannot
// grow this without limit.
const STORE_KEY = 'wehs:weather'
const STORE_MAX = 200

const cache = new Map() // key -> { at, obs }
const inflight = new Map() // key -> Promise
let coolOffUntil = 0
let hydrated = false

const keyFor = (lat, lng) => `${lat.toFixed(GRID)},${lng.toFixed(GRID)}`

/** Storage is a courtesy here — private mode, a full quota and SSR all opt out. */
function store() {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function hydrate() {
  if (hydrated) return
  hydrated = true
  try {
    const saved = JSON.parse(store()?.getItem(STORE_KEY) || '{}')
    const now = Date.now()
    for (const [key, entry] of Object.entries(saved)) {
      if (entry?.obs && now - entry.at < TTL_MS) cache.set(key, entry)
    }
  } catch {
    /* a corrupt or unreadable cache is just a cold one */
  }
}

function persist() {
  const s = store()
  if (!s) return
  try {
    // Newest first, so the trim drops the readings that were going to expire
    // soonest anyway.
    const entries = [...cache.entries()].filter(([, e]) => e.obs).sort((a, b) => b[1].at - a[1].at)
    s.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(entries.slice(0, STORE_MAX))))
  } catch {
    /* quota or private mode — the in-memory cache still works */
  }
}

/**
 * Test seam — drop what this page knows while leaving what was stored, which is
 * exactly the state a reload starts from.
 */
export function _reloadWeatherCache() {
  cache.clear()
  inflight.clear()
  coolOffUntil = 0
  hydrated = false
}

/** Test seam — the cache is module state and would otherwise leak across tests. */
export function _clearWeatherCache() {
  cache.clear()
  inflight.clear()
  coolOffUntil = 0
  hydrated = false
  try {
    store()?.removeItem(STORE_KEY)
  } catch {
    /* nothing to clear */
  }
}

/**
 * How long to stand down after a 429.
 *
 * Retry-After is the service's own answer and is preferred when it sends one;
 * it may be seconds or an HTTP date. The clamp is there because neither form is
 * guaranteed to be sane, and a header cannot be allowed to switch weather off
 * for the rest of the session.
 */
function coolOffFor(resp) {
  const header = resp?.headers?.get?.('Retry-After')
  let ms = COOLOFF_MS
  if (header) {
    const seconds = Number(header)
    const until = Number.isFinite(seconds) ? Date.now() + seconds * 1000 : Date.parse(header)
    if (Number.isFinite(until)) ms = until - Date.now()
  }
  return Math.min(COOLOFF_MAX_MS, Math.max(COOLOFF_MS, ms))
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
  hydrate()
  const key = keyFor(lat, lng)

  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.obs

  // Rate-limited: serve the last reading for this square if there is one — an
  // hour-old temperature on a site card is worth more than a blank — and make
  // no request either way.
  if (Date.now() < coolOffUntil) return hit ? hit.obs : null

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
      if (resp.status === 429) {
        coolOffUntil = Date.now() + coolOffFor(resp)
        return null
      }
      if (!resp.ok) return null
      const obs = normalizeOpenMeteo(await resp.json())
      cache.set(key, { at: Date.now(), obs })
      persist()
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

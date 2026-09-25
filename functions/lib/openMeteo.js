// Current conditions for a coordinate, from Open-Meteo.
//
// The same request the browser already makes (src/modules/weather/lib/openMeteo.js).
// No API key. Coordinates are rounded to two decimals (~1 km) before they
// leave: the weather is the same at that resolution, and the exact position
// of a workplace is not part of the request. The site name, org and id are
// not either.
//
// A failure is null. The digest must not treat "the provider was down" as
// "no elevated risk".

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast'
const TIMEOUT_MS = 12_000

export function gridKey(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return ''
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return ''
  return `${lat.toFixed(2)},${lng.toFixed(2)}`
}

/** The URL that would be fetched. Exported so a test can see what leaves. */
export function forecastUrl(lat, lng) {
  const key = gridKey(lat, lng)
  if (!key) return ''
  const [gLat, gLng] = key.split(',')
  return (
    `${ENDPOINT}?latitude=${gLat}&longitude=${gLng}` +
    '&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m' +
    '&hourly=visibility,uv_index' +
    '&wind_speed_unit=kmh&timezone=auto&forecast_days=1'
  )
}

function pick(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Shape Open-Meteo's response into the observation assessWeather expects. */
export function normalizeOpenMeteo(json) {
  const cur = json?.current || {}
  const hourly = json?.hourly || {}
  const times = hourly.time || []
  let hi = -1
  if (cur.time) {
    const hour = String(cur.time).slice(0, 13)
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
    // The provider's clock for this reading. Not a forecast interval — the
    // request is current conditions, and a window invented here would be a
    // time the service did not send.
    observedAt: typeof cur.time === 'string' ? cur.time.trim() : '',
  }
}

export async function fetchObservation(lat, lng, fetchImpl = globalThis.fetch) {
  const url = forecastUrl(lat, lng)
  if (!url) return null
  try {
    const resp = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!resp.ok) return null
    return normalizeOpenMeteo(await resp.json())
  } catch {
    return null
  }
}

// One HTTP call can name many coordinates. The free tier still counts each
// location against 600/minute and 10,000/day, and a batch large enough to be
// worth it has been observed to hang until the client gives up. Ten is the
// size that stays a short request; a failure splits it rather than retrying
// the same hung call. The provider snaps each coordinate onto its model grid,
// so the response latitude is not the one we sent — rows are matched by order.
export const GRID_BATCH = 10
export const FETCH_CONCURRENCY = 3
export const LOCATIONS_PER_MINUTE = 400
const MAX_ATTEMPTS = 4
const BACKOFF_CAP_MS = 20_000
const USER_AGENT = 'OHSMS-weather-digest/1.0 (contact: info@weehs.org)'

export function forecastBody(points) {
  const lats = points.map((p) => Number(p.lat).toFixed(2)).join(',')
  const lngs = points.map((p) => Number(p.lng).toFixed(2)).join(',')
  return (
    `latitude=${lats}&longitude=${lngs}` +
    '&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m' +
    '&hourly=visibility,uv_index&wind_speed_unit=kmh&timezone=auto&forecast_days=1'
  )
}

function retryAfterMs(headers) {
  const raw = headers?.get?.('retry-after')
  if (raw == null || raw === '') return 0
  const seconds = Number(raw)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const when = Date.parse(raw)
  if (Number.isNaN(when)) return 0
  return Math.max(0, when - Date.now())
}

/**
 * One forecast request for `points`, in that order. `split` means the caller
 * should halve the batch instead of repeating it: a 429 is the minute budget,
 * and splitting only spends it faster.
 */
export async function requestForecast(points, fetchImpl = globalThis.fetch) {
  try {
    const resp = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
      },
      body: forecastBody(points),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const wait = retryAfterMs(resp.headers)
    if (!resp.ok) {
      const rateLimited = resp.status === 429
      const transient = rateLimited || resp.status === 408 || resp.status >= 500
      return { ok: false, retry: transient, split: transient && !rateLimited, retryAfterMs: wait }
    }
    const json = await resp.json()
    if (json?.error) return { ok: false, retry: false, split: false, retryAfterMs: 0 }
    const rows = Array.isArray(json) ? json : [json]
    if (rows.length !== points.length) {
      return { ok: false, retry: true, split: points.length > 1, retryAfterMs: 0 }
    }
    const observations = new Map()
    points.forEach((point, i) => {
      const obs = normalizeOpenMeteo(rows[i])
      const readable =
        obs &&
        [
          obs.tempC,
          obs.apparentTempC,
          obs.windKph,
          obs.gustKph,
          obs.precipMmHr,
          obs.weatherCode,
        ].some((value) => value != null)
      if (readable) observations.set(point.key, obs)
    })
    return { ok: true, observations }
  } catch {
    return { ok: false, retry: true, split: true, retryAfterMs: 0 }
  }
}

/**
 * Readings for every point that succeeded. Failures are listed so the caller
 * can try them on a later pass instead of describing them as clear.
 * `until` stops this invocation before the function timeout; the keys left
 * in `failed` are not a final answer.
 */
export async function fetchGrids(points, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const now = options.now || (() => Date.now())
  const onProgress = options.onProgress || (async () => {})
  const until = options.until ?? now() + 8 * 60 * 1000
  const observations = new Map()
  const failed = []
  const queue = []
  for (let i = 0; i < (points || []).length; i += GRID_BATCH) {
    queue.push(points.slice(i, i + GRID_BATCH))
  }
  const pace = { nextAt: 0 }
  let coolOffUntil = 0
  const gap = 60_000 / LOCATIONS_PER_MINUTE

  // Reserve before sleeping. Two workers awaiting a sleep would otherwise
  // both read the same nextAt and start together, which is how a paced
  // fleet walks into the 600-a-minute cap.
  function reserve(count) {
    const start = Math.max(pace.nextAt, coolOffUntil, now())
    pace.nextAt = start + count * gap
    return start - now()
  }

  async function take(count) {
    const wait = reserve(count)
    if (wait > 0) await sleep(wait)
  }

  async function one(chunk) {
    if (now() >= until) {
      for (const point of chunk) failed.push(point.key)
      return
    }
    let attempt = 0
    while (attempt < MAX_ATTEMPTS) {
      await take(chunk.length)
      const result = await requestForecast(chunk, fetchImpl)
      await onProgress()
      if (result.ok) {
        for (const point of chunk) {
          if (result.observations.has(point.key)) {
            observations.set(point.key, result.observations.get(point.key))
          } else failed.push(point.key)
        }
        return
      }
      if (result.retryAfterMs) {
        coolOffUntil = Math.max(coolOffUntil, now() + Math.min(result.retryAfterMs, BACKOFF_CAP_MS))
      }
      if (result.split && chunk.length > 1) {
        const mid = Math.ceil(chunk.length / 2)
        queue.push(chunk.slice(0, mid), chunk.slice(mid))
        return
      }
      if (!result.retry) break
      attempt += 1
      if (attempt < MAX_ATTEMPTS && !result.retryAfterMs) {
        await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000))
      }
    }
    for (const point of chunk) failed.push(point.key)
  }

  async function worker() {
    while (queue.length) {
      const chunk = queue.shift()
      if (chunk?.length) await one(chunk)
    }
  }

  const workers = Math.min(FETCH_CONCURRENCY, queue.length)
  if (workers) await Promise.all(Array.from({ length: workers }, () => worker()))
  return { observations, failed }
}

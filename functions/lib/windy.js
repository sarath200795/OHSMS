// Current conditions for a coordinate, from the Windy Point Forecast API.
//
// POST https://api.windy.com/api/point-forecast/v2. One coordinate per call.
// The key travels in the JSON body, never in the URL, and never back to the
// browser: the digest reads WINDY_API_KEY here, and the site screen calls the
// fetchSiteWeather function, which does the same. A missing key is a failed
// read, not a calm site.
//
// Coordinates are rounded to two decimals (~1 km) before they leave. The
// weather is the same at that resolution, and the exact position of a
// workplace is not part of the request. The site name, org and id are not
// either.
//
// Two models, because one model does not carry every alert:
//   icon — global weather. Temperature, humidity, the 3-hour precipitation
//     column, CAPE, and weatherWarnings. Codes 95 and 96 on that warning are
//     a thunderstorm. ICON is the only global model here that has them.
//   gfs — the same weather fields except the warning, used when ICON has
//     nothing for the point. Lightning then rests on CAPE alone.
//   cams — global air quality. `aqi` is the US AQI (aqi_us, 0–500). When that
//     series is missing, PM2.5 and PM10 are converted with the US EPA
//     breakpoints, which are the same 0–500 scale, and the worse one is kept.
//
// Windy does not return a feels-like temperature. Apparent temperature is the
// Bureau of Meteorology form of Steadman, from air temperature, humidity and
// wind, so the existing heat and cold cuts still have a feels-like to read.
// Wind is fetched only for that. It is not an alert.
//
// Precipitation is `past3hprecip`: the water column for the preceding three
// hours, not a rate. The rain cuts are mm/h, so the column is turned into
// millimetres and divided by three. A metre column is scaled up first. That
// is the same correction the Open-Meteo 15-minute sum needed: a total read
// as a rate drops a wet hour under the mail line.
//
// A failure is null. The digest must not treat "the provider was down" as
// "no elevated risk".

const ENDPOINT = 'https://api.windy.com/api/point-forecast/v2'
const TIMEOUT_MS = 12_000

export const WEATHER_MODEL = 'icon'
export const FALLBACK_MODEL = 'gfs'
export const AIR_MODEL = 'cams'

// `wind` is for feels-like only. `weatherWarnings` is ICON's thunderstorm
// code. Neither visibility nor UV is requested.
export const WEATHER_PARAMETERS = [
  'temp',
  'dewpoint',
  'rh',
  'precip',
  'wind',
  'cape',
  'weatherWarnings',
]
export const FALLBACK_PARAMETERS = ['temp', 'dewpoint', 'rh', 'precip', 'wind', 'cape']
export const AIR_PARAMETERS = ['aqi', 'pm2p5', 'pm10']

export const FETCH_CONCURRENCY = 3
const MAX_ATTEMPTS = 4
const BACKOFF_CAP_MS = 20_000

// US EPA breakpoint rows: [concLow, concHigh, indexLow, indexHigh]. Used only
// when CAMS does not send `aqi`. The occupational bands applied later are not
// these EPA category names.
const PM25_BREAKS = [
  [0.0, 12.0, 0, 50],
  [12.1, 35.4, 51, 100],
  [35.5, 55.4, 101, 150],
  [55.5, 150.4, 151, 200],
  [150.5, 250.4, 201, 300],
  [250.5, 350.4, 301, 400],
  [350.5, 500.4, 401, 500],
]
const PM10_BREAKS = [
  [0, 54, 0, 50],
  [55, 154, 51, 100],
  [155, 254, 101, 150],
  [255, 354, 151, 200],
  [355, 424, 201, 300],
  [425, 504, 301, 400],
  [505, 604, 401, 500],
]

export function gridKey(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return ''
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return ''
  return `${lat.toFixed(2)},${lng.toFixed(2)}`
}

/** The JSON body that would be posted. Exported so a test can see what leaves. */
export function pointBody(lat, lng, model, parameters, apiKey) {
  const key = gridKey(lat, lng)
  if (!key || typeof apiKey !== 'string' || !apiKey.trim()) return null
  const [gLat, gLng] = key.split(',')
  return {
    lat: Number(gLat),
    lon: Number(gLng),
    model,
    parameters,
    levels: ['surface'],
    key: apiKey,
  }
}

function pick(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Latest step at or before `now`. A series that is entirely in the future uses the first step. */
export function stepIndex(ts, now) {
  if (!Array.isArray(ts) || !ts.length) return -1
  let best = -1
  for (let i = 0; i < ts.length; i += 1) {
    const raw = Number(ts[i])
    if (!Number.isFinite(raw)) continue
    const ms = raw < 1e12 ? raw * 1000 : raw
    if (ms <= now) best = i
  }
  return best >= 0 ? best : 0
}

function valueAt(series, idx) {
  if (!Array.isArray(series) || idx < 0) return null
  for (let i = idx; i >= 0; i -= 1) {
    const v = pick(series[i])
    if (v != null) return v
  }
  for (let i = idx + 1; i < series.length; i += 1) {
    const v = pick(series[i])
    if (v != null) return v
  }
  return null
}

function unitOf(json, name) {
  const unit = json?.units?.[name]
  return typeof unit === 'string' ? unit : ''
}

export function toCelsius(value, unit) {
  const n = pick(value)
  if (n == null) return null
  const u = String(unit || '').trim()
  if (u === 'K' || u.startsWith('K') || (!u && n > 150)) return n - 273.15
  return n
}

function toMs(value, unit) {
  const n = pick(value)
  if (n == null) return null
  const u = String(unit || '')
  if (/km/i.test(u)) return n / 3.6
  if (/kt|knot/i.test(u)) return n * 0.514444
  return n
}

/**
 * Millimetres per hour from Windy's precipitation column.
 * A 3-hour accumulation is divided by 3. A unit that is already a rate
 * (`mm*h-1`) is left alone. Metres become millimetres first.
 */
export function precipRateMmHr(value, unit) {
  const n = pick(value)
  if (n == null || n < 0) return null
  const u = String(unit || '').replace(/\s+/g, '')
  let mm = n
  if (u === 'm' || /^m[*/]/.test(u)) mm = n * 1000
  else if (/^in/i.test(u)) mm = n * 25.4
  if (/h-1|\/h/i.test(u)) return mm
  return mm / 3
}

function toMicrograms(value, unit) {
  const n = pick(value)
  if (n == null || n < 0) return null
  const u = String(unit || '').toLowerCase()
  if (u.includes('kg')) return n * 1e9
  if (u.includes('mg')) return n * 1000
  return n
}

function subIndex(conc, rows) {
  if (conc == null || !Number.isFinite(conc) || conc < 0) return null
  let row = rows.find((r) => conc >= r[0] && conc <= r[1])
  if (!row) row = conc > rows[rows.length - 1][1] ? rows[rows.length - 1] : rows[0]
  const [cLo, cHi, iLo, iHi] = row
  if (conc > cHi) return 500
  const index = ((iHi - iLo) / (cHi - cLo)) * (conc - cLo) + iLo
  return Math.round(Math.min(500, Math.max(0, index)))
}

/** US AQI (0–500) from particle concentrations, the worse of the two. */
export function aqiFromParticles(pm25, pm10) {
  const parts = [subIndex(pm25, PM25_BREAKS), subIndex(pm10, PM10_BREAKS)].filter((n) => n != null)
  if (!parts.length) return null
  return Math.max(...parts)
}

/**
 * Bureau of Meteorology apparent temperature (°C).
 * AT = Ta + 0.33e − 0.70ws − 4.00, with e from relative humidity.
 * Without humidity the air temperature is returned unchanged.
 */
export function apparentTemperatureC(tempC, rh, windMs) {
  if (tempC == null) return null
  if (rh == null) return tempC
  const vapour = (rh / 100) * 6.105 * Math.exp((17.27 * tempC) / (237.7 + tempC))
  const ws = windMs != null && windMs >= 0 ? windMs : 0
  return tempC + 0.33 * vapour - 0.7 * ws - 4
}

function humidity(tempC, rh, dewC) {
  if (rh != null) return Math.min(100, Math.max(0, rh))
  if (tempC == null || dewC == null) return null
  const sat = (t) => 6.105 * Math.exp((17.27 * t) / (237.7 + t))
  const value = (100 * sat(dewC)) / sat(tempC)
  if (!Number.isFinite(value)) return null
  return Math.min(100, Math.max(0, value))
}

function stamp(ts, idx) {
  if (!Array.isArray(ts) || idx < 0) return ''
  const raw = Number(ts[idx])
  if (!Number.isFinite(raw)) return ''
  const ms = raw < 1e12 ? raw * 1000 : raw
  return new Date(ms).toISOString()
}

/** Shape Windy's weather and air-quality payloads into the observation assessWeather expects. */
export function normalizeWindy(weather, air, now = Date.now()) {
  if (!weather && !air) return null
  const wIdx = stepIndex(weather?.ts, now)
  const aIdx = stepIndex(air?.ts, now)
  const atW = (name) => valueAt(weather?.[name], wIdx)
  const atA = (name) => valueAt(air?.[name], aIdx)

  const tempC = toCelsius(atW('temp-surface'), unitOf(weather, 'temp-surface'))
  const dewC = toCelsius(atW('dewpoint-surface'), unitOf(weather, 'dewpoint-surface'))
  const rh = humidity(tempC, pick(atW('rh-surface')), dewC)
  const u = toMs(atW('wind_u-surface'), unitOf(weather, 'wind_u-surface'))
  const v = toMs(atW('wind_v-surface'), unitOf(weather, 'wind_v-surface'))
  const windMs = u != null && v != null ? Math.hypot(u, v) : (u ?? v)
  const warning = pick(atW('weatherwarnings-surface'))
  const lightningCode = warning === 95 || warning === 96 ? warning : null

  let aqi = pick(atA('aqi_us-surface'))
  let aqiSource = ''
  if (aqi != null && aqi >= 0) aqiSource = 'aqi'
  else {
    const pm25 = toMicrograms(atA('pm2p5-surface'), unitOf(air, 'pm2p5-surface'))
    const pm10 = toMicrograms(atA('pm10-surface'), unitOf(air, 'pm10-surface'))
    aqi = aqiFromParticles(pm25, pm10)
    if (aqi != null) aqiSource = 'pm'
  }

  return {
    tempC,
    apparentTempC: apparentTemperatureC(tempC, rh, windMs),
    precipMmHr: precipRateMmHr(
      atW('past3hprecip-surface'),
      unitOf(weather, 'past3hprecip-surface')
    ),
    capeJkg: pick(atW('cape-surface')),
    lightningCode,
    aqi: aqi != null && aqi >= 0 ? aqi : null,
    aqiSource,
    observedAt: stamp(weather?.ts, wIdx) || stamp(air?.ts, aIdx),
  }
}

function readable(obs) {
  if (!obs) return false
  return [
    obs.tempC,
    obs.apparentTempC,
    obs.precipMmHr,
    obs.capeJkg,
    obs.lightningCode,
    obs.aqi,
  ].some((value) => value != null)
}

function hasWeather(json) {
  if (!json || typeof json !== 'object') return false
  return ['temp-surface', 'past3hprecip-surface', 'cape-surface', 'weatherwarnings-surface'].some(
    (name) => Array.isArray(json[name]) && json[name].some((v) => pick(v) != null)
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

async function postModel(point, model, parameters, apiKey, fetchImpl) {
  const body = pointBody(point.lat, point.lng, model, parameters, apiKey)
  if (!body) return { ok: false, retry: false, retryAfterMs: 0, json: null }
  try {
    const resp = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const wait = retryAfterMs(resp.headers)
    if (resp.status === 204)
      return { ok: false, empty: true, retry: false, retryAfterMs: 0, json: null }
    if (!resp.ok) {
      const rateLimited = resp.status === 429
      const transient = rateLimited || resp.status === 408 || resp.status >= 500
      return { ok: false, retry: transient, retryAfterMs: wait, json: null }
    }
    return { ok: true, json: await resp.json(), retryAfterMs: 0 }
  } catch {
    return { ok: false, retry: true, retryAfterMs: 0, json: null }
  }
}

async function loadWeather(point, apiKey, fetchImpl) {
  const icon = await postModel(point, WEATHER_MODEL, WEATHER_PARAMETERS, apiKey, fetchImpl)
  if (icon.retry && !hasWeather(icon.json)) return icon
  if (hasWeather(icon.json)) return icon
  const gfs = await postModel(point, FALLBACK_MODEL, FALLBACK_PARAMETERS, apiKey, fetchImpl)
  if (hasWeather(gfs.json)) return gfs
  if (gfs.retry && !hasWeather(gfs.json)) return gfs
  return icon.json ? icon : gfs
}

/**
 * One point. `retry` means the caller should wait and try again. A 429 does
 * not fall through to a second model: that only spends the same budget faster.
 */
export async function requestPoint(point, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const nowMs = typeof options.now === 'number' ? options.now : Date.now()
  const apiKey = options.apiKey || ''
  if (!apiKey || !point?.key) return { ok: false, retry: false, retryAfterMs: 0, obs: null }

  const weather = await loadWeather(point, apiKey, fetchImpl)
  if (weather.retry && !hasWeather(weather.json)) {
    return { ok: false, retry: true, retryAfterMs: weather.retryAfterMs || 0, obs: null }
  }
  const air = await postModel(point, AIR_MODEL, AIR_PARAMETERS, apiKey, fetchImpl)
  const obs = normalizeWindy(weather.json, air.json, nowMs)
  if (!readable(obs)) {
    if (air.retry || weather.retry) {
      return {
        ok: false,
        retry: true,
        retryAfterMs: air.retryAfterMs || weather.retryAfterMs || 0,
        obs: null,
      }
    }
    return { ok: true, obs: null, retryAfterMs: 0 }
  }
  return { ok: true, obs, retryAfterMs: air.retry ? air.retryAfterMs || 1000 : 0 }
}

/** One coordinate. Null when the key is missing, the point is invalid, or Windy did not answer. */
export async function fetchObservation(lat, lng, options = {}) {
  const key = gridKey(lat, lng)
  if (!key) return null
  const [la, ln] = key.split(',').map(Number)
  const result = await requestPoint({ key, lat: la, lng: ln }, options)
  return result.ok ? result.obs : null
}

/**
 * Readings for every point that succeeded. Failures are listed so the caller
 * can try them on a later pass instead of describing them as clear.
 * `until` stops this invocation before the function timeout.
 */
export async function fetchGrids(points, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const now = options.now || (() => Date.now())
  const onProgress = options.onProgress || (async () => {})
  const until = options.until ?? now() + 8 * 60 * 1000
  const apiKey = options.apiKey || ''
  const observations = new Map()
  const failed = []
  const queue = [...(points || [])]
  if (!apiKey) {
    for (const point of queue) if (point?.key) failed.push(point.key)
    return { observations, failed }
  }
  let coolOffUntil = 0

  async function one(point) {
    if (now() >= until) {
      failed.push(point.key)
      return
    }
    let attempt = 0
    while (attempt < MAX_ATTEMPTS) {
      const wait = Math.max(0, coolOffUntil - now())
      if (wait > 0) await sleep(Math.min(wait, BACKOFF_CAP_MS))
      if (now() >= until) {
        failed.push(point.key)
        return
      }
      const result = await requestPoint(point, { apiKey, fetchImpl, now: now() })
      await onProgress()
      if (result.retryAfterMs) {
        coolOffUntil = Math.max(coolOffUntil, now() + Math.min(result.retryAfterMs, BACKOFF_CAP_MS))
      }
      if (result.ok) {
        if (result.obs) observations.set(point.key, result.obs)
        else failed.push(point.key)
        return
      }
      if (!result.retry) break
      attempt += 1
      if (attempt < MAX_ATTEMPTS && !result.retryAfterMs) {
        await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000))
      }
    }
    failed.push(point.key)
  }

  async function worker() {
    while (queue.length) {
      const point = queue.shift()
      if (point?.key) await one(point)
    }
  }

  const workers = Math.min(FETCH_CONCURRENCY, queue.length)
  if (workers) await Promise.all(Array.from({ length: workers }, () => worker()))
  return { observations, failed }
}

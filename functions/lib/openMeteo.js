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

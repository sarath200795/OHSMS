// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { normalizeOpenMeteo, fetchWeather, _clearWeatherCache, _reloadWeatherCache } from './openMeteo'

// A trimmed real response. `hourly.time` starts at local midnight, which is the
// detail that makes index-0 the wrong reading to take.
const RESPONSE = {
  current: {
    time: '2026-08-03T14:00',
    temperature_2m: 34.2,
    apparent_temperature: 41.6,
    precipitation: 0.3,
    weather_code: 95,
    wind_speed_10m: 22.4,
    wind_gusts_10m: 48.9,
  },
  hourly: {
    time: ['2026-08-03T00:00', '2026-08-03T13:00', '2026-08-03T14:00', '2026-08-03T15:00'],
    visibility: [24000, 18000, 6000, 3000],
    uv_index: [0, 9.1, 8.4, 6.2],
  },
}

describe('normalizeOpenMeteo', () => {
  it('maps the current block onto the observation shape', () => {
    expect(normalizeOpenMeteo(RESPONSE)).toMatchObject({
      tempC: 34.2,
      apparentTempC: 41.6,
      precipMmHr: 0.3,
      windKph: 22.4,
      gustKph: 48.9,
      weatherCode: 95,
      observedAt: '2026-08-03T14:00',
    })
  })

  it('takes the hourly reading for the current hour, not the start of the series', () => {
    const obs = normalizeOpenMeteo(RESPONSE)
    expect(obs.visibilityM).toBe(6000) // 14:00, not 24000 at midnight
    expect(obs.uvIndex).toBe(8.4)
  })

  it('leaves hourly fields null when the current hour is not in the series', () => {
    const obs = normalizeOpenMeteo({ ...RESPONSE, current: { ...RESPONSE.current, time: '2026-08-03T23:00' } })
    expect(obs.visibilityM).toBeNull()
    expect(obs.uvIndex).toBeNull()
  })

  it('nulls non-numeric readings rather than passing them through', () => {
    const obs = normalizeOpenMeteo({ current: { temperature_2m: null, wind_speed_10m: 'calm', precipitation: 0 } })
    expect(obs.tempC).toBeNull()
    expect(obs.windKph).toBeNull()
    expect(obs.precipMmHr).toBe(0) // a real zero must survive
  })

  it('survives an empty or malformed payload', () => {
    for (const input of [undefined, null, {}, { current: null }]) {
      expect(() => normalizeOpenMeteo(input)).not.toThrow()
    }
  })
})

describe('fetchWeather', () => {
  beforeEach(() => {
    _clearWeatherCache()
    // The cool-off and the TTL are both clock-driven; shouldAdvanceTime keeps
    // awaited promises resolving normally while the tests move the clock.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => RESPONSE })))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('rounds the coordinate before sending it, so an exact workplace position never leaves', async () => {
    await fetchWeather(17.438765432, 78.398765432)
    const url = fetch.mock.calls[0][0]
    expect(url).toContain('latitude=17.44')
    expect(url).toContain('longitude=78.40')
    expect(url).not.toContain('17.438765')
  })

  it('sends nothing identifying beyond the coordinate', async () => {
    await fetchWeather(17.44, 78.4)
    const url = fetch.mock.calls[0][0]
    expect(url).not.toMatch(/org|site|name|user|uid|email/i)
  })

  it('asks for kmh so the wind thresholds do not have to guess a unit', async () => {
    await fetchWeather(17.44, 78.4)
    expect(fetch.mock.calls[0][0]).toContain('wind_speed_unit=kmh')
  })

  it('serves a repeat call for the same place from cache', async () => {
    await fetchWeather(17.44, 78.4)
    await fetchWeather(17.44, 78.4)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('treats nearby pins as one place — a map of one city is a handful of requests', async () => {
    await fetchWeather(17.4412, 78.3988) // same ~1 km square
    await fetchWeather(17.4437, 78.4021)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('still separates places that are genuinely apart', async () => {
    await fetchWeather(17.44, 78.4)
    await fetchWeather(19.07, 72.87)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('collapses concurrent hovers on the same place into one request', async () => {
    const [a, b, c] = await Promise.all([
      fetchWeather(17.44, 78.4), fetchWeather(17.44, 78.4), fetchWeather(17.44, 78.4),
    ])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(a).toEqual(b)
    expect(b).toEqual(c)
  })

  it('returns null instead of throwing when the service errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429 })))
    await expect(fetchWeather(1, 1)).resolves.toBeNull()
  })

  it('returns null instead of throwing when the network is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await expect(fetchWeather(2, 2)).resolves.toBeNull()
  })

  it('does not cache a failure, so the next hover retries', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await fetchWeather(3, 3)
    await fetchWeather(3, 3)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('stops asking after a 429 — a rate-limited service stays rate-limited', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429 })))
    await fetchWeather(4, 4)
    await fetchWeather(5, 5) // a different square, so not a cache hit
    await fetchWeather(6, 6)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('serves the last good reading through the cool-off rather than blanking the card', async () => {
    const good = await fetchWeather(7, 7)
    vi.setSystemTime(Date.now() + 16 * 60 * 1000) // the reading is now stale
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429 })))
    await fetchWeather(8, 8) // another square trips the cool-off
    expect(await fetchWeather(7, 7)).toEqual(good)
    expect(fetch).toHaveBeenCalledTimes(1) // the stale reading, not a new request
  })

  it('asks again once the cool-off has passed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429 })))
    await fetchWeather(9, 9)
    vi.setSystemTime(Date.now() + 61_000)
    await fetchWeather(10, 10)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('honours Retry-After when the service sends one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 429,
      headers: { get: (h) => (h === 'Retry-After' ? '600' : null) },
    })))
    await fetchWeather(11, 11)
    vi.setSystemTime(Date.now() + 5 * 60 * 1000) // inside the 10 minutes it asked for
    await fetchWeather(12, 12)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('survives a reload — the readings outlive the page, because the quota does', async () => {
    await fetchWeather(17.44, 78.4)
    expect(fetch).toHaveBeenCalledTimes(1)
    _reloadWeatherCache() // what a fresh page load sees
    await fetchWeather(17.44, 78.4)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('never carries a failure across a reload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })))
    await fetchWeather(13, 13)
    _reloadWeatherCache()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => RESPONSE })))
    expect(await fetchWeather(13, 13)).not.toBeNull()
  })

  it('makes no request at all for a site with no coordinates', async () => {
    for (const bad of [[undefined, undefined], [NaN, 1], [null, null], ['17.4', '78.4']]) {
      await expect(fetchWeather(bad[0], bad[1])).resolves.toBeNull()
    }
    expect(fetch).not.toHaveBeenCalled()
  })
})

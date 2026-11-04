import { beforeEach, describe, expect, it } from 'vitest'
import { fetchWeather, _clearWeatherCache, _setWeatherTransport } from './windy'
import { weatherSlot } from './observedAt'

beforeEach(() => {
  _clearWeatherCache()
  _setWeatherTransport(null)
})

describe('fetchWeather', () => {
  it('rounds to the ~1 km square and does not send a key or a site name', async () => {
    const seen = []
    _setWeatherTransport(async (lat, lng) => {
      seen.push({ lat, lng })
      return { tempC: 30 }
    })
    const obs = await fetchWeather(17.438765432, 78.398765432)
    expect(obs.tempC).toBe(30)
    expect(seen).toEqual([{ lat: 17.44, lng: 78.4 }])
  })

  it('reuses one square and one in-flight request', async () => {
    let calls = 0
    _setWeatherTransport(async () => {
      calls += 1
      return { tempC: 21 }
    })
    const [a, b] = await Promise.all([fetchWeather(17.441, 78.399), fetchWeather(17.442, 78.401)])
    expect(a).toEqual(b)
    expect(calls).toBe(1)
    await fetchWeather(17.44, 78.4)
    expect(calls).toBe(1)
  })

  it('does not cache a failure, and stands down after a rate limit', async () => {
    let calls = 0
    _setWeatherTransport(async () => {
      calls += 1
      if (calls === 1) return null
      return { limited: true }
    })
    expect(await fetchWeather(1, 1)).toBeNull()
    expect(await fetchWeather(1, 1)).toBeNull()
    expect(calls).toBe(2)
    const before = calls
    expect(await fetchWeather(2, 2)).toBeNull()
    expect(calls).toBe(before)
  })

  it('serves the last reading for a square while stood down', async () => {
    const seen = []
    _setWeatherTransport(async (lat) => {
      seen.push(lat)
      if (lat === 3) return { tempC: 18 }
      return { limited: true }
    })
    expect(await fetchWeather(3, 3)).toEqual({ tempC: 18 })
    expect(await fetchWeather(4, 4)).toBeNull()
    expect(seen).toEqual([3, 4])
    expect(await fetchWeather(3.001, 3.001)).toEqual({ tempC: 18 })
    expect(seen).toEqual([3, 4])
  })

  it('reuses a reading from the open slot', async () => {
    const slot = weatherSlot(new Date())
    let calls = 0
    _setWeatherTransport(async () => {
      calls += 1
      return { tempC: 21, slot }
    })
    expect(await fetchWeather(8, 8)).toMatchObject({ tempC: 21, slot })
    await fetchWeather(8, 8)
    expect(calls).toBe(1)
  })

  it('does not keep a reading from the previous slot', async () => {
    let calls = 0
    _setWeatherTransport(async () => {
      calls += 1
      return { tempC: 19, slot: '2000-01-01T00+0530' }
    })
    await fetchWeather(9, 9)
    await fetchWeather(9, 9)
    expect(calls).toBe(2)
  })

  it('refuses a coordinate that is not one', async () => {
    let calls = 0
    _setWeatherTransport(async () => {
      calls += 1
      return { tempC: 1 }
    })
    expect(await fetchWeather(Number.NaN, 1)).toBeNull()
    expect(await fetchWeather(1, undefined)).toBeNull()
    expect(calls).toBe(0)
  })
})

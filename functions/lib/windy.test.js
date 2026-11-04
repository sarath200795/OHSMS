import { describe, it, expect } from 'vitest'
import {
  gridKey,
  pointBody,
  stepIndex,
  toCelsius,
  precipRateMmHr,
  apparentTemperatureC,
  aqiFromParticles,
  normalizeWindy,
  fetchGrids,
  WEATHER_PARAMETERS,
  AIR_PARAMETERS,
  WEATHER_MODEL,
  AIR_MODEL,
  FALLBACK_MODEL,
} from './windy.js'

const ENDPOINT = 'https://api.windy.com/api/point-forecast/v2'
const KEY = 'test-key'
const NOW = Date.parse('2026-09-23T06:30:00.000Z')

function response({ status = 200, json = null, retryAfter } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        if (name.toLowerCase() === 'retry-after' && retryAfter != null) return String(retryAfter)
        return null
      },
    },
    async json() {
      return json
    },
  }
}

function weatherJson({
  tempK = 303.15,
  rh = 50,
  precip = 0,
  precipUnit = 'mm',
  cape = 100,
  warning = 0,
  ts = [NOW - 3_600_000, NOW - 60_000, NOW + 3_600_000],
  temps,
} = {}) {
  return {
    ts,
    units: {
      'temp-surface': 'K',
      'rh-surface': '%',
      'past3hprecip-surface': precipUnit,
      'cape-surface': 'J*kg-1',
      'wind_u-surface': 'm*s-1',
      'wind_v-surface': 'm*s-1',
      'dewpoint-surface': 'K',
    },
    'temp-surface': temps || [tempK, tempK, tempK],
    'rh-surface': [rh, rh, rh],
    'past3hprecip-surface': [0, precip, 0],
    'cape-surface': [0, cape, 0],
    'wind_u-surface': [3, 0, 0],
    'wind_v-surface': [4, 0, 0],
    'dewpoint-surface': [290, 290, 290],
    'weatherwarnings-surface': [0, warning, 0],
  }
}

function airJson(aqi = 40, extra = {}) {
  return {
    ts: [NOW - 60_000],
    units: { 'aqi_us-surface': null, 'pm2p5-surface': 'µg*m-3', 'pm10-surface': 'µg*m-3' },
    'aqi_us-surface': [aqi],
    ...extra,
  }
}

describe('what leaves for Windy', () => {
  it('rounds to ~1 km and keeps the key in the body, not the URL', () => {
    const body = pointBody(17.43821, 78.3912, WEATHER_MODEL, WEATHER_PARAMETERS, KEY)
    expect(body.lat).toBe(17.44)
    expect(body.lon).toBe(78.39)
    expect(body.key).toBe(KEY)
    expect(body.model).toBe('icon')
    expect(body.parameters).toEqual(WEATHER_PARAMETERS)
    expect(body.parameters).not.toContain('visibility')
    expect(JSON.stringify(body)).not.toContain('Plant')
    expect(gridKey(91, 0)).toBe('')
    expect(pointBody(17.44, 78.39, 'gfs', ['temp'], '')).toBeNull()
  })

  it('asks CAMS for AQI and the particle fallback, not a weather field', () => {
    const body = pointBody(17.44, 78.39, AIR_MODEL, AIR_PARAMETERS, KEY)
    expect(body.parameters).toEqual(['aqi', 'pm2p5', 'pm10'])
  })
})

describe('units', () => {
  it('turns Kelvin into Celsius and leaves Celsius alone', () => {
    expect(toCelsius(303.15, 'K')).toBeCloseTo(30, 5)
    expect(toCelsius(30, 'C')).toBe(30)
  })

  it('turns a 3-hour column into mm/h, including a metre column', () => {
    expect(precipRateMmHr(12, 'mm')).toBeCloseTo(4, 5)
    expect(precipRateMmHr(0.012, 'm')).toBeCloseTo(4, 5)
    expect(precipRateMmHr(4, 'mm*h-1')).toBe(4)
    expect(precipRateMmHr(0, 'mm')).toBe(0)
  })

  it('computes a feels-like from temperature and humidity', () => {
    expect(apparentTemperatureC(30, null, 0)).toBe(30)
    expect(apparentTemperatureC(30, 50, 0)).toBeCloseTo(32.98, 1)
  })

  it('builds an AQI from particles when the index itself is missing', () => {
    expect(aqiFromParticles(12, null)).toBe(50)
    expect(aqiFromParticles(55.5, 10)).toBe(151)
    expect(aqiFromParticles(null, 505)).toBe(401)
    expect(aqiFromParticles(null, null)).toBeNull()
  })
})

describe('normalizeWindy', () => {
  it('reads the step for now, not the one still ahead', () => {
    const obs = normalizeWindy(
      weatherJson({
        temps: [280, 303.15, 320],
        precip: 12,
        cape: 1800,
        warning: 0,
      }),
      airJson(80),
      NOW
    )
    expect(obs.tempC).toBeCloseTo(30, 5)
    expect(obs.precipMmHr).toBeCloseTo(4, 5)
    expect(obs.capeJkg).toBe(1800)
    expect(obs.lightningCode).toBeNull()
    expect(obs.aqi).toBe(80)
    expect(obs.aqiSource).toBe('aqi')
    expect(obs.observedAt).toBe(new Date(NOW - 60_000).toISOString())
    expect(obs.visibilityM).toBeUndefined()
    expect(obs.uvIndex).toBeUndefined()
  })

  it('keeps a thunderstorm code and prefers the published AQI over particles', () => {
    const obs = normalizeWindy(
      weatherJson({ warning: 95, cape: 400 }),
      {
        ts: [NOW],
        units: { 'pm2p5-surface': 'µg*m-3' },
        'aqi_us-surface': [30],
        'pm2p5-surface': [400],
      },
      NOW
    )
    expect(obs.lightningCode).toBe(95)
    expect(obs.aqi).toBe(30)
    expect(obs.aqiSource).toBe('aqi')
  })

  it('falls back to particles, in micrograms, when AQI is absent', () => {
    const obs = normalizeWindy(
      null,
      {
        ts: [NOW],
        units: { 'pm2p5-surface': 'kg*m-3' },
        'pm2p5-surface': [100e-9],
      },
      NOW
    )
    expect(obs.aqiSource).toBe('pm')
    expect(obs.aqi).toBe(174)
    expect(obs.tempC).toBeNull()
  })

  it('uses the first step when every stamp is still in the future', () => {
    expect(stepIndex([NOW + 1000, NOW + 2000], NOW)).toBe(0)
  })
})

describe('fetchGrids', () => {
  const points = [
    { key: '17.44,78.39', lat: 17.438, lng: 78.391 },
    { key: '13.08,80.27', lat: 13.08, lng: 80.27 },
  ]

  function scripted(handler) {
    const calls = []
    const fetchImpl = async (url, init) => {
      expect(url).toBe(ENDPOINT)
      expect(url).not.toContain(KEY)
      const body = JSON.parse(init.body)
      expect(body.key).toBe(KEY)
      calls.push(body)
      return handler(body, calls)
    }
    return { calls, fetchImpl }
  }

  it('posts one point at a time and does not put the key in the URL', async () => {
    const { calls, fetchImpl } = scripted((body) => {
      if (body.model === AIR_MODEL) return response({ json: airJson(42) })
      return response({ json: weatherJson({ tempK: body.lat > 15 ? 303.15 : 301.15 }) })
    })
    const { observations, failed } = await fetchGrids(points, {
      apiKey: KEY,
      sleep: async () => {},
      now: () => NOW,
      fetchImpl,
    })
    expect(failed).toEqual([])
    expect(observations.get('17.44,78.39').tempC).toBeCloseTo(30, 4)
    expect(observations.get('13.08,80.27').aqi).toBe(42)
    expect(calls.some((body) => body.model === WEATHER_MODEL)).toBe(true)
    expect(calls.some((body) => body.model === AIR_MODEL)).toBe(true)
    expect(calls.every((body) => body.lat === 17.44 || body.lat === 13.08)).toBe(true)
  })

  it('retries a 429 on the same point and does not open the fallback model', async () => {
    let iconAttempts = 0
    const slept = []
    const { calls, fetchImpl } = scripted((body) => {
      if (body.model === WEATHER_MODEL) {
        iconAttempts += 1
        if (iconAttempts === 1) return response({ status: 429, retryAfter: 2 })
      }
      if (body.model === FALLBACK_MODEL) return response({ status: 500 })
      if (body.model === AIR_MODEL) return response({ json: airJson(10) })
      return response({ json: weatherJson({ cape: 2600 }) })
    })
    const { observations, failed } = await fetchGrids([points[0]], {
      apiKey: KEY,
      sleep: async (ms) => {
        slept.push(ms)
      },
      now: () => NOW,
      fetchImpl,
    })
    expect(failed).toEqual([])
    expect(observations.get('17.44,78.39').capeJkg).toBe(2600)
    expect(calls.filter((body) => body.model === FALLBACK_MODEL)).toHaveLength(0)
    expect(slept).toContain(2000)
  })

  it('uses GFS when ICON has no data for the point', async () => {
    const { calls, fetchImpl } = scripted((body) => {
      if (body.model === WEATHER_MODEL) return response({ status: 204 })
      if (body.model === FALLBACK_MODEL) return response({ json: weatherJson({ tempK: 313.15 }) })
      return response({ json: airJson(null) })
    })
    const { observations, failed } = await fetchGrids([points[0]], {
      apiKey: KEY,
      sleep: async () => {},
      now: () => NOW,
      fetchImpl,
    })
    expect(failed).toEqual([])
    expect(observations.get('17.44,78.39').tempC).toBeCloseTo(40, 4)
    expect(calls.map((body) => body.model)).toEqual([WEATHER_MODEL, FALLBACK_MODEL, AIR_MODEL])
  })

  it('does not call Windy when the key is missing, and does not call the points clear', async () => {
    let called = false
    const { observations, failed } = await fetchGrids(points, {
      apiKey: '',
      fetchImpl: async () => {
        called = true
        return response({})
      },
    })
    expect(called).toBe(false)
    expect(observations.size).toBe(0)
    expect(failed).toEqual(['17.44,78.39', '13.08,80.27'])
  })
})

import { describe, it, expect } from 'vitest'
import { fetchGrids, requestForecast, forecastBody } from './openMeteo.js'

function response({ status = 200, json = null, retryAfter, throwError = false } = {}) {
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
      if (throwError) throw new Error('empty')
      return json
    },
  }
}

describe('forecast batches', () => {
  it('matches rows by request order when the provider snaps the coordinates', async () => {
    const points = [
      { key: '17.44,78.39', lat: 17.44, lng: 78.39 },
      { key: '13.08,80.27', lat: 13.08, lng: 80.27 },
    ]
    let body = ''
    const result = await requestForecast(points, async (_url, init) => {
      body = init.body
      return response({
        json: [
          {
            latitude: 17.47,
            longitude: 78.36,
            current: { temperature_2m: 30, wind_speed_10m: 10 },
          },
          {
            latitude: 13.11,
            longitude: 80.25,
            current: { temperature_2m: 28, wind_speed_10m: 40 },
          },
        ],
      })
    })
    expect(body).toContain('latitude=17.44,13.08')
    expect(body).toContain('longitude=78.39,80.27')
    expect(result.observations.get('17.44,78.39').tempC).toBe(30)
    expect(result.observations.get('13.08,80.27').windKph).toBe(40)
  })

  it('retries a 429 and does not split it into more requests', async () => {
    const points = [
      { key: '17.44,78.39', lat: 17.44, lng: 78.39 },
      { key: '13.08,80.27', lat: 13.08, lng: 80.27 },
    ]
    const bodies = []
    const slept = []
    let calls = 0
    const { observations, failed } = await fetchGrids(points, {
      sleep: async (ms) => {
        slept.push(ms)
      },
      now: () => 1_000_000,
      fetchImpl: async (_url, init) => {
        calls += 1
        bodies.push(init.body)
        if (calls === 1) return response({ status: 429, retryAfter: 2 })
        return response({
          json: [{ current: { wind_speed_10m: 55 } }, { current: { wind_speed_10m: 40 } }],
        })
      },
    })
    expect(calls).toBe(2)
    expect(bodies).toHaveLength(2)
    expect(bodies[0]).toBe(forecastBody(points))
    expect(bodies[1]).toBe(bodies[0])
    expect(failed).toEqual([])
    expect(observations.get('17.44,78.39').windKph).toBe(55)
    expect(slept).toContain(2000)
  })

  it('splits a timed-out batch down to single locations', async () => {
    const points = [
      { key: '17.44,78.39', lat: 17.44, lng: 78.39 },
      { key: '13.08,80.27', lat: 13.08, lng: 80.27 },
    ]
    const sizes = []
    const { observations, failed } = await fetchGrids(points, {
      sleep: async () => {},
      now: () => 0,
      fetchImpl: async (_url, init) => {
        const count = init.body.split('latitude=')[1].split('&')[0].split(',').length
        sizes.push(count)
        if (count > 1) throw new Error('timed out')
        const lat = init.body.includes('17.44') ? 55 : 40
        return response({ json: { current: { wind_speed_10m: lat } } })
      },
    })
    expect(sizes[0]).toBe(2)
    expect(sizes.filter((n) => n === 1)).toHaveLength(2)
    expect(failed).toEqual([])
    expect(observations.size).toBe(2)
  })
})

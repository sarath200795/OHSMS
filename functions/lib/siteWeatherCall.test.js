import { describe, expect, it, vi } from 'vitest'
import { cachedObservation } from './weatherCacheDoc.js'
import {
  WEATHER_FETCH_LIMIT,
  callerReachesPoint,
  countWeatherFetch,
  decideWeatherCaller,
  serveSiteWeather,
} from './siteWeatherCall.js'

const NOW = Date.parse('2026-09-23T05:30:00.000Z')
const SLOT = '2026-09-23T12+0530'

const approved = (over = {}) => ({
  orgId: 'orgA',
  role: 'member',
  status: 'approved',
  siteId: 's1',
  ...over,
})

const site = (over = {}) => ({
  id: 's1',
  lat: 17.438,
  lng: 78.391,
  region: 'South',
  entity: 'COCO',
  ...over,
})

function provider() {
  const calls = []
  const fetchImpl = vi.fn(async (url, init) => {
    calls.push({ url: String(url), timeout: init?.signal })
    const hourly = {
      time: [Math.floor(NOW / 1000) - 60],
      temperature_2m: [31],
      relative_humidity_2m: [40],
      precipitation: [0],
      cape: [100],
      weather_code: [0],
      wind_speed_10m: [1],
      us_aqi: [42],
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ hourly }),
    }
  })
  return { fetchImpl, calls }
}

function harness(over = {}) {
  const net = provider()
  const profile = over.profile === undefined ? approved() : over.profile
  const env = {
    uid: over.uid === undefined ? 'u1' : over.uid,
    data: over.data === undefined ? { lat: 17.438, lng: 78.391 } : over.data,
    loadProfile: vi.fn(async () => profile),
    orgExists: vi.fn(async () => over.orgExists !== false),
    loadSites: vi.fn(async () => over.sites || [site()]),
    cache: over.cache || {
      async get() {
        return null
      },
      async set() {},
    },
    fetchImpl: over.fetchImpl || net.fetchImpl,
    takeRate: over.takeRate || vi.fn(async () => true),
    nowMs: NOW,
    slot: SLOT,
  }
  return { env, net }
}

describe('decideWeatherCaller', () => {
  it('accepts an approved member and refuses the gates the other callables use', () => {
    expect(decideWeatherCaller(approved()).ok).toBe(true)
    expect(decideWeatherCaller(null).code).toBe('permission-denied')
    expect(decideWeatherCaller(approved({ status: 'pending' })).code).toBe('permission-denied')
    expect(decideWeatherCaller(approved({ status: 'suspended' })).code).toBe('permission-denied')
    expect(decideWeatherCaller(approved({ orgId: '' })).code).toBe('permission-denied')
    expect(decideWeatherCaller(approved({ mustChangePassword: true })).code).toBe(
      'permission-denied'
    )
    expect(decideWeatherCaller(approved({ mustChangePassword: false })).ok).toBe(true)
  })
})

describe('callerReachesPoint', () => {
  it('allows a posting, a grant and an admin, and refuses another site', () => {
    const key = '17.44,78.39'
    expect(callerReachesPoint(approved(), [site()], key)).toBe(true)
    expect(
      callerReachesPoint(approved({ siteId: '', access: { regions: ['South'] } }), [site()], key)
    ).toBe(true)
    expect(callerReachesPoint(approved({ role: 'admin', siteId: '' }), [site()], key)).toBe(true)
    expect(callerReachesPoint(approved({ siteId: 's2' }), [site()], key)).toBe(false)
    expect(callerReachesPoint(approved(), [site({ lat: 1, lng: 1 })], key)).toBe(false)
  })
})

describe('countWeatherFetch', () => {
  it('allows up to the window and then stops without growing the list', () => {
    let state = {}
    for (let i = 0; i < WEATHER_FETCH_LIMIT; i += 1) {
      const next = countWeatherFetch(state, NOW + i)
      expect(next.allowed).toBe(true)
      state = next
    }
    const blocked = countWeatherFetch(state, NOW + WEATHER_FETCH_LIMIT)
    expect(blocked.allowed).toBe(false)
    expect(blocked.stamps).toHaveLength(WEATHER_FETCH_LIMIT)
  })
})

describe('serveSiteWeather', () => {
  it('refuses a signed-out caller before reading a profile', async () => {
    const { env, net } = harness({ uid: '' })
    const result = await serveSiteWeather(env)
    expect(result.error).toBe('unauthenticated')
    expect(env.loadProfile).not.toHaveBeenCalled()
    expect(net.fetchImpl).not.toHaveBeenCalled()
  })

  it.each([
    ['missing', null],
    ['pending', approved({ status: 'pending' })],
    ['suspended', approved({ status: 'suspended' })],
    ['password', approved({ mustChangePassword: true })],
  ])('refuses a %s profile without calling the provider', async (_name, profile) => {
    const { env, net } = harness({ profile })
    const result = await serveSiteWeather(env)
    expect(result.error).toBe('permission-denied')
    expect(net.fetchImpl).not.toHaveBeenCalled()
    expect(env.loadSites).not.toHaveBeenCalled()
  })

  it('refuses an organization that is not there', async () => {
    const { env, net } = harness({ orgExists: false })
    const result = await serveSiteWeather(env)
    expect(result.error).toBe('failed-precondition')
    expect(net.fetchImpl).not.toHaveBeenCalled()
  })

  it('refuses a coordinate that is not a site this profile can view', async () => {
    const { env, net } = harness({ data: { lat: 1, lng: 1 } })
    const result = await serveSiteWeather(env)
    expect(result.error).toBe('permission-denied')
    expect(net.fetchImpl).not.toHaveBeenCalled()
  })

  it('refuses a site in the org that this member cannot reach', async () => {
    const { env, net } = harness({
      profile: approved({ siteId: 's9' }),
      sites: [site({ id: 's1' })],
    })
    const result = await serveSiteWeather(env)
    expect(result.error).toBe('permission-denied')
    expect(net.fetchImpl).not.toHaveBeenCalled()
  })

  it('refuses coordinates that are not a place', async () => {
    const { env, net } = harness({ data: { lat: 91, lng: 0 } })
    const result = await serveSiteWeather(env)
    expect(result.error).toBe('invalid-argument')
    expect(env.loadSites).not.toHaveBeenCalled()
    expect(net.fetchImpl).not.toHaveBeenCalled()
  })

  it('returns a cached reading without the provider or the rate counter', async () => {
    const takeRate = vi.fn()
    const { env, net } = harness({
      takeRate,
      cache: {
        async get() {
          return { slot: SLOT, obs: { tempC: 29, slot: SLOT } }
        },
        async set() {},
      },
    })
    const result = await serveSiteWeather(env)
    expect(result.body.obs.tempC).toBe(29)
    expect(net.fetchImpl).not.toHaveBeenCalled()
    expect(takeRate).not.toHaveBeenCalled()
    expect(cachedObservation({ slot: SLOT, obs: { tempC: 29 } }, SLOT).tempC).toBe(29)
  })

  it('asks Open-Meteo only on its own hosts for a site the member can view', async () => {
    const { env, net } = harness()
    const result = await serveSiteWeather(env)
    expect(result.error).toBeUndefined()
    expect(result.body.obs.tempC).toBe(31)
    expect(net.fetchImpl).toHaveBeenCalled()
    for (const call of net.calls) {
      const url = new URL(call.url)
      expect(['api.open-meteo.com', 'air-quality-api.open-meteo.com']).toContain(url.hostname)
      expect(url.protocol).toBe('https:')
      expect(url.searchParams.get('latitude')).toBe('17.44')
      expect(url.searchParams.get('longitude')).toBe('78.39')
      expect(call.timeout).toBeTruthy()
    }
  })

  it('denies a rate limit before the provider is called', async () => {
    const { env, net } = harness({ takeRate: async () => false })
    const result = await serveSiteWeather(env)
    expect(result.body).toEqual({ obs: null, limited: true })
    expect(net.fetchImpl).not.toHaveBeenCalled()
  })

  it('reports a provider failure as a limited empty reading', async () => {
    const { env } = harness({
      fetchImpl: async () => {
        throw new Error('timed out')
      },
    })
    const result = await serveSiteWeather(env)
    expect(result.body).toEqual({ obs: null, limited: true })
  })
})

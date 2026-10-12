import { describe, it, expect } from 'vitest'
import { haversineKm, siteCoords, nearestSites, formatKm } from './geo.js'

// Fake sites around a made-up point; ~0.009° lat ≈ 1 km.
const at = (id, lat, lng, name = id) => ({ id, name, code: id.toUpperCase(), lat, lng })

describe('haversineKm', () => {
  it('is zero for the same point and symmetric', () => {
    expect(haversineKm(12.97, 77.59, 12.97, 77.59)).toBe(0)
    expect(haversineKm(12, 77, 13, 78)).toBeCloseTo(haversineKm(13, 78, 12, 77), 9)
  })
  it('matches a known distance (one degree of latitude ≈ 111.2 km)', () => {
    expect(haversineKm(10, 77, 11, 77)).toBeCloseTo(111.19, 1)
  })
})

describe('siteCoords', () => {
  it('rejects missing, blank, out-of-range and 0,0 coordinates', () => {
    expect(siteCoords({})).toBeNull()
    expect(siteCoords({ lat: '', lng: '' })).toBeNull()
    expect(siteCoords({ lat: 95, lng: 10 })).toBeNull()
    expect(siteCoords({ lat: 0, lng: 0 })).toBeNull()
    expect(siteCoords({ lat: '12.5', lng: '77.1' })).toEqual({ lat: 12.5, lng: 77.1 })
  })
})

describe('nearestSites', () => {
  const sites = [
    at('far', 13.5, 77),
    at('b', 12.018, 77),
    at('a', 12.009, 77),
    at('none', null, null),
    at('c', 12.1, 77),
    at('d', 12.15, 77),
    at('e', 12.2, 77),
    at('f', 12.21, 77),
  ]
  it('orders by distance, keeps up to 5 inside 25 km, skips sites without coordinates', () => {
    const r = nearestSites(sites, 12, 77)
    expect(r.within).toBe(true)
    expect(r.located).toBe(7)
    expect(r.sites.map((x) => x.site.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
  it('falls back to the nearest 3 when none is inside the radius', () => {
    const r = nearestSites(sites, 20, 77)
    expect(r.within).toBe(false)
    expect(r.sites.map((x) => x.site.id)).toEqual(['far', 'f', 'e'])
  })
  it('returns nothing when no site has coordinates', () => {
    expect(nearestSites([at('x', null, null)], 12, 77)).toMatchObject({ sites: [], located: 0 })
  })
})

describe('formatKm', () => {
  it('reads naturally', () => {
    expect(formatKm(0.4321)).toBe('430 m')
    expect(formatKm(3.21)).toBe('3.2 km')
    expect(formatKm(41.4)).toBe('41 km')
  })
})

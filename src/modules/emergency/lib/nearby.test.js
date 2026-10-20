import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ENDPOINTS,
  addressFromTags,
  amenityOf,
  buildOverpassQuery,
  categoriesStillMissing,
  coerceLatLng,
  findNearestServices,
  isValidCandidate,
  mapOsmElement,
  mergeCandidates,
  selectServices,
} from './nearby'

afterEach(() => {
  vi.unstubAllGlobals()
})

const at = (name, amenity, lat, lon, tags = {}) => ({
  type: 'node',
  lat,
  lon,
  tags: { name, amenity, ...tags },
})

describe('coordinate order', () => {
  it('refuses a missing or out-of-range pair and does not swap a valid one', () => {
    expect(coerceLatLng('13.0458', '77.6206')).toEqual({ lat: 13.0458, lng: 77.6206 })
    expect(() => coerceLatLng(null, 77)).toThrow(/no usable coordinates/)
    expect(() => coerceLatLng(91, 77)).toThrow(/out of range/)
  })

  it('asks Overpass for around(radius, latitude, longitude)', () => {
    const q = buildOverpassQuery(['hospital', 'police', 'fire_station'], 5000, 13.0458, 77.6206)
    expect(q).toContain('around:5000,13.0458,77.6206')
    expect(q).not.toContain('around:5000,77.6206,13.0458')
    expect(q).toContain('healthcare"="hospital"')
    expect(q).toContain('["amenity"!="clinic"]')
    expect(q).not.toContain('amenity"!~')
    expect(q).toContain('emergency"="fire_station"')
    expect(q).not.toContain('600')
    expect(q).not.toContain('amenity"="clinic"')
    expect(q).not.toContain('amenity"="pharmacy"')
  })
})

describe('what counts as the facility', () => {
  it('reads a healthcare=hospital that has no amenity tag', () => {
    expect(amenityOf({ healthcare: 'hospital', name: 'Ashwini Hospital' })).toBe('hospital')
    expect(amenityOf({ amenity: 'clinic', healthcare: 'hospital' })).toBeNull()
    expect(amenityOf({ amenity: 'pharmacy' })).toBeNull()
    expect(amenityOf({ emergency: 'fire_station' })).toBe('fire_station')
    expect(amenityOf({ amenity: 'police' })).toBe('police')
  })

  it('keeps a tagged hospital and drops a road named like a fire station', () => {
    const hospital = mapOsmElement(
      at('Care Health', 'hospital', 13.05, 77.62, {
        'addr:street': 'Hebbal Road',
        'addr:city': 'Bengaluru',
        phone: '112',
      }),
      13.0458,
      77.6206
    )
    expect(hospital.tagged).toBe(true)
    expect(hospital.address).toBe('Hebbal Road, Bengaluru')
    expect(hospital.phone).toBe('')
    expect(isValidCandidate(hospital)).toBe(true)
    expect(
      isValidCandidate({ name: 'Fire Station Lane', amenity: 'fire_station', tagged: true })
    ).toBe(false)
    // A building tagged as the station, named the way the map abbreviates it.
    expect(isValidCandidate({ name: 'Fire St.', amenity: 'fire_station', tagged: true })).toBe(
      true
    )
    expect(isValidCandidate({ name: 'Fire St.', amenity: 'fire_station', tagged: false })).toBe(
      false
    )
    expect(
      isValidCandidate({ name: 'Apollo Hospital, MG Road', amenity: 'hospital', tagged: true })
    ).toBe(true)
  })

  it('uses the English name when the primary name has no Latin letters', () => {
    const mapped = mapOsmElement(
      {
        lat: 13.05,
        lon: 77.62,
        tags: { amenity: 'hospital', name: 'ಆಸ್ಪತ್ರೆ', 'name:en': 'Hebbal Hospital' },
      },
      13.0458,
      77.6206
    )
    expect(mapped.name).toBe('Hebbal Hospital')
    expect(mapped.names).toContain('ಆಸ್ಪತ್ರೆ')
  })
})

describe('addressFromTags', () => {
  it('prefers addr:full', () => {
    expect(addressFromTags({ 'addr:full': '1 Hebbal Road', 'addr:street': 'Other' })).toBe(
      '1 Hebbal Road'
    )
  })
})

describe('mergeCandidates', () => {
  it('collapses a node and a way of the same place and keeps a phone from either', () => {
    const merged = mergeCandidates([
      [
        { amenity: 'hospital', name: 'City Hospital', distanceKm: 1.2, phone: '', address: '' },
        {
          amenity: 'hospital',
          name: 'City Hospital',
          distanceKm: 1.0,
          phone: '08011112222',
          address: 'Hebbal',
        },
      ],
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ distanceKm: 1.0, phone: '08011112222', address: 'Hebbal' })
  })

  it('keeps two facilities that share a name and are not the same place', () => {
    const merged = mergeCandidates([
      [
        { amenity: 'hospital', name: 'Government Hospital', distanceKm: 1, phone: '' },
        { amenity: 'hospital', name: 'Government Hospital', distanceKm: 8, phone: '' },
      ],
    ])
    expect(merged).toHaveLength(2)
  })
})

describe('selectServices', () => {
  it('stores the nearest facility, not the nearest one with a phone', () => {
    const chosen = selectServices(
      [
        {
          amenity: 'hospital',
          name: 'J M J Hospital',
          distanceKm: 0.7,
          phone: '',
          address: '',
          source: 'overpass',
          tagged: true,
        },
        {
          amenity: 'hospital',
          name: 'Baptist Hospital',
          distanceKm: 3.5,
          phone: '08022024700',
          address: 'Hebbal',
          source: 'overpass',
          tagged: true,
        },
        {
          amenity: 'police',
          name: 'Amrutahalli Police Station',
          distanceKm: 2.7,
          phone: '',
          source: 'overpass',
          tagged: true,
        },
        {
          amenity: 'police',
          name: 'Bharthinagar Police Station',
          distanceKm: 6.1,
          phone: '08022942548',
          source: 'overpass',
          tagged: true,
        },
        {
          amenity: 'fire_station',
          name: 'Hebbal Fire Station',
          distanceKm: 0.4,
          phone: '101',
          source: 'overpass',
          tagged: true,
        },
      ],
      5
    )
    const byRole = Object.fromEntries(chosen.map((r) => [r.role, r]))
    expect(byRole.Hospital).toMatchObject({
      name: 'J M J Hospital',
      phone: '',
      distanceKm: 0.7,
      phoneSource: 'none',
    })
    expect(byRole.Police).toMatchObject({
      name: 'Amrutahalli Police Station',
      phone: '',
      distanceKm: 2.7,
    })
    // 101 is the fire helpline, not the station's own line.
    expect(byRole['Fire Brigade']).toMatchObject({
      name: 'Hebbal Fire Station',
      phone: '',
      distanceKm: 0.4,
    })
  })
})

describe('findNearestServices', () => {
  it('queries latitude then longitude and stops once each type has a real facility', async () => {
    const fetch = vi.fn(async (url, init) => {
      expect(String(url)).toBe(ENDPOINTS[0])
      const q = decodeURIComponent(String(init.body).replace(/^data=/, ''))
      expect(q).toContain('around:5000,13.0458,77.6206')
      return {
        ok: true,
        json: async () => ({
          elements: [
            at('J M J Hospital', 'hospital', 13.0398, 77.6231),
            at('Baptist Hospital', 'hospital', 13.0347, 77.5902, {
              phone: '08022024700',
              'addr:full': 'Hebbal, Bengaluru',
            }),
            at('Amrutahalli Police Station', 'police', 13.068, 77.63),
            at('Hebbal Fire Station', 'fire_station', 13.0482, 77.6185),
            at('Corner Pharmacy', 'pharmacy', 13.046, 77.621),
          ],
        }),
      }
    })
    vi.stubGlobal('fetch', fetch)
    const found = await findNearestServices('13.0458', '77.6206', { apiKey: '' })
    expect(fetch).toHaveBeenCalledTimes(1)
    const hospital = found.find((r) => r.role === 'Hospital')
    expect(hospital.name).toBe('J M J Hospital')
    expect(hospital.phone).toBe('')
    expect(hospital.distanceKm).toBeLessThan(1)
    expect(found.find((r) => r.role === 'Police').name).toBe('Amrutahalli Police Station')
    expect(found.find((r) => r.role === 'Fire Brigade').name).toBe('Hebbal Fire Station')
    expect(found.some((r) => /pharmacy/i.test(r.name))).toBe(false)
  })

  it('widens only for a type that has no real facility yet', async () => {
    const fetch = vi.fn(async (_url, init) => {
      const q = decodeURIComponent(String(init.body).replace(/^data=/, ''))
      if (q.includes('around:5000')) {
        expect(q).toContain('fire_station')
        return {
          ok: true,
          json: async () => ({
            elements: [
              at('City Hospital', 'hospital', 13.05, 77.62),
              at('City Police Station', 'police', 13.06, 77.63),
            ],
          }),
        }
      }
      expect(q).toContain('around:15000')
      expect(q).toContain('fire_station')
      expect(q).not.toContain('amenity"="hospital"')
      return {
        ok: true,
        json: async () => ({ elements: [at('Hebbal Fire Station', 'fire_station', 13.1, 77.7)] }),
      }
    })
    vi.stubGlobal('fetch', fetch)
    const found = await findNearestServices(13.0458, 77.6206, { apiKey: '' })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(found.map((r) => r.role).sort()).toEqual(['Fire Brigade', 'Hospital', 'Police'])
  })

  it('falls back to OpenStreetMap when Google rejects the key', async () => {
    const fetch = vi.fn(async (url) => {
      if (String(url).includes('places.googleapis.com')) {
        return {
          ok: false,
          status: 403,
          json: async () => ({ error: { message: 'API key not valid' } }),
        }
      }
      return {
        ok: true,
        json: async () => ({
          elements: [
            at('City Hospital', 'hospital', 13.05, 77.62),
            at('City Police Station', 'police', 13.06, 77.63),
            at('City Fire Station', 'fire_station', 13.07, 77.64),
          ],
        }),
      }
    })
    vi.stubGlobal('fetch', fetch)
    const found = await findNearestServices(13.0458, 77.6206, { apiKey: 'not-a-real-key' })
    expect(found.find((r) => r.role === 'Hospital').source).toBe('overpass')
    expect(String(fetch.mock.calls[0][0])).toContain('places.googleapis.com')
  })

  it('uses Nominatim only after every Overpass mirror fails, and still picks the closest row', async () => {
    const fetch = vi.fn(async (url) => {
      const u = String(url)
      if (!u.includes('nominatim')) return { ok: false, status: 502, json: async () => ({}) }
      const term = decodeURIComponent(u)
      const type = term.includes('q=fire station')
        ? 'fire_station'
        : term.includes('q=police')
          ? 'police'
          : 'hospital'
      const name =
        type === 'fire_station' ? 'Fire Station' : type === 'police' ? 'Police Station' : 'Hospital'
      const rows = [
        {
          lat: '13.09',
          lon: '77.70',
          name: `Far ${name}`,
          type,
          category: 'amenity',
          display_name: `Far ${name}, Bengaluru`,
          extratags: {},
          address: {},
        },
        {
          lat: '13.048',
          lon: '77.621',
          name: `Near ${name}`,
          type,
          category: 'amenity',
          display_name: `Near ${name}, Hebbal, Bengaluru`,
          extratags: { phone: '08040001111' },
          address: { road: 'Hebbal Road', city: 'Bengaluru' },
        },
      ]
      return { ok: true, json: async () => rows }
    })
    vi.stubGlobal('fetch', fetch)
    const found = await findNearestServices(13.0458, 77.6206, { apiKey: '' })
    expect(found.find((r) => r.role === 'Hospital')).toMatchObject({
      name: 'Near Hospital',
      source: 'nominatim',
      address: 'Hebbal Road, Bengaluru',
      phone: '08040001111',
    })
    expect(found.map((r) => r.name).sort()).toEqual([
      'Near Fire Station',
      'Near Hospital',
      'Near Police Station',
    ])
    const nominatimCalls = fetch.mock.calls.filter((c) => String(c[0]).includes('nominatim'))
    expect(nominatimCalls.length).toBe(3)
  }, 20000)
})

describe('categoriesStillMissing', () => {
  it('does not treat a clinic as the hospital being found', () => {
    expect(
      categoriesStillMissing([
        { amenity: 'hospital', name: 'Pill Health Clinic', distanceKm: 0.2, tagged: true },
      ])
    ).toContain('hospital')
  })
})

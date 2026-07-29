import { describe, it, expect } from 'vitest'
import { mapGooglePlace, distanceKm, GOOGLE_TYPE } from './googlePlaces'

const LAT = 17.4483
const LNG = 78.3915

const place = (over = {}) => ({
  displayName: { text: 'Apollo Hospitals' },
  nationalPhoneNumber: '040 2360 7777',
  internationalPhoneNumber: '+91 40 2360 7777',
  location: { latitude: 17.4523, longitude: 78.3955 },
  formattedAddress: 'Jubilee Hills, Hyderabad',
  primaryType: 'hospital',
  businessStatus: 'OPERATIONAL',
  ...over,
})

describe('GOOGLE_TYPE', () => {
  it('maps each amenity we search for', () => {
    expect(GOOGLE_TYPE.hospital).toBe('hospital')
    expect(GOOGLE_TYPE.police).toBe('police')
    expect(GOOGLE_TYPE.fire_station).toBe('fire_station')
  })
})

describe('mapGooglePlace', () => {
  it('maps a normal record', () => {
    const r = mapGooglePlace(place(), 'hospital', LAT, LNG)
    expect(r.name).toBe('Apollo Hospitals')
    expect(r.phone).toBe('040 2360 7777')
    expect(r.source).toBe('google')
    expect(r.amenity).toBe('hospital')
    expect(r.distanceKm).toBeGreaterThan(0)
    expect(r.distanceKm).toBeLessThan(2)
  })

  it('prefers the national number, since that is what people dial', () => {
    const r = mapGooglePlace(place(), 'hospital', LAT, LNG)
    expect(r.phone).toBe('040 2360 7777')
  })

  it('falls back to the international number when there is no national one', () => {
    const r = mapGooglePlace(place({ nationalPhoneNumber: undefined }), 'hospital', LAT, LNG)
    expect(r.phone).toBe('+91 40 2360 7777')
  })

  it('leaves the phone blank rather than inventing one', () => {
    const r = mapGooglePlace(
      place({ nationalPhoneNumber: undefined, internationalPhoneNumber: undefined }),
      'police', LAT, LNG
    )
    expect(r.phone).toBe('')
  })

  it('rejects a permanently closed station', () => {
    expect(mapGooglePlace(place({ businessStatus: 'CLOSED_PERMANENTLY' }), 'hospital', LAT, LNG)).toBeNull()
  })

  it('rejects a temporarily closed station', () => {
    expect(mapGooglePlace(place({ businessStatus: 'CLOSED_TEMPORARILY' }), 'hospital', LAT, LNG)).toBeNull()
  })

  it('accepts a record with no businessStatus field', () => {
    expect(mapGooglePlace(place({ businessStatus: undefined }), 'hospital', LAT, LNG)).not.toBeNull()
  })

  it('rejects a record with no name', () => {
    expect(mapGooglePlace(place({ displayName: undefined }), 'hospital', LAT, LNG)).toBeNull()
  })

  it('rejects a record with no coordinates', () => {
    expect(mapGooglePlace(place({ location: undefined }), 'hospital', LAT, LNG)).toBeNull()
    expect(mapGooglePlace(place({ location: { latitude: 1 } }), 'hospital', LAT, LNG)).toBeNull()
  })

  it('handles a null place without throwing', () => {
    expect(mapGooglePlace(null, 'hospital', LAT, LNG)).toBeNull()
  })
})

describe('distanceKm', () => {
  it('is zero for the same point', () => {
    expect(distanceKm(LAT, LNG, LAT, LNG)).toBeCloseTo(0, 5)
  })

  it('measures a known separation', () => {
    // ~111 km per degree of latitude
    expect(distanceKm(0, 0, 1, 0)).toBeGreaterThan(110)
    expect(distanceKm(0, 0, 1, 0)).toBeLessThan(112)
  })
})

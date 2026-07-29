import { describe, it, expect } from 'vitest'
import { classifyPlace, pickBest } from './classify'

// Every name below was returned by Google Places or OpenStreetMap for a real
// site during testing, so these cases are observed behaviour, not invented.

describe('classifyPlace — police', () => {
  it.each([
    'Leeds District Police HQ',
    'Avonmouth Police Station',
    'Southmead Police Station - Avon and Somerset',
    'Madhapur Police Station',
    'Port of Bristol Police Station',
  ])('accepts %s as a real station', (name) => {
    expect(classifyPlace(name, 'police')).toEqual({ ok: true, strong: true })
  })

  it.each([
    'A&B Block 128 Police Quarters', // police housing
    'Police Welfare Society',
    'Police Training Academy',
  ])('rejects %s', (name) => {
    expect(classifyPlace(name, 'police').ok).toBe(false)
  })

  it.each(['K Hanmanth', 'Ps Exclusive', 'CBI Un- Official'])('rejects noise: %s', (name) => {
    expect(classifyPlace(name, 'police').ok).toBe(false)
  })

  it('accepts a force name without "station" but ranks it below', () => {
    expect(classifyPlace('British Transport Police', 'police')).toEqual({ ok: true, strong: false })
  })
})

describe('classifyPlace — fire', () => {
  it.each([
    'Hunslet Fire Station',
    'Avon Fire & Rescue Service',
    'Fire Station Madhapur',
    'THANISANDRA FIRE STATION MANYATA TECH PARK',
    'Karnataka State Fire And Emergency Services',
    'Moortown Fire Station',
  ])('accepts %s', (name) => {
    expect(classifyPlace(name, 'fire_station')).toEqual({ ok: true, strong: true })
  })

  it.each([
    'British Fire Services Association', // trade body, not a station
    'Firepro Systems Private Limited',   // vendor
    'Leeds District Fire Safety Office', // office, no appliances
    'ABC Fire Extinguisher Supplies',
  ])('rejects %s', (name) => {
    expect(classifyPlace(name, 'fire_station').ok).toBe(false)
  })

  it('rejects a police station returned under the fire category', () => {
    expect(classifyPlace('Sanjay police station ka location', 'fire_station').ok).toBe(false)
  })
})

describe('classifyPlace — hospital', () => {
  it.each([
    'Apollo Hospitals Emergency Centre - Madhapur',
    "St James's Hospital A&E",
    'Southmead Hospital',
    'SiyBaba Hospital',
  ])('accepts %s', (name) => {
    expect(classifyPlace(name, 'hospital')).toEqual({ ok: true, strong: true })
  })

  it.each([
    'shree shyam medical and general store', // a shop
    'Ik pharma',
    'RR Ayurvedam',
    'Sheonagh Scott Therapy',
    'Proderma.medical.aesthetics',
    'Beeston Community Diagnostic Centre',
  ])('rejects %s', (name) => {
    expect(classifyPlace(name, 'hospital').ok).toBe(false)
  })

  it('accepts a clinic but ranks it below a hospital', () => {
    expect(classifyPlace('Pill Health Clinic', 'hospital')).toEqual({ ok: true, strong: false })
  })

  it('rejects an occupational-health practice — it cannot take a casualty', () => {
    expect(classifyPlace('Occupational Health Bristol', 'hospital').ok).toBe(false)
  })

  it('rejects a GP surgery dressed as a medical centre only when it is a shop', () => {
    // A genuine medical centre is a usable fallback, so it stays weakly accepted.
    expect(classifyPlace('Priory View Medical Centre', 'hospital')).toEqual({ ok: true, strong: false })
  })
})

describe('classifyPlace — speciality demotion', () => {
  // Stems must match inflected forms: /\bayurved\b/ never matches "Ayurveda",
  // which is how a herbal clinic once ranked as the nearest emergency hospital.
  it.each([
    'Shri Sai Ram Ayurveda Multi Speciality Hospital',
    'RR Ayurvedam',
  ])('rejects %s despite the word hospital', (name) => {
    expect(classifyPlace(name, 'hospital').ok).toBe(false)
  })

  it.each([
    'Spire Bristol Hospital Paediatrics & Children',
    'Amaha Mental Health Hospital for Psychiatry',
    'City Maternity Hospital',
    'Sankara Eye Hospital',
  ])('accepts %s but ranks it below a general hospital', (name) => {
    expect(classifyPlace(name, 'hospital')).toEqual({ ok: true, strong: false })
  })

  it('ranks traffic police below a general station', () => {
    expect(classifyPlace('Hennur Traffic Police Station', 'police')).toEqual({ ok: true, strong: false })
    expect(classifyPlace('Sampigehalli Police Station', 'police')).toEqual({ ok: true, strong: true })
  })

  it('picks the general station over a nearer speciality one', () => {
    const r = pickBest([
      { name: 'Hennur Traffic Police Station', distanceKm: 1.9, phone: '1', amenity: 'police' },
      { name: 'Sampigehalli Police Station', distanceKm: 2.0, phone: '2', amenity: 'police' },
    ], 25)
    expect(r.chosen.name).toBe('Sampigehalli Police Station')
  })
})

describe('classifyPlace — edges', () => {
  it('rejects blanks and stubs', () => {
    for (const v of ['', '  ', 'ab', null, undefined]) {
      expect(classifyPlace(v, 'police').ok).toBe(false)
    }
  })

  it('rejects an unknown category', () => {
    expect(classifyPlace('Anything', 'bakery').ok).toBe(false)
  })
})

describe('pickBest', () => {
  const c = (name, distanceKm, phone = '', amenity = 'fire_station') => ({ name, distanceKm, phone, amenity })

  it('prefers a real station with a phone over a nearer vendor', () => {
    const r = pickBest([
      c('Firepro Systems Private Limited', 0.5, '0800 111'),
      c('Hunslet Fire Station', 2.6, '0113 222'),
    ], 25)
    expect(r.chosen.name).toBe('Hunslet Fire Station')
  })

  it('prefers a real station with a phone over a nearer weak match', () => {
    const r = pickBest([
      c('Fire Point', 1, '0113 000'),
      c('Avonmouth Fire Station', 3, '0117 111'),
    ], 25)
    expect(r.chosen.name).toBe('Avonmouth Fire Station')
  })

  it('takes the nearest strong match when several have phones', () => {
    const r = pickBest([
      c('Far Fire Station', 12, '1'),
      c('Near Fire Station', 3, '2'),
    ], 25)
    expect(r.chosen.name).toBe('Near Fire Station')
  })

  it('will not take a number from beyond the distance cap', () => {
    const r = pickBest([
      c('Close Fire Station', 2),
      c('Distant Fire Station', 40, '0113 999'),
    ], 25)
    expect(r.chosen.name).toBe('Close Fire Station')
    expect(r.chosen.phone).toBe('')
  })

  it('reaches past the closest station when only a farther one publishes a number', () => {
    const r = pickBest([
      c('Silent Fire Station', 1.4),
      c('Talking Fire Station', 14, '0117 926'),
    ], 25)
    expect(r.chosen.name).toBe('Talking Fire Station')
    expect(r.nearest.name).toBe('Silent Fire Station')
  })

  it('returns null when everything is disqualified', () => {
    expect(pickBest([c('British Fire Services Association', 1, '999')], 25)).toBeNull()
  })

  it('returns null for an empty list', () => {
    expect(pickBest([], 25)).toBeNull()
  })
})

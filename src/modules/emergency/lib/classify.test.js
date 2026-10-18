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
    expect(classifyPlace(name, 'police')).toEqual({
      ok: true,
      strong: true,
      rank: 2,
      limited: false,
    })
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
    expect(classifyPlace('British Transport Police', 'police')).toEqual({
      ok: true,
      strong: false,
      rank: 0,
      limited: false,
    })
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
    expect(classifyPlace(name, 'fire_station')).toEqual({
      ok: true,
      strong: true,
      rank: 2,
      limited: false,
    })
  })

  it.each([
    'British Fire Services Association', // trade body, not a station
    'Firepro Systems Private Limited', // vendor
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
    expect(classifyPlace(name, 'hospital')).toEqual({
      ok: true,
      strong: true,
      rank: 2,
      limited: false,
    })
  })

  it('accepts a plural "Hospitals" — the word boundary used to miss it', () => {
    expect(classifyPlace('Shree Manyata Hospitals', 'hospital')).toEqual({
      ok: true,
      strong: true,
      rank: 2,
      limited: false,
    })
  })

  it('accepts a tagged hospital whose name has no English category word', () => {
    expect(classifyPlace('AIIMS', 'hospital', { tagged: true })).toEqual({
      ok: true,
      strong: true,
      rank: 2,
      limited: false,
    })
    expect(classifyPlace('Care Health', 'hospital', { tagged: true }).ok).toBe(true)
  })

  it('still rejects that name when nothing tagged it as a hospital', () => {
    expect(classifyPlace('Care Health', 'hospital').ok).toBe(false)
    expect(classifyPlace('AIIMS', 'hospital').ok).toBe(false)
  })

  it('rejects a pharmacy even when the map tagged it as a hospital', () => {
    expect(
      classifyPlace('shree shyam medical and general store', 'hospital', { tagged: true }).ok
    ).toBe(false)
  })

  it('reads name:en when the primary name is in a local script', () => {
    expect(
      classifyPlace('ಆಸ್ಪತ್ರೆ', 'hospital', {
        names: ['ಆಸ್ಪತ್ರೆ', 'Hebbal Hospital'],
      })
    ).toEqual({ ok: true, strong: true, rank: 2, limited: false })
  })

  it('accepts a police chowki and an outpost as stations', () => {
    expect(classifyPlace('Nagawara Chowki', 'police').rank).toBe(2)
    expect(classifyPlace('Yelahanka Outpost', 'police').rank).toBe(2)
  })

  it('treats "Fire St." as a station, not a weak fire mention', () => {
    expect(classifyPlace('Fire St.', 'fire_station')).toEqual({
      ok: true,
      strong: true,
      rank: 2,
      limited: false,
    })
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
    expect(classifyPlace('Pill Health Clinic', 'hospital')).toEqual({
      ok: true,
      strong: false,
      rank: 0,
      limited: false,
    })
  })

  it('rejects an occupational-health practice — it cannot take a casualty', () => {
    expect(classifyPlace('Occupational Health Bristol', 'hospital').ok).toBe(false)
    expect(classifyPlace('Occupational Health Bristol', 'hospital', { tagged: true }).ok).toBe(
      false
    )
  })

  it('rejects a GP surgery dressed as a medical centre only when it is a shop', () => {
    // A genuine medical centre is a usable fallback, so it stays weakly accepted.
    expect(classifyPlace('Priory View Medical Centre', 'hospital')).toEqual({
      ok: true,
      strong: false,
      rank: 0,
      limited: false,
    })
  })
})

describe('classifyPlace — speciality demotion', () => {
  // Stems must match inflected forms: /\bayurved\b/ never matches "Ayurveda",
  // which is how a herbal clinic once ranked as the nearest emergency hospital.
  it.each(['Shri Sai Ram Ayurveda Multi Speciality Hospital', 'RR Ayurvedam'])(
    'rejects %s despite the word hospital',
    (name) => {
      expect(classifyPlace(name, 'hospital').ok).toBe(false)
    }
  )

  it.each([
    'Spire Bristol Hospital Paediatrics & Children',
    'Amaha Mental Health Hospital for Psychiatry',
    'City Maternity Hospital',
    'Sankara Eye Hospital',
  ])('accepts %s as a hospital and flags it as a specialty unit', (name) => {
    expect(classifyPlace(name, 'hospital')).toEqual({
      ok: true,
      strong: false,
      rank: 1,
      limited: true,
    })
  })

  it('keeps a nearer specialty hospital ahead of a farther general one', () => {
    const r = pickBest([
      {
        name: 'Sankara Eye Hospital',
        distanceKm: 0.8,
        phone: '1',
        amenity: 'hospital',
        tagged: true,
      },
      {
        name: 'City General Hospital',
        distanceKm: 2.4,
        phone: '2',
        amenity: 'hospital',
        tagged: true,
      },
    ])
    expect(r.chosen.name).toBe('Sankara Eye Hospital')
    expect(r.chosen.limited).toBe(true)
  })

  it('ranks traffic police below a general station', () => {
    expect(classifyPlace('Hennur Traffic Police Station', 'police')).toEqual({
      ok: true,
      strong: false,
      rank: 1,
      limited: true,
    })
    expect(classifyPlace('Sampigehalli Police Station', 'police')).toEqual({
      ok: true,
      strong: true,
      rank: 2,
      limited: false,
    })
  })

  it('keeps the nearer traffic station — it is still the nearest police station', () => {
    // Skipping it for a general station 100 m further is the same bug as
    // skipping a silent station for a farther one that publishes a phone.
    const r = pickBest([
      {
        name: 'Hennur Traffic Police Station',
        distanceKm: 1.9,
        phone: '1',
        amenity: 'police',
        tagged: true,
      },
      {
        name: 'Sampigehalli Police Station',
        distanceKm: 2.0,
        phone: '2',
        amenity: 'police',
        tagged: true,
      },
    ])
    expect(r.chosen.name).toBe('Hennur Traffic Police Station')
    expect(r.chosen.limited).toBe(true)
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
  const c = (name, distanceKm, phone = '', amenity = 'fire_station') => ({
    name,
    distanceKm,
    phone,
    amenity,
  })

  it('prefers a real station with a phone over a nearer vendor', () => {
    const r = pickBest(
      [
        c('Firepro Systems Private Limited', 0.5, '0800 111'),
        c('Hunslet Fire Station', 2.6, '0113 222'),
      ],
      25
    )
    expect(r.chosen.name).toBe('Hunslet Fire Station')
  })

  it('prefers a real station over a nearer weak match, phone or not', () => {
    const r = pickBest([c('Fire Point', 1, '0113 000'), c('Avonmouth Fire Station', 3, '0117 111')])
    expect(r.chosen.name).toBe('Avonmouth Fire Station')
  })

  it('takes the nearest strong match when several have phones', () => {
    const r = pickBest([c('Far Fire Station', 12, '1'), c('Near Fire Station', 3, '2')])
    expect(r.chosen.name).toBe('Near Fire Station')
  })

  it('keeps the nearest station when a farther one is the only one with a phone', () => {
    // Measured at Manyata: the only police number in 8 km belonged to a
    // station 6.1 km away. Storing that number stored the wrong station.
    const r = pickBest([
      c('Amrutahalli Police Station', 2.7, '', 'police'),
      c('Bharthinagar Police Station', 6.1, '080 2294 2548', 'police'),
    ])
    expect(r.chosen.name).toBe('Amrutahalli Police Station')
    expect(r.chosen.phone).toBe('')
  })

  it('keeps the nearest hospital when a farther one publishes the only number', () => {
    const r = pickBest([
      { name: 'J M J Hospital', distanceKm: 0.7, phone: '', amenity: 'hospital', tagged: true },
      {
        name: 'Baptist Hospital',
        distanceKm: 3.5,
        phone: '08022024700',
        amenity: 'hospital',
        tagged: true,
      },
    ])
    expect(r.chosen.name).toBe('J M J Hospital')
    expect(r.chosen.phone).toBe('')
  })

  it('does not let a nearer clinic take the hospital slot', () => {
    const r = pickBest([
      {
        name: 'Sanjeevini Children & Women Clinic',
        distanceKm: 0.4,
        phone: '080 2292 4422',
        amenity: 'hospital',
        tagged: true,
      },
      { name: 'Suraksha Hospital', distanceKm: 0.9, phone: '', amenity: 'hospital', tagged: true },
    ])
    expect(r.chosen.name).toBe('Suraksha Hospital')
  })

  it('returns null when everything is disqualified', () => {
    expect(pickBest([c('British Fire Services Association', 1, '999')], 25)).toBeNull()
  })

  it('returns null for an empty list', () => {
    expect(pickBest([], 25)).toBeNull()
  })
})

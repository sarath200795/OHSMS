import { describe, it, expect } from 'vitest'
import { assessWeather, digestLevel, digestHazards, digestDrivers } from './weatherBands.js'

const bandOf = (obs, key) => assessWeather(obs).hazards.find((h) => h.key === key)?.band ?? 'none'

describe('digest bands follow the cut-offs', () => {
  it('treats moderate as Medium and high or severe as High', () => {
    expect(digestLevel('moderate')).toBe('Medium')
    expect(digestLevel('high')).toBe('High')
    expect(digestLevel('severe')).toBe('High')
    expect(digestLevel('low')).toBe('')
    expect(digestLevel('none')).toBe('')
  })

  it('does not flag an ordinary warm day, and does flag a thunderstorm warning', () => {
    expect(digestLevel(assessWeather({ apparentTempC: 34 }).band)).toBe('')
    expect(digestLevel(assessWeather({ apparentTempC: 45 }).band)).toBe('Medium')
    expect(digestLevel(assessWeather({ tempC: 41, apparentTempC: 51 }).band)).toBe('High')
    const storm = assessWeather({ lightningCode: 95 })
    expect(digestLevel(storm.band)).toBe('High')
    expect(digestHazards(storm)).toContain('Lightning')
    expect(digestDrivers(storm)).toContainEqual({
      key: 'lightning',
      label: 'Lightning',
      value: 'Thunderstorm forecast',
      level: 'High',
    })
  })

  it('keeps the reading on a digest driver and drops a low one', () => {
    expect(digestDrivers(assessWeather({ precipMmHr: 12 }))).toEqual([
      { key: 'rain', label: 'Rain', value: 'High · 12.0 mm/h', level: 'High' },
    ])
    expect(digestDrivers(assessWeather({ precipMmHr: 0.5 }))).toEqual([])
    expect(digestDrivers(assessWeather({ aqi: 80 }))).toEqual([])
  })

  it('gives each driver its own level, so one site can be High for heat and Medium for rain', () => {
    const drivers = digestDrivers(
      assessWeather({ tempC: 42, apparentTempC: 52, precipMmHr: 4, capeJkg: 500 })
    )
    expect(drivers.map((d) => `${d.key}:${d.level}`)).toEqual(['heat:High', 'rain:Medium'])
    expect(drivers.some((d) => d.key === 'lightning')).toBe(false)
  })
})

describe('heat High needs the air temperature above 40°C', () => {
  it.each([
    [40, 'moderate', 'Medium'],
    [40.1, 'high', 'High'],
    [38, 'moderate', 'Medium'],
    [45, 'high', 'High'],
  ])('air %s°C with feels like 52°C is %s (digest %s)', (tempC, band, level) => {
    const a = assessWeather({ tempC, apparentTempC: 52 })
    expect(bandOf({ tempC, apparentTempC: 52 }, 'heat')).toBe(band)
    expect(digestLevel(a.band)).toBe(level)
  })

  it('caps severe feels-like at Medium too when the air is 40°C or less', () => {
    expect(bandOf({ tempC: 39, apparentTempC: 60 }, 'heat')).toBe('moderate')
    expect(bandOf({ tempC: 40, apparentTempC: 60 }, 'heat')).toBe('moderate')
    expect(bandOf({ tempC: 40.1, apparentTempC: 60 }, 'heat')).toBe('severe')
  })

  it('leaves Low and Medium on feels-like alone', () => {
    expect(bandOf({ tempC: 30, apparentTempC: 39.9 }, 'heat')).toBe('none')
    expect(bandOf({ tempC: 30, apparentTempC: 40 }, 'heat')).toBe('low')
    expect(bandOf({ tempC: 30, apparentTempC: 45 }, 'heat')).toBe('moderate')
    expect(bandOf({ tempC: 38, apparentTempC: 50.9 }, 'heat')).toBe('moderate')
  })

  it('does not rate High from a feels-like alone when the air temperature is missing', () => {
    expect(bandOf({ apparentTempC: 52 }, 'heat')).toBe('moderate')
  })

  it('still rates High on dry bulb alone when there is no feels-like', () => {
    expect(bandOf({ tempC: 52 }, 'heat')).toBe('high')
  })

  it('keeps feels-like 52 / air 38 as Medium, and leaves the other alerts at their own levels', () => {
    const drivers = digestDrivers(
      assessWeather({ tempC: 38, apparentTempC: 52, precipMmHr: 12, capeJkg: 2600, aqi: 420 })
    )
    const by = Object.fromEntries(drivers.map((d) => [d.key, d.level]))
    expect(by).toEqual({ heat: 'Medium', rain: 'High', lightning: 'High', air: 'High' })
  })
})

describe('cold stress', () => {
  it.each([
    [10.1, 'none', ''],
    [10, 'low', ''],
    [0, 'moderate', 'Medium'],
    [-10, 'high', 'High'],
    [-25, 'severe', 'High'],
  ])('feels like %s°C is %s and digests as %s', (apparentTempC, band, level) => {
    const a = assessWeather({ apparentTempC })
    expect(bandOf({ apparentTempC }, 'cold')).toBe(band)
    expect(digestLevel(a.hazards.find((h) => h.key === 'cold')?.band || 'none')).toBe(level)
  })
})

describe('lightning', () => {
  it('uses CAPE when there is no thunderstorm code', () => {
    expect(bandOf({ capeJkg: 999 }, 'lightning')).toBe('none')
    expect(bandOf({ capeJkg: 1000 }, 'lightning')).toBe('moderate')
    expect(digestDrivers(assessWeather({ capeJkg: 1800 }))).toContainEqual({
      key: 'lightning',
      label: 'Lightning',
      value: 'CAPE 1800 J/kg',
      level: 'Medium',
    })
    expect(digestDrivers(assessWeather({ capeJkg: 2500 }))[0]).toMatchObject({
      key: 'lightning',
      level: 'High',
      value: 'CAPE 2500 J/kg',
    })
  })

  it('treats a thunderstorm warning as severe even when CAPE is quiet', () => {
    const a = assessWeather({ lightningCode: 96, capeJkg: 200 })
    expect(bandOf({ lightningCode: 96, capeJkg: 200 }, 'lightning')).toBe('severe')
    expect(digestDrivers(a)[0].value).toBe('Thunderstorm forecast · CAPE 200 J/kg')
    expect(digestLevel(a.band)).toBe('High')
  })

  it('treats lightning code 99 as severe and digests it as High', () => {
    const a = assessWeather({ lightningCode: 99 })
    expect(bandOf({ lightningCode: 99 }, 'lightning')).toBe('severe')
    expect(digestLevel(a.band)).toBe('High')
    expect(digestDrivers(a)).toContainEqual({
      key: 'lightning',
      label: 'Lightning',
      value: 'Thunderstorm forecast',
      level: 'High',
    })
  })
})

describe('air quality', () => {
  it.each([
    [0, 'low', ''],
    [199, 'low', ''],
    [200, 'moderate', 'Medium'],
    [399, 'moderate', 'Medium'],
    [400, 'high', 'High'],
    [500, 'high', 'High'],
  ])('AQI %s is %s and digests as %s', (aqi, band, level) => {
    expect(bandOf({ aqi }, 'air')).toBe(band)
    const drivers = digestDrivers(assessWeather({ aqi }))
    if (!level) expect(drivers).toEqual([])
    else expect(drivers[0]).toMatchObject({ key: 'air', level })
  })

  it('says when the index was built from particles', () => {
    expect(assessWeather({ aqi: 250, aqiSource: 'pm' }).hazards[0].value).toBe(
      'Medium · AQI 250 (particles)'
    )
  })
})

describe('retired alerts stay retired', () => {
  it.each([0, 3, 6, 11])('UV index %s produces no hazard or digest line', (uvIndex) => {
    const a = assessWeather({ uvIndex, visibilityM: 100, windKph: 80, weatherCode: 95 })
    expect(a.hazards).toEqual([])
    expect(a.band).toBe('none')
    expect(digestDrivers(a)).toEqual([])
  })

  it('does not let a stale visibility or wind field change a real alert', () => {
    const base = { tempC: 41, apparentTempC: 45, precipMmHr: 12 }
    expect(assessWeather({ ...base, visibilityM: 50, windKph: 90, uvIndex: 12 })).toEqual(
      assessWeather(base)
    )
  })
})

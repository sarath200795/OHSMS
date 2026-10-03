import { describe, it, expect } from 'vitest'
import { assessWeather, digestLevel, digestHazards, digestDrivers } from './weatherBands.js'
import { forecastUrl, normalizeOpenMeteo, gridKey } from './openMeteo.js'

const bandOf = (obs, key) => assessWeather(obs).hazards.find((h) => h.key === key)?.band ?? 'none'

describe('digest bands follow the published cut-offs', () => {
  it('treats moderate as Medium and high or severe as High', () => {
    expect(digestLevel('moderate')).toBe('Medium')
    expect(digestLevel('high')).toBe('High')
    expect(digestLevel('severe')).toBe('High')
    expect(digestLevel('low')).toBe('')
    expect(digestLevel('none')).toBe('')
  })

  it.each([
    [39, 'moderate', 'Medium'],
    [50, 'high', 'High'],
    [62, 'severe', 'High'],
    [29, 'low', ''],
  ])('%s km/h wind is %s and digests as %s', (windKph, band, level) => {
    const assessment = assessWeather({ windKph })
    expect(bandOf({ windKph }, 'wind')).toBe(band)
    expect(digestLevel(assessment.band)).toBe(level)
  })

  it('does not flag an ordinary warm day, and does flag a thunderstorm', () => {
    expect(digestLevel(assessWeather({ apparentTempC: 34 }).band)).toBe('')
    expect(digestLevel(assessWeather({ apparentTempC: 45 }).band)).toBe('Medium')
    expect(digestLevel(assessWeather({ tempC: 41, apparentTempC: 51 }).band)).toBe('High')
    const storm = assessWeather({ weatherCode: 95 })
    expect(digestLevel(storm.band)).toBe('High')
    expect(digestHazards(storm)).toContain('Thunderstorm')
    expect(digestDrivers(storm)).toContainEqual({
      key: 'lightning',
      label: 'Thunderstorm',
      value: 'Lightning reported',
      level: 'High',
    })
  })

  it('keeps the reading on a digest driver and drops a low one', () => {
    expect(digestDrivers(assessWeather({ windKph: 50 }))).toEqual([
      { key: 'wind', label: 'High wind', value: '50 km/h', level: 'High' },
    ])
    expect(digestDrivers(assessWeather({ windKph: 20, gustKph: 65 }))).toEqual([
      { key: 'wind', label: 'High wind', value: 'Gusting 65 km/h', level: 'High' },
    ])
    expect(digestDrivers(assessWeather({ precipMmHr: 12 }))).toEqual([
      { key: 'rain', label: 'Rain', value: 'High · 12.0 mm/h', level: 'High' },
    ])
    expect(digestDrivers(assessWeather({ windKph: 20 }))).toEqual([])
  })

  it('gives each driver its own level, so one site can be High for heat and Medium for rain', () => {
    const drivers = digestDrivers(assessWeather({ tempC: 42, apparentTempC: 52, precipMmHr: 4, windKph: 20 }))
    expect(drivers.map((d) => `${d.key}:${d.level}`)).toEqual(['heat:High', 'rain:Medium'])
    // Wind at 20 km/h is Low, and Low is not a driver at all.
    expect(drivers.some((d) => d.key === 'wind')).toBe(false)
  })
})

describe('Open-Meteo request', () => {
  it('rounds coordinates to ~1 km and does not carry a site name', () => {
    const url = forecastUrl(17.43821, 78.3912)
    expect(url).toContain('latitude=17.44')
    expect(url).toContain('longitude=78.39')
    expect(url).not.toContain('17.438')
    expect(url).not.toContain('Plant')
    expect(gridKey(91, 0)).toBe('')
  })

  it('picks the hourly visibility for the current hour, not midnight', () => {
    const obs = normalizeOpenMeteo({
      current: { time: '2026-09-23T15:10', temperature_2m: 30, weather_code: 0 },
      hourly: {
        time: ['2026-09-23T00:00', '2026-09-23T15:00'],
        visibility: [100, 8000],
        uv_index: [0, 6],
      },
    })
    expect(obs.visibilityM).toBe(8000)
    expect(obs.uvIndex).toBe(6)
    expect(obs.tempC).toBe(30)
    expect(obs.observedAt).toBe('2026-09-23T15:10')
  })
})

// Heat is High only when the air itself is above 40°C. Feels-like still sets
// Low and Medium, and would otherwise reach High from 51°C.
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

  it('caps severe feels-like (56°C+) at Medium too when the air is 40°C or less', () => {
    expect(bandOf({ tempC: 39, apparentTempC: 60 }, 'heat')).toBe('moderate')
    expect(bandOf({ tempC: 40, apparentTempC: 60 }, 'heat')).toBe('moderate')
    expect(bandOf({ tempC: 40.1, apparentTempC: 60 }, 'heat')).toBe('severe')
  })

  it('leaves Low and Medium on feels-like alone', () => {
    expect(bandOf({ tempC: 30, apparentTempC: 39.9 }, 'heat')).toBe('none')
    expect(bandOf({ tempC: 30, apparentTempC: 40 }, 'heat')).toBe('low')
    expect(bandOf({ tempC: 30, apparentTempC: 45 }, 'heat')).toBe('moderate')
    expect(bandOf({ tempC: 30, apparentTempC: 50.9 }, 'heat')).toBe('moderate')
    expect(bandOf({ tempC: 38, apparentTempC: 50.9 }, 'heat')).toBe('moderate')
  })

  it('does not rate High from a feels-like alone when the air temperature is missing', () => {
    expect(bandOf({ apparentTempC: 52 }, 'heat')).toBe('moderate')
  })

  it('still rates High on dry bulb alone when there is no feels-like', () => {
    expect(bandOf({ tempC: 52 }, 'heat')).toBe('high')
  })

  it('keeps feels-like 52 / air 38 as Medium in the digest drivers, and leaves other hazards alone', () => {
    const drivers = digestDrivers(
      assessWeather({ tempC: 38, apparentTempC: 52, precipMmHr: 12, windKph: 55 })
    )
    const by = Object.fromEntries(drivers.map((d) => [d.key, d.level]))
    expect(by).toEqual({ heat: 'Medium', rain: 'High', wind: 'High' })
  })
})

describe('UV is not a weather hazard', () => {
  it.each([0, 3, 6, 8, 11, 14])('UV index %s produces no hazard, band or digest line', (uvIndex) => {
    const a = assessWeather({ uvIndex })
    expect(a.hazards).toEqual([])
    expect(a.band).toBe('none')
    expect(digestLevel(a.band)).toBe('')
    expect(digestHazards(a)).toEqual([])
    expect(digestDrivers(a)).toEqual([])
  })

  it('leaves the other hazards and the overall band exactly as they are without it', () => {
    const base = { tempC: 41, apparentTempC: 45, windKph: 55 }
    expect(assessWeather({ ...base, uvIndex: 12 })).toEqual(assessWeather(base))
  })

  it('still carries the UV reading on the observation as plain data', () => {
    expect(normalizeOpenMeteo({
      current: { time: '2026-09-23T11:00' },
      hourly: { time: ['2026-09-23T11:00'], uv_index: [9] },
    }).uvIndex).toBe(9)
  })
})

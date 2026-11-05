import { describe, it, expect } from 'vitest'
import { assessWeather, levelOf, BANDS, summariseHazards } from './weatherRisk'

const bandOf = (obs, key) => assessWeather(obs).hazards.find((h) => h.key === key)?.band ?? 'none'

describe('heat stress thresholds', () => {
  it.each([
    [20, 'none'],
    [30, 'none'],
    [35, 'none'],
    [39.9, 'none'],
    [40, 'low'],
    [44.9, 'low'],
    [45, 'moderate'],
    [50.9, 'moderate'],
    [51, 'high'],
    [55.9, 'high'],
    [56, 'severe'],
    [62, 'severe'],
  ])('feels like %s°C (air 41°C) is %s', (t, expected) => {
    expect(bandOf({ tempC: 41, apparentTempC: t }, 'heat')).toBe(expected)
  })

  it.each([
    [38, 'moderate'],
    [40, 'moderate'],
    [40.1, 'high'],
    [45, 'high'],
  ])('feels like 52°C with air %s°C is %s', (airC, expected) => {
    expect(bandOf({ tempC: airC, apparentTempC: 52 }, 'heat')).toBe(expected)
  })

  it('caps severe feels-like at Medium too while the air is 40°C or less', () => {
    expect(bandOf({ tempC: 39, apparentTempC: 60 }, 'heat')).toBe('moderate')
    expect(bandOf({ tempC: 40, apparentTempC: 60 }, 'heat')).toBe('moderate')
    expect(bandOf({ tempC: 40.1, apparentTempC: 60 }, 'heat')).toBe('severe')
  })

  it('leaves Low and Medium on feels-like alone, whatever the air temperature', () => {
    expect(bandOf({ tempC: 30, apparentTempC: 39.9 }, 'heat')).toBe('none')
    expect(bandOf({ tempC: 30, apparentTempC: 40 }, 'heat')).toBe('low')
    expect(bandOf({ tempC: 30, apparentTempC: 45 }, 'heat')).toBe('moderate')
    expect(bandOf({ tempC: 38, apparentTempC: 50.9 }, 'heat')).toBe('moderate')
  })

  it('does not rate High from feels-like alone when the air temperature is missing', () => {
    expect(bandOf({ apparentTempC: 52 }, 'heat')).toBe('moderate')
  })

  it('still rates High on dry bulb alone when there is no feels-like', () => {
    expect(bandOf({ tempC: 52 }, 'heat')).toBe('high')
  })

  it('falls back to the dry bulb when feels-like is missing, and prefers feels-like when both exist', () => {
    expect(bandOf({ tempC: 41 }, 'heat')).toBe('low')
    expect(bandOf({ tempC: 30, apparentTempC: 46 }, 'heat')).toBe('moderate')
  })
})

describe('cold stress thresholds', () => {
  it.each([
    [15, 'none'],
    [10.1, 'none'],
    [10, 'low'],
    [0.1, 'low'],
    [0, 'moderate'],
    [-9.9, 'moderate'],
    [-10, 'high'],
    [-24.9, 'high'],
    [-25, 'severe'],
    [-40, 'severe'],
  ])('feels like %s°C is %s', (t, expected) => {
    expect(bandOf({ apparentTempC: t }, 'cold')).toBe(expected)
  })

  it('never reports heat and cold at once', () => {
    for (const t of [-30, -5, 5, 20, 35, 55]) {
      const keys = assessWeather({ apparentTempC: t }).hazards.map((h) => h.key)
      expect(keys.includes('heat') && keys.includes('cold')).toBe(false)
    }
  })
})

describe('rain', () => {
  it.each([
    [0.2, 'none'],
    [0.5, 'low'],
    [4, 'moderate'],
    [10, 'high'],
    [30, 'severe'],
  ])('%s mm/h rain is %s', (r, expected) => {
    expect(bandOf({ precipMmHr: r }, 'rain')).toBe(expected)
  })

  it.each([
    [0.5, 'Low'],
    [4, 'Medium'],
    [10, 'High'],
    [30, 'High'],
  ])('%s mm/h is a %s rain alert', (r, alert) => {
    const h = assessWeather({ precipMmHr: r }).hazards.find((x) => x.key === 'rain')
    expect(h.alert).toBe(alert)
    expect(h.label).toBe('Rain alert')
    expect(h.value).toContain(alert)
  })

  it('keeps a cloudburst driving the severe verdict even though it reads High', () => {
    const r = assessWeather({ precipMmHr: 40 })
    expect(r.hazards[0].alert).toBe('High')
    expect(r.band).toBe('severe')
  })
})

describe('lightning', () => {
  it('treats a thunderstorm warning as severe', () => {
    for (const code of [95, 96, 99]) {
      expect(bandOf({ lightningCode: code }, 'lightning')).toBe('severe')
    }
  })

  it('treats lightning code 99 as severe and names it a thunderstorm forecast', () => {
    const h = assessWeather({ lightningCode: 99 }).hazards.find((x) => x.key === 'lightning')
    expect(h.band).toBe('severe')
    expect(h.value).toBe('Thunderstorm forecast')
  })

  it('does not treat an old rain code, or a quiet CAPE, as lightning', () => {
    expect(bandOf({ weatherCode: 95 }, 'lightning')).toBe('none')
    expect(bandOf({ capeJkg: 999 }, 'lightning')).toBe('none')
    expect(bandOf({ capeJkg: 1000 }, 'lightning')).toBe('moderate')
    expect(bandOf({ capeJkg: 2500 }, 'lightning')).toBe('high')
  })

  it('names the warning and the CAPE it was read from', () => {
    const h = assessWeather({ lightningCode: 95, capeJkg: 1800 }).hazards.find(
      (x) => x.key === 'lightning'
    )
    expect(h.value).toBe('Thunderstorm forecast · CAPE 1800 J/kg')
    expect(h.affects).toMatch(/height/)
  })
})

describe('air quality', () => {
  it.each([
    [0, 'low'],
    [199, 'low'],
    [200, 'moderate'],
    [399, 'moderate'],
    [400, 'high'],
    [500, 'high'],
  ])('AQI %s is %s', (aqi, expected) => {
    expect(bandOf({ aqi }, 'air')).toBe(expected)
  })

  it('shows the particle fallback in the reading', () => {
    const h = assessWeather({ aqi: 420, aqiSource: 'pm' }).hazards.find((x) => x.key === 'air')
    expect(h.value).toBe('High · AQI 420 (particles)')
    expect(h.band).toBe('high')
  })
})

describe('the overall verdict', () => {
  it('is the worst hazard present, not an average of them', () => {
    const r = assessWeather({ apparentTempC: 21, precipMmHr: 0, lightningCode: 95 })
    expect(r.band).toBe('severe')
    expect(r.hazards[0].key).toBe('lightning')
  })

  it('sorts worst first so a bubble showing one row shows the right one', () => {
    const r = assessWeather({ tempC: 42, apparentTempC: 52, aqi: 250 })
    expect(r.hazards.map((h) => h.key)).toEqual(['heat', 'air'])
    const levels = r.hazards.map((h) => levelOf(h.band))
    expect(levels).toEqual([...levels].sort((a, b) => b - a))
  })

  it('is clear when nothing is wrong, and lists nothing', () => {
    const r = assessWeather({
      apparentTempC: 21,
      tempC: 21,
      precipMmHr: 0,
      uvIndex: 2,
      visibilityM: 20000,
      windKph: 40,
      weatherCode: 1,
      capeJkg: 100,
    })
    expect(r.band).toBe('none')
    expect(r.level).toBe(0)
    expect(r.hazards).toEqual([])
  })

  it('omits a hazard the provider had no reading for rather than scoring it zero', () => {
    const r = assessWeather({ apparentTempC: 21 })
    expect(r.hazards.find((h) => h.key === 'air')).toBeUndefined()
    expect(r.hazards.find((h) => h.key === 'visibility')).toBeUndefined()
    expect(r.band).toBe('none')
  })

  it('survives an empty observation', () => {
    expect(assessWeather()).toEqual({ level: 0, band: 'none', hazards: [] })
    expect(assessWeather({})).toEqual({ level: 0, band: 'none', hazards: [] })
  })

  it('ignores nulls and non-numbers the API may send', () => {
    const r = assessWeather({
      apparentTempC: null,
      precipMmHr: NaN,
      visibilityM: 'n/a',
      aqi: 'bad',
      capeJkg: undefined,
    })
    expect(r.hazards).toEqual([])
  })

  it('gives every hazard a label and the work it affects', () => {
    const r = assessWeather({
      tempC: 42,
      apparentTempC: 52,
      precipMmHr: 12,
      lightningCode: 95,
      aqi: 450,
    })
    expect(r.hazards.map((h) => h.key).sort()).toEqual(['air', 'heat', 'lightning', 'rain'])
    for (const h of r.hazards) {
      expect(h.label).toBeTruthy()
      expect(h.affects).toBeTruthy()
      expect(h.value).toBeTruthy()
      expect(BANDS).toContain(h.band)
    }
  })
})

describe('summariseHazards', () => {
  const site = (obs) => assessWeather(obs)

  it('names each kind of weather that is a problem, once', () => {
    const out = summariseHazards([
      site({ capeJkg: 2600 }),
      site({ capeJkg: 1200 }),
      site({ apparentTempC: 46 }),
    ])
    expect(out.map((h) => h.key)).toEqual(['lightning', 'heat'])
  })

  it('counts how many sites show each one', () => {
    const out = summariseHazards([
      site({ capeJkg: 2600 }),
      site({ capeJkg: 1200 }),
      site({ apparentTempC: 46 }),
    ])
    expect(out.find((h) => h.key === 'lightning').sites).toBe(2)
    expect(out.find((h) => h.key === 'heat').sites).toBe(1)
  })

  it('reports a category at its worst band across the sites', () => {
    const out = summariseHazards([site({ capeJkg: 1200 }), site({ lightningCode: 95 })])
    expect(out[0]).toMatchObject({ key: 'lightning', band: 'severe', sites: 2 })
  })

  it('puts the worst category first, then the most widespread', () => {
    const out = summariseHazards([
      site({ aqi: 250 }),
      site({ aqi: 250 }),
      site({ aqi: 250 }),
      site({ lightningCode: 95 }),
    ])
    expect(out[0].key).toBe('lightning')
    expect(out[1]).toMatchObject({ key: 'air', sites: 3 })
  })

  it('does not let one site count twice for the same category', () => {
    const out = summariseHazards([site({ lightningCode: 95, capeJkg: 3000 })])
    expect(out.filter((h) => h.key === 'lightning')).toHaveLength(1)
    expect(out[0].sites).toBe(1)
  })

  it('is empty when nothing is wrong anywhere', () => {
    expect(summariseHazards([site({ apparentTempC: 21, capeJkg: 5 })])).toEqual([])
    expect(summariseHazards([])).toEqual([])
    expect(summariseHazards()).toEqual([])
  })

  it('ignores sites that have not been assessed', () => {
    expect(summariseHazards([null, undefined, {}, site({ capeJkg: 2600 })])).toHaveLength(1)
  })

  it('carries the label and level the UI renders', () => {
    const [h] = summariseHazards([site({ lightningCode: 95 })])
    expect(h.label).toBe('Lightning')
    expect(h.level).toBe(levelOf('severe'))
  })
})

describe('UV, visibility and wind are not weather hazards', () => {
  it.each([0, 3, 6, 8, 11, 14])('UV index %s produces no hazard, band or count', (uvIndex) => {
    const r = assessWeather({ uvIndex, visibilityM: 100, windKph: 80 })
    expect(r.hazards).toEqual([])
    expect(r.band).toBe('none')
    expect(summariseHazards([r])).toEqual([])
  })

  it('leaves the other hazards and the overall band exactly as they are without it', () => {
    const base = { tempC: 41, apparentTempC: 45, precipMmHr: 6 }
    expect(assessWeather({ ...base, uvIndex: 12, visibilityM: 80, windKph: 70 })).toEqual(
      assessWeather(base)
    )
  })
})

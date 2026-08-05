import { describe, it, expect } from 'vitest'
import { assessWeather, levelOf, isThunderstorm, BANDS, summariseHazards } from './weatherRisk'

const bandOf = (obs, key) => assessWeather(obs).hazards.find((h) => h.key === key)?.band ?? 'none'

// The cut-offs are the whole point of this module. If one drifts, a site stops
// warning about conditions its safety officer is expected to act on, and
// nothing else in the app would notice.
describe('heat stress thresholds', () => {
  // Reporting starts at 40°C. Below that is an ordinary working day here, and a
  // heat row that is always lit tells nobody anything.
  it.each([
    [20, 'none'], [30, 'none'], [35, 'none'], [39.9, 'none'],
    [40, 'low'], [44.9, 'low'],
    [45, 'moderate'], [50.9, 'moderate'],
    [51, 'high'], [55.9, 'high'],
    [56, 'severe'], [62, 'severe'],
  ])('feels like %s°C is %s', (t, expected) => {
    expect(bandOf({ apparentTempC: t }, 'heat')).toBe(expected)
  })

  it('says nothing about a warm but unremarkable day', () => {
    // 34°C used to raise "take precautions" on every site, every summer day.
    expect(assessWeather({ apparentTempC: 34 }).hazards).toEqual([])
  })

  it('reads apparent temperature, not dry bulb, because humidity defeats sweating', () => {
    // 33°C in high humidity feels like 46°C — the raw figure looks unremarkable.
    expect(bandOf({ tempC: 33, apparentTempC: 46 }, 'heat')).toBe('moderate')
  })

  it('falls back to dry bulb when the provider gives no apparent temperature', () => {
    expect(bandOf({ tempC: 41 }, 'heat')).toBe('low')
  })
})

describe('cold stress thresholds', () => {
  it.each([
    [15, 'none'], [10.1, 'none'],
    [10, 'low'], [0.1, 'low'],
    [0, 'moderate'], [-9.9, 'moderate'],
    [-10, 'high'], [-24.9, 'high'],
    [-25, 'severe'], [-40, 'severe'],
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

describe('wind thresholds', () => {
  // Beaufort 5/6/7/8.
  it.each([[20, 'none'], [29, 'low'], [39, 'moderate'], [50, 'high'], [62, 'severe']])(
    '%s km/h is %s', (w, expected) => {
      expect(bandOf({ windKph: w }, 'wind')).toBe(expected)
    }
  )

  it('bands on the gust when it is worse than the steady wind', () => {
    // Steady wind alone would read "low"; the gust is what takes a board out of
    // someone's hands at height.
    const h = assessWeather({ windKph: 30, gustKph: 65 }).hazards.find((x) => x.key === 'wind')
    expect(h.band).toBe('severe')
    expect(h.value).toBe('Gusting 65 km/h')
  })

  it('shows the steady figure when there is no meaningful gust', () => {
    expect(assessWeather({ windKph: 45, gustKph: 45 }).hazards.find((h) => h.key === 'wind').value)
      .toBe('45 km/h')
  })
})

describe('visibility and rain get worse in opposite directions', () => {
  it.each([[8000, 'none'], [5000, 'low'], [2000, 'moderate'], [1000, 'high'], [200, 'severe']])(
    '%s m visibility is %s', (v, expected) => {
      expect(bandOf({ visibilityM: v }, 'visibility')).toBe(expected)
    }
  )

  it.each([[0.2, 'none'], [0.5, 'low'], [4, 'moderate'], [10, 'high'], [30, 'severe']])(
    '%s mm/h rain is %s', (r, expected) => {
      expect(bandOf({ precipMmHr: r }, 'rain')).toBe(expected)
    }
  )

  it.each([[0.5, 'Low'], [4, 'Medium'], [10, 'High'], [30, 'High']])(
    '%s mm/h is a %s rain alert', (r, alert) => {
      const h = assessWeather({ precipMmHr: r }).hazards.find((x) => x.key === 'rain')
      expect(h.alert).toBe(alert)
      expect(h.label).toBe('Rain alert')
      expect(h.value).toContain(alert)
    }
  )

  it('keeps a cloudburst driving the severe verdict even though it reads High', () => {
    // Three alert names, five bands — the overall risk must not be flattened.
    const r = assessWeather({ precipMmHr: 40 })
    expect(r.hazards[0].alert).toBe('High')
    expect(r.band).toBe('severe')
  })

  it('renders visibility in km once it is over a kilometre', () => {
    expect(assessWeather({ visibilityM: 2500 }).hazards.find((h) => h.key === 'visibility').value)
      .toBe('2.5 km')
    expect(assessWeather({ visibilityM: 400 }).hazards.find((h) => h.key === 'visibility').value)
      .toBe('400 m')
  })
})

describe('WMO weather codes', () => {
  it('treats every thunderstorm code as severe', () => {
    for (const code of [95, 96, 99]) {
      expect(isThunderstorm(code)).toBe(true)
      expect(bandOf({ weatherCode: code }, 'lightning')).toBe('severe')
    }
  })

  it('does not call ordinary rain a thunderstorm', () => {
    for (const code of [0, 3, 61, 63, 80]) expect(isThunderstorm(code)).toBe(false)
  })

  it.each([56, 57, 66, 67])('flags freezing code %s as ice', (code) => {
    expect(bandOf({ weatherCode: code }, 'ice')).toBe('high')
  })

  it.each([71, 73, 75, 77, 85, 86])('flags snow code %s', (code) => {
    expect(bandOf({ weatherCode: code }, 'snow')).toBe('moderate')
  })
})

describe('the overall verdict', () => {
  it('is the worst hazard present, not an average of them', () => {
    // Pleasant except for the lightning. Averaging would hide it.
    const r = assessWeather({ apparentTempC: 21, windKph: 8, precipMmHr: 0, weatherCode: 95 })
    expect(r.band).toBe('severe')
    expect(r.hazards[0].key).toBe('lightning')
  })

  it('sorts worst first so a bubble showing one row shows the right one', () => {
    const r = assessWeather({ apparentTempC: 41, windKph: 55, uvIndex: 4 })
    expect(r.hazards.map((h) => h.key)).toEqual(['wind', 'heat', 'uv'])
    const levels = r.hazards.map((h) => levelOf(h.band))
    expect(levels).toEqual([...levels].sort((a, b) => b - a))
  })

  it('is clear when nothing is wrong, and lists nothing', () => {
    const r = assessWeather({ apparentTempC: 21, tempC: 21, windKph: 9, precipMmHr: 0, uvIndex: 2, visibilityM: 20000, weatherCode: 1 })
    expect(r.band).toBe('none')
    expect(r.level).toBe(0)
    expect(r.hazards).toEqual([])
  })

  it('omits a hazard the provider had no reading for rather than scoring it zero', () => {
    // A missing visibility field must not read as dense fog.
    const r = assessWeather({ apparentTempC: 21 })
    expect(r.hazards.find((h) => h.key === 'visibility')).toBeUndefined()
    expect(r.band).toBe('none')
  })

  it('survives an empty observation', () => {
    expect(assessWeather()).toEqual({ level: 0, band: 'none', hazards: [] })
    expect(assessWeather({})).toEqual({ level: 0, band: 'none', hazards: [] })
  })

  it('ignores nulls and non-numbers the API may send', () => {
    const r = assessWeather({ apparentTempC: null, windKph: undefined, precipMmHr: NaN, visibilityM: 'n/a' })
    expect(r.hazards).toEqual([])
  })

  it('gives every hazard a label and the work it affects, so the UI never shows a bare number', () => {
    const r = assessWeather({ apparentTempC: 45, windKph: 70, precipMmHr: 12, uvIndex: 11, visibilityM: 150, weatherCode: 95 })
    expect(r.hazards.length).toBeGreaterThan(4)
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
      site({ windKph: 55 }),
      site({ windKph: 45 }),
      site({ apparentTempC: 46 }),
    ])
    expect(out.map((h) => h.key)).toEqual(['wind', 'heat'])
  })

  it('counts how many sites show each one', () => {
    const out = summariseHazards([site({ windKph: 55 }), site({ windKph: 45 }), site({ apparentTempC: 46 })])
    expect(out.find((h) => h.key === 'wind').sites).toBe(2)
    expect(out.find((h) => h.key === 'heat').sites).toBe(1)
  })

  it('reports a category at its worst band across the sites', () => {
    // One site gusting into severe, another merely breezy.
    const out = summariseHazards([site({ windKph: 30 }), site({ windKph: 70 })])
    expect(out[0]).toMatchObject({ key: 'wind', band: 'severe', sites: 2 })
  })

  it('puts the worst category first, then the most widespread', () => {
    const out = summariseHazards([
      site({ uvIndex: 4 }), site({ uvIndex: 4 }), site({ uvIndex: 4 }),
      site({ weatherCode: 95 }),
    ])
    expect(out[0].key).toBe('lightning')
    expect(out[1]).toMatchObject({ key: 'uv', sites: 3 })
  })

  it('does not let one site count twice for the same category', () => {
    const out = summariseHazards([site({ windKph: 60, gustKph: 80 })])
    expect(out.filter((h) => h.key === 'wind')).toHaveLength(1)
    expect(out[0].sites).toBe(1)
  })

  it('is empty when nothing is wrong anywhere', () => {
    expect(summariseHazards([site({ apparentTempC: 21, windKph: 5 })])).toEqual([])
    expect(summariseHazards([])).toEqual([])
    expect(summariseHazards()).toEqual([])
  })

  it('ignores sites that have not been assessed', () => {
    expect(summariseHazards([null, undefined, {}, site({ windKph: 55 })])).toHaveLength(1)
  })

  it('carries the label and level the UI renders', () => {
    const [h] = summariseHazards([site({ weatherCode: 95 })])
    expect(h.label).toBe('Thunderstorm')
    expect(h.level).toBe(levelOf('severe'))
  })
})

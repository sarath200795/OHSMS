import { describe, it, expect } from 'vitest'
import { assessWeather, digestLevel, digestHazards } from './weatherBands.js'
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
    expect(digestLevel(assessWeather({ apparentTempC: 51 }).band)).toBe('High')
    const storm = assessWeather({ weatherCode: 95 })
    expect(digestLevel(storm.band)).toBe('High')
    expect(digestHazards(storm)).toContain('Thunderstorm')
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
  })
})

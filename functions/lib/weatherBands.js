// Weather as an occupational hazard, for the six-hour digest.
//
// This is a copy of src/modules/weather/lib/weatherRisk.js. The functions
// package cannot import the SPA, and the two will disagree the day a cut-off
// moves in only one of them. The numbers are published thresholds (NWS heat,
// Beaufort wind, WHO UV); they are not tunable per org. Change them in both
// files.
//
// The digest only names Medium and High. In this scale that is `moderate`,
// and `high` together with `severe` — the same collapse the rain alert uses
// when it says a cloudburst is "High". Low and none are not a mail.

export const BANDS = ['none', 'low', 'moderate', 'high', 'severe']

function band(value, cuts) {
  let i = 0
  while (i < cuts.length && value >= cuts[i]) i += 1
  return BANDS[i]
}

function bandDescending(value, cuts) {
  let i = 0
  while (i < cuts.length && value <= cuts[i]) i += 1
  return BANDS[i]
}

const levelOf = (b) => BANDS.indexOf(b)

// Heat is only reported from 40°C up. The NWS caution band starts at 27°C,
// which is an ordinary working day at these sites and lit the heat row forever.
const HEAT_CUTS = [40, 45, 51, 56]
const COLD_CUTS = [10, 0, -10, -25]
const WIND_CUTS = [29, 39, 50, 62]
const RAIN_CUTS = [0.5, 4, 10, 30]
const UV_CUTS = [3, 6, 8, 11]
const VIS_CUTS = [5000, 2000, 1000, 200]

const isThunderstorm = (code) => code === 95 || code === 96 || code === 99
const isFreezingRain = (code) => code === 56 || code === 57 || code === 66 || code === 67
const isSnow = (code) => (code >= 71 && code <= 77) || code === 85 || code === 86

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * Assess one normalised observation. Hazards at `none` are dropped.
 * Returns `{ band, hazards: [{ key, label, band }] }` worst first.
 */
export function assessWeather(obs = {}) {
  const { apparentTempC, tempC, windKph, gustKph, precipMmHr, uvIndex, visibilityM, weatherCode } =
    obs
  const hazards = []
  const add = (h) => {
    if (levelOf(h.band) > 0) hazards.push(h)
  }

  const feels = num(apparentTempC) ?? num(tempC)
  if (feels != null) {
    add({ key: 'heat', label: 'Heat stress', band: band(feels, HEAT_CUTS) })
    add({ key: 'cold', label: 'Cold stress', band: bandDescending(feels, COLD_CUTS) })
  }

  const steady = num(windKph)
  const gust = num(gustKph)
  const worstWind = Math.max(steady ?? -Infinity, gust ?? -Infinity)
  if (Number.isFinite(worstWind)) {
    add({ key: 'wind', label: 'High wind', band: band(worstWind, WIND_CUTS) })
  }

  const rain = num(precipMmHr)
  if (rain != null) add({ key: 'rain', label: 'Rain', band: band(rain, RAIN_CUTS) })

  const uv = num(uvIndex)
  if (uv != null) add({ key: 'uv', label: 'UV exposure', band: band(uv, UV_CUTS) })

  const vis = num(visibilityM)
  if (vis != null)
    add({ key: 'visibility', label: 'Poor visibility', band: bandDescending(vis, VIS_CUTS) })

  if (weatherCode != null) {
    if (isThunderstorm(weatherCode))
      add({ key: 'lightning', label: 'Thunderstorm', band: 'severe' })
    if (isFreezingRain(weatherCode)) add({ key: 'ice', label: 'Freezing rain', band: 'high' })
    if (isSnow(weatherCode)) add({ key: 'snow', label: 'Snow', band: 'moderate' })
  }

  hazards.sort((a, b) => levelOf(b.band) - levelOf(a.band))
  const level = hazards.length ? levelOf(hazards[0].band) : 0
  return { band: BANDS[level], hazards }
}

/** 'High', 'Medium', or '' when the band is not worth a digest line. */
export function digestLevel(band) {
  if (band === 'high' || band === 'severe') return 'High'
  if (band === 'moderate') return 'Medium'
  return ''
}

/** Hazard labels on this assessment that themselves sit at Medium or High. */
export function digestHazards(assessment) {
  return (assessment?.hazards || []).filter((h) => digestLevel(h.band)).map((h) => h.label)
}

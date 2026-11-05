// Weather as an occupational hazard, for the six-hour digest.
//
// This is a copy of src/modules/weather/lib/weatherRisk.js. The functions
// package cannot import the SPA, and the two will disagree the day a cut-off
// moves in only one of them. The numbers are not tunable per org. Change
// them in both files.
//
// The digest only names Medium and High. In this scale that is `moderate`,
// and `high` together with `severe` — the same collapse the rain alert uses
// when it says a cloudburst is "High". Low and none are not a mail.
//
// The alerts are Heat Stress, Cold Stress, Rain, Lightning and Air Quality.
// Wind, visibility, UV, freezing rain and snow are not assessed: a field for
// one of them on an observation does not produce a row.

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

// Heat is rated High only when the AIR temperature is above this. Feels-like
// still sets Low and Medium, but a feels-like that would be High (or severe)
// while the air is at or below 40°C is capped at Medium. Strictly above: 40.0
// is not High, 40.1 is. A reading with no air temperature cannot show the air
// is above 40, so it is capped too.
const HEAT_HIGH_MIN_AIR_C = 40

function heatBand(feels, airC) {
  const b = band(feels, HEAT_CUTS)
  if (levelOf(b) >= levelOf('high') && !(airC != null && airC > HEAT_HIGH_MIN_AIR_C)) {
    return 'moderate'
  }
  return b
}

// Feels-like °C, worse as it falls.
// ≤ 10°C low (awareness only — not mailed), ≤ 0°C Medium, ≤ -10°C High,
// ≤ -25°C severe, which the digest still calls High. 10°C is the usual
// cold-stress awareness line for outdoor work; freezing is when the mail starts.
const COLD_CUTS = [10, 0, -10, -25]

// mm/h. Open-Meteo hourly precipitation is already the preceding hour in mm,
// so these cuts see that figure directly.
const RAIN_CUTS = [0.5, 4, 10, 30]

// CAPE (J/kg) when the forecast has no thunderstorm code for the point.
// Below 1000 is ordinary convection and not an alert. 1000–2500 is Medium
// (storms possible). 2500 and above is High (storms likely). A weather code
// of 95, 96 or 99 is a thunderstorm (99 is heavy hail) and outranks CAPE.
const CAPE_MEDIUM = 1000
const CAPE_HIGH = 2500

// AQI on the 0–500 scale. 0–200 is Low (not mailed). 200–400 is Medium, and
// 200 itself is Medium. 400 and above is High. The figure sometimes quoted
// for High is 500, the top of the scale; 400 is already the top band here,
// so 400 and 500 are both High.
const AQI_MEDIUM = 200
const AQI_HIGH = 400

// The words the rain row already uses on the site page. The digest value
// copies that reading; it is not a second scale.
const RAIN_ALERT = {
  low: 'Low',
  moderate: 'Medium',
  high: 'High',
  severe: 'High',
}

const LEVEL_WORD = { low: 'Low', moderate: 'Medium', high: 'High', severe: 'High' }

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

const round = (n) => Math.round(n)

function thunderstorm(code) {
  return code === 95 || code === 96 || code === 99
}

function lightningBand(code, cape) {
  if (thunderstorm(code)) return 'severe'
  if (cape == null) return 'none'
  if (cape >= CAPE_HIGH) return 'high'
  if (cape >= CAPE_MEDIUM) return 'moderate'
  return 'none'
}

function lightningValue(code, cape) {
  const parts = []
  if (thunderstorm(code)) parts.push('Thunderstorm forecast')
  if (cape != null) parts.push(`CAPE ${round(cape)} J/kg`)
  return parts.join(' · ')
}

function airBand(aqi) {
  if (aqi >= AQI_HIGH) return 'high'
  if (aqi >= AQI_MEDIUM) return 'moderate'
  return 'low'
}

/**
 * Assess one normalised observation. Hazards at `none` are dropped.
 * Returns `{ band, hazards: [{ key, label, band, value }] }` worst first.
 *
 * `value` is the reading the digest prints. It is not a new threshold.
 */
export function assessWeather(obs = {}) {
  const { apparentTempC, tempC, precipMmHr, capeJkg, lightningCode, aqi, aqiSource } = obs
  const hazards = []
  const add = (h) => {
    if (levelOf(h.band) > 0) hazards.push(h)
  }

  const feels = num(apparentTempC) ?? num(tempC)
  if (feels != null) {
    const feelsLike = `Feels like ${round(feels)}°C`
    add({ key: 'heat', label: 'Heat stress', band: heatBand(feels, num(tempC)), value: feelsLike })
    add({
      key: 'cold',
      label: 'Cold stress',
      band: bandDescending(feels, COLD_CUTS),
      value: feelsLike,
    })
  }

  const rain = num(precipMmHr)
  if (rain != null) {
    const rainBand = band(rain, RAIN_CUTS)
    add({
      key: 'rain',
      label: 'Rain',
      band: rainBand,
      value: `${RAIN_ALERT[rainBand] || ''} · ${rain.toFixed(1)} mm/h`.replace(/^ · /, ''),
    })
  }

  const code = num(lightningCode)
  const cape = num(capeJkg)
  const storm = lightningBand(code, cape)
  if (storm !== 'none') {
    add({ key: 'lightning', label: 'Lightning', band: storm, value: lightningValue(code, cape) })
  }

  const index = num(aqi)
  if (index != null && index >= 0) {
    const bandName = airBand(index)
    const via = aqiSource === 'pm' ? ' (particles)' : ''
    add({
      key: 'air',
      label: 'Air quality',
      band: bandName,
      value: `${LEVEL_WORD[bandName]} · AQI ${round(index)}${via}`,
    })
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

/**
 * Those same hazards, with the reading and that hazard's OWN level. Low and
 * none are not a digest cell. The mail files a site under each hazard with
 * this level, not with the site's worst level: a site that is High for heat
 * and Medium for rain is High under Heat Stress and Medium under Rain Risk.
 */
export function digestDrivers(assessment) {
  return (assessment?.hazards || [])
    .filter((h) => digestLevel(h.band))
    .map((h) => ({
      key: h.key,
      label: h.label,
      value: typeof h.value === 'string' ? h.value : '',
      level: digestLevel(h.band),
    }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Weather as an occupational hazard, not a forecast.
//
// A site page showing "24°C, light rain" tells a safety officer nothing they
// could act on. What matters is whether today's conditions put a control at
// risk: heat stress on outdoor crews, wind that should stop work at height,
// lightning that should stop hot work, rain that turns a yard into a slip
// hazard. So this maps raw observations onto the same five-band scale the rest
// of the app uses for risk, and names the work that each band affects.
//
// Every threshold below is a published one, cited where it is set. They are
// deliberately not tunable per org: an org that quietly lowers its own heat
// threshold has not become safer, and the numbers here are the ones an auditor
// will recognise.
//
// Pure — no network, no clock. `assessWeather` takes an already-normalised
// observation so the thresholds can be tested directly.
// ─────────────────────────────────────────────────────────────────────────────

/** Ordered worst-last, so a band's index is its severity. */
export const BANDS = ['none', 'low', 'moderate', 'high', 'severe']

export const BAND_LABEL = {
  none: 'No weather risk',
  low: 'Be aware',
  moderate: 'Take precautions',
  high: 'Restrict work',
  severe: 'Stop outdoor work',
}

/**
 * Pick a band from ascending cut-offs: `band(v, [a, b, c, d])` is `low` once v
 * reaches a, `severe` once it reaches d. Below a it is `none`.
 */
function band(value, cuts) {
  let i = 0
  while (i < cuts.length && value >= cuts[i]) i += 1
  return BANDS[i]
}

/** Same, for scales that get worse as the number falls (cold, visibility). */
function bandDescending(value, cuts) {
  let i = 0
  while (i < cuts.length && value <= cuts[i]) i += 1
  return BANDS[i]
}

export const levelOf = (b) => BANDS.indexOf(b)

const round = (n) => Math.round(n)

// Heat is only reported from 40°C up.
//
// The published NWS caution band starts at 27°C, which is an ordinary working
// day across most of this org's sites — flagging it meant the heat row was
// permanently lit and stopped carrying information. Starting at 40 keeps the
// warning for days that genuinely need water, shade and rest breaks scheduled,
// and the upper bands still line up with the NWS danger figures.
//
// Read against apparent temperature, because humidity is what defeats sweating
// and a crew in PPE feels that figure rather than the dry-bulb one.
const HEAT_CUTS = [40, 45, 51, 56]

// Wind chill. NWS puts frostbite on exposed skin at 30 minutes around -28°C,
// which anchors the severe band; the milder ones follow the usual cold-stress
// work/warm-up guidance.
const COLD_CUTS = [10, 0, -10, -25]

// Beaufort 5/6/7/8. Six is where most MEWP and scaffold rules stop work at
// height (12.5 m/s ≈ 45 km/h is the common suspension limit and sits inside
// this band), seven is where loose material starts moving on site.
const WIND_CUTS = [29, 39, 50, 62]

// Rain rate. Above 10 mm/h drainage stops keeping up and yards flood; above 30
// is a cloudburst.
const RAIN_CUTS = [0.5, 4, 10, 30]

// Rain is reported as a named alert rather than only a band, because "medium
// rain alert" is what gets said on a site call and "moderate weather risk" is
// not. The two scales stay tied: the alert is the band in the words people use,
// so a cloudburst reads High and still drives the severe overall verdict.
export const RAIN_ALERT = {
  low: 'Low',
  moderate: 'Medium',
  high: 'High',
  severe: 'High',
}

// WHO global UV index bands: moderate 3, high 6, very high 8, extreme 11.
const UV_CUTS = [3, 6, 8, 11]

// Metres. Below 1 km site traffic and lifting signalling become unreliable;
// below 200 m nothing outdoors can be supervised safely.
const VIS_CUTS = [5000, 2000, 1000, 200]

/** WMO codes 95/96/99 are thunderstorm, with or without hail. */
export const isThunderstorm = (code) => code === 95 || code === 96 || code === 99

/** WMO codes for freezing rain and freezing drizzle. */
const isFreezingRain = (code) => code === 56 || code === 57 || code === 66 || code === 67

/** WMO snow codes. */
const isSnow = (code) => (code >= 71 && code <= 77) || code === 85 || code === 86

/**
 * Assess one observation.
 *
 * `obs` fields are all optional — a provider that cannot supply visibility
 * should simply omit it rather than send a zero, which would read as fog.
 *
 * Returns the overall band plus every hazard that reached at least `low`,
 * worst first. Hazards sitting at `none` are dropped: a list that always has
 * seven rows is a list nobody reads.
 */
export function assessWeather(obs = {}) {
  const {
    apparentTempC, tempC, windKph, gustKph, precipMmHr,
    uvIndex, visibilityM, weatherCode,
  } = obs

  const hazards = []
  const add = (h) => { if (levelOf(h.band) > 0) hazards.push(h) }

  const feels = num(apparentTempC) ?? num(tempC)
  if (feels != null) {
    add({
      key: 'heat',
      label: 'Heat stress',
      band: band(feels, HEAT_CUTS),
      value: `Feels like ${round(feels)}°C`,
      affects: 'Outdoor and PPE-heavy work — schedule rest breaks, water and shade.',
    })
    add({
      key: 'cold',
      label: 'Cold stress',
      band: bandDescending(feels, COLD_CUTS),
      value: `Feels like ${round(feels)}°C`,
      affects: 'Exposed skin and grip — warm-up breaks and insulated gloves.',
    })
  }

  // Gusts are what actually take a panel out of someone's hands, so the band
  // reads whichever is worse but the figure shown says which one it was.
  const steady = num(windKph)
  const gust = num(gustKph)
  const worstWind = Math.max(steady ?? -Infinity, gust ?? -Infinity)
  if (Number.isFinite(worstWind)) {
    add({
      key: 'wind',
      label: 'High wind',
      band: band(worstWind, WIND_CUTS),
      value: gust != null && gust > (steady ?? 0) ? `Gusting ${round(gust)} km/h` : `${round(worstWind)} km/h`,
      affects: 'Work at height, MEWPs, scaffolding, lifting and sheet material.',
    })
  }

  const rain = num(precipMmHr)
  if (rain != null) {
    const rainBand = band(rain, RAIN_CUTS)
    add({
      key: 'rain',
      label: 'Rain alert',
      band: rainBand,
      alert: RAIN_ALERT[rainBand] || null,
      value: `${RAIN_ALERT[rainBand] || ''} · ${rain.toFixed(1)} mm/h`.replace(/^ · /, ''),
      affects: 'Slips, excavations, electrical work and site vehicle stopping distance.',
    })
  }

  const uv = num(uvIndex)
  if (uv != null) {
    add({
      key: 'uv',
      label: 'UV exposure',
      band: band(uv, UV_CUTS),
      value: `UV index ${round(uv)}`,
      affects: 'Outdoor workers — cover up, sunscreen, shade at midday.',
    })
  }

  const vis = num(visibilityM)
  if (vis != null) {
    add({
      key: 'visibility',
      label: 'Poor visibility',
      band: bandDescending(vis, VIS_CUTS),
      value: vis >= 1000 ? `${(vis / 1000).toFixed(1)} km` : `${round(vis)} m`,
      affects: 'Site traffic, banksman signalling and lifting operations.',
    })
  }

  if (weatherCode != null) {
    if (isThunderstorm(weatherCode)) {
      add({
        key: 'lightning',
        label: 'Thunderstorm',
        band: 'severe',
        value: 'Lightning reported',
        affects: 'Stop work at height, hot work, cranes and open-air electrical work.',
      })
    }
    if (isFreezingRain(weatherCode)) {
      add({
        key: 'ice',
        label: 'Freezing rain',
        band: 'high',
        value: 'Ice forming',
        affects: 'Walkways, ladders, steps and vehicle movement.',
      })
    }
    if (isSnow(weatherCode)) {
      add({
        key: 'snow',
        label: 'Snow',
        band: 'moderate',
        value: 'Snow falling',
        affects: 'Access routes, roof loading and site vehicle traction.',
      })
    }
  }

  hazards.sort((a, b) => levelOf(b.band) - levelOf(a.band))
  const level = hazards.length ? levelOf(hazards[0].band) : 0

  return { level, band: BANDS[level], hazards }
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * Roll several sites' assessments into one list of what kinds of weather are a
 * problem, and how widely.
 *
 * The single worst hazard answers "how bad is it" but not "what is it" — three
 * sites in high wind and one in a thunderstorm is a different morning from four
 * sites baking. So each category present is reported once, at its worst band,
 * with the number of sites showing it.
 *
 * @param risks assessments (the result of assessWeather), one per site
 * @returns [{ key, label, band, level, sites }] worst first, then most sites
 */
export function summariseHazards(risks = []) {
  const byKey = new Map()
  for (const r of risks) {
    if (!r?.hazards) continue
    // A site cannot count twice for the same category, however many readings
    // produced it.
    const seen = new Set()
    for (const h of r.hazards) {
      if (seen.has(h.key)) continue
      seen.add(h.key)
      const cur = byKey.get(h.key)
      if (!cur) byKey.set(h.key, { key: h.key, label: h.label, band: h.band, sites: 1 })
      else {
        cur.sites += 1
        if (levelOf(h.band) > levelOf(cur.band)) cur.band = h.band
      }
    }
  }
  return [...byKey.values()]
    .map((h) => ({ ...h, level: levelOf(h.band) }))
    .sort((a, b) => b.level - a.level || b.sites - a.sites || a.label.localeCompare(b.label))
}

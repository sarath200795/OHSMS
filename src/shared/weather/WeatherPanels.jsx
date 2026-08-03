// Weather risk, rendered for the map. Inline styles rather than Tailwind
// classes because these mount inside Leaflet's tooltip and popup panes, where
// the surrounding stylesheet is Leaflet's own and the clay tokens do not apply.
//
// Named WeatherPanels, not WeatherRisk, because a `WeatherRisk.jsx` beside
// `weatherRisk.js` differs only in case: Windows and macOS resolve the import
// to whichever they feel like (here, the wrong one) and Linux to the other, so
// the collision breaks in a different place than it is written.
import { useSiteWeather } from './useSiteWeather'
import { BAND_LABEL } from './weatherRisk'

const BAND_COLOR = {
  none: { bg: '#ecfdf5', fg: '#047857', dot: '#10b981' },
  low: { bg: '#fefce8', fg: '#a16207', dot: '#eab308' },
  moderate: { bg: '#fff7ed', fg: '#c2410c', dot: '#f97316' },
  high: { bg: '#fef2f2', fg: '#b91c1c', dot: '#ef4444' },
  severe: { bg: '#450a0a', fg: '#fee2e2', dot: '#fca5a5' },
}

/** The coloured verdict pill. */
function BandPill({ band, children }) {
  const c = BAND_COLOR[band] || BAND_COLOR.none
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 7px',
      borderRadius: 999, background: c.bg, color: c.fg,
      fontSize: 10.5, fontWeight: 700, lineHeight: 1.5, whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.dot, flex: 'none' }} />
      {children ?? BAND_LABEL[band]}
    </span>
  )
}

/**
 * One line for the hover bubble: the verdict and the single worst hazard.
 *
 * The row keeps its height across loading, ready and error states on purpose.
 * The bubble measures itself when it opens so it can be clamped inside the map,
 * and content that arrives afterwards and grows would push the stats back out
 * of view — the exact problem that measurement exists to solve.
 */
export function WeatherBubbleRow({ lat, lng, active }) {
  const { status, risk } = useSiteWeather(lat, lng, active)

  return (
    <div style={{
      marginTop: 6, paddingTop: 6, borderTop: '1px solid #f1f5f9',
      minHeight: 32, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
    }}>
      {status === 'ready' ? (
        <>
          <BandPill band={risk.band} />
          <span style={{ fontSize: 10.5, color: '#64748b' }}>
            {risk.hazards.length
              ? `${risk.hazards[0].label} · ${risk.hazards[0].value}`
              : 'Conditions are fine for outdoor work'}
          </span>
        </>
      ) : (
        <span style={{ fontSize: 10.5, color: '#94a3b8', fontStyle: 'italic' }}>
          {status === 'error' ? 'Weather unavailable' : 'Checking weather…'}
        </span>
      )}
    </div>
  )
}

/**
 * The full picture for the pin's popup: every hazard above `none`, with the
 * work it puts at risk. This is the part a safety officer acts on, so it names
 * the activity rather than only the measurement.
 */
export function WeatherRiskPanel({ lat, lng, active }) {
  const { status, risk } = useSiteWeather(lat, lng, active)

  if (status !== 'ready') {
    return (
      <div style={{ marginTop: 8, fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>
        {status === 'error' ? 'Weather unavailable right now' : 'Checking weather…'}
      </div>
    )
  }

  return (
    <div style={{ marginTop: 8, borderTop: '1px solid #f1f5f9', paddingTop: 7 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#94a3b8' }}>
          Weather risk
        </span>
        <BandPill band={risk.band} />
      </div>

      {risk.hazards.length === 0 ? (
        <p style={{ fontSize: 11, color: '#64748b', margin: 0 }}>
          Nothing in the current conditions restricts outdoor work.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 5 }}>
          {risk.hazards.map((h) => {
            const c = BAND_COLOR[h.band] || BAND_COLOR.none
            return (
              <li key={h.key} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.dot, flex: 'none', marginTop: 4.5 }} />
                <span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#0f172a' }}>{h.label}</span>
                  <span style={{ fontSize: 11, color: '#64748b' }}> · {h.value}</span>
                  <span style={{ display: 'block', fontSize: 10.5, color: '#94a3b8', lineHeight: 1.35 }}>{h.affects}</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}

      <p style={{ margin: '6px 0 0', fontSize: 9.5, color: '#cbd5e1' }}>
        Open-Meteo, nearest ~1 km. Guidance only — it does not replace a site assessment.
      </p>
    </div>
  )
}

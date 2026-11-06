// Weather risk as a spreadsheet: one row per site, plus a column per alert so
// the file can be sorted and filtered on the thing you care about — every site
// over a rain alert of Medium, or every site with high air quality.
import * as XLSX from 'xlsx'
import { jsonToSheet } from '../../../shared/lib/sheet'
import { BAND_LABEL } from './weatherRisk'
import { formatObservedAt } from './observedAt'
import { downloadBlob } from '../../../shared/lib/download'

export const WEATHER_COLUMNS = [
  'Site',
  'Region',
  'Entity',
  'Risk',
  'Feels Like (°C)',
  'Rain Alert',
  'Cold',
  'Lightning',
  'Air Quality',
  'AQI',
  'Hazards',
  'What It Affects',
  'Location Link',
  'Checked At',
]

const mapsLink = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng)
    ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
    : ''

/**
 * Rows for the export.
 *
 * Sites still loading, or whose lookup failed, are included with a blank risk
 * rather than dropped — a site missing from the file reads as "fine", which is
 * the one thing it must not say.
 */
export function weatherExportRows(sites = [], byId = {}) {
  return sites.map((s) => {
    const r = byId[s.id]
    const risk = r?.risk
    const obs = r?.obs
    const rain = risk?.hazards.find((h) => h.key === 'rain')
    const levelOf = (key) => {
      const hazard = risk?.hazards.find((h) => h.key === key)
      if (!hazard) return risk ? 'None' : ''
      if (hazard.band === 'high' || hazard.band === 'severe') return 'High'
      if (hazard.band === 'moderate') return 'Medium'
      if (hazard.band === 'low') return 'Low'
      return 'None'
    }

    return {
      Site: s.name || '',
      Region: s.region || '',
      Entity: s.entity || '',
      Risk: risk ? BAND_LABEL[risk.band] : 'Not checked',
      'Feels Like (°C)': obs?.apparentTempC != null ? Math.round(obs.apparentTempC) : '',
      'Rain Alert': rain?.alert || (risk ? 'None' : ''),
      Cold: levelOf('cold'),
      Lightning: levelOf('lightning'),
      'Air Quality': levelOf('air'),
      AQI: obs?.aqi != null ? Math.round(obs.aqi) : '',
      Hazards: risk ? risk.hazards.map((h) => `${h.label} (${h.value})`).join('; ') : '',
      'What It Affects': risk ? [...new Set(risk.hazards.map((h) => h.affects))].join(' ') : '',
      'Location Link': mapsLink(s.lat, s.lng),
      'Checked At': formatObservedAt(obs?.observedAt) || obs?.observedAt || '',
    }
  })
}

export function exportWeatherRisk(rows, filename = 'weather-risk.xlsx') {
  const ws = jsonToSheet(
    rows.length ? rows : [Object.fromEntries(WEATHER_COLUMNS.map((c) => [c, '']))]
  )
  ws['!cols'] = WEATHER_COLUMNS.map((c) => ({
    wch:
      c === 'Hazards' || c === 'What It Affects'
        ? 52
        : c === 'Location Link'
          ? 44
          : c === 'Site'
            ? 26
            : 15,
  }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Weather Risk')

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  downloadBlob(new Blob([out], { type: 'application/octet-stream' }), filename)
}

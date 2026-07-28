import { ENERGY_SOURCES, energySourceByKey } from '../constants/energySources'

/** Uppercase alphanumeric slug, hyphen-collapsed (e.g. "Pump A 12" -> "PUMP-A-12"). */
export function slugCode(value, max = 24) {
  return (value || '')
    .toString()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '') // never leave a trailing hyphen after slicing
}

/**
 * Human-readable procedure code in the form ORG-SITE-Equipment, using the full
 * (slugged) organization, site and equipment values. Missing parts fall back to
 * the literal ORG / SITE / EQUIPMENT placeholders.
 */
export function buildProcedureCode({ orgName, site, equipment }) {
  const org = slugCode(orgName, 24) || 'ORG'
  const siteCode = slugCode(site, 24) || 'SITE'
  const equip = slugCode(equipment, 24) || 'EQUIPMENT'
  return `${org}-${siteCode}-${equip}`
}

/**
 * Number isolation points per energy source: E-1, E-2, M-1, ...
 * Returns a new array with `pointId`, `color`, `textColor`, `energyLabel`
 * derived from each point's `energySource` key. Order is preserved.
 */
export function numberIsolationPoints(points = []) {
  const counters = {}
  return points.map((p) => {
    const src = energySourceByKey(p.energySource) || ENERGY_SOURCES[0]
    counters[src.key] = (counters[src.key] || 0) + 1
    return {
      ...p,
      pointId: `${src.prefix}-${counters[src.key]}`,
      color: src.color,
      textColor: src.textColor,
      energyLabel: src.label,
    }
  })
}

/** Absolute URL encoded into a procedure's QR code. */
export function procedureScanUrl(procedureId) {
  const origin =
    typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/p/${procedureId}`
}

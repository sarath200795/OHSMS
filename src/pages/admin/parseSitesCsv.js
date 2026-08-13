import Papa from 'papaparse'

// Flexible header matching so common column names all work.
const HEADER_ALIASES = {
  name: ['site name', 'name', 'site'],
  region: ['region'],
  entity: ['entity', 'company'],
  address: ['address', 'location'],
  lat: ['lat', 'latitude'],
  lng: ['lng', 'long', 'longitude'],
  firstAidBoxes: ['first aid boxes', 'firstaidboxes', 'first_aid_boxes', 'fab', 'first aid box'],
}

function buildKeyMap(fields, customFields = []) {
  const map = {}
  const custom = {}
  ;(fields || []).forEach((raw) => {
    const norm = String(raw).trim().toLowerCase()
    for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(norm)) map[key] = raw
    }
    // Match a column to a custom scope field by its label or key.
    for (const f of customFields) {
      if (norm === f.label.toLowerCase() || norm === f.key.toLowerCase()) custom[f.key] = raw
    }
  })
  return { map, custom }
}

const numOrNull = (v) => {
  if (v == null || String(v).trim() === '') return null
  const n = Number(String(v).trim())
  return Number.isFinite(n) ? n : null
}

/**
 * Parse a sites CSV. Resolves to { rows, valid, invalid, headerOk }.
 * Each row: { name, region, entity, address, lat, lng, firstAidBoxes, __row, __errors }.
 * A row is INVALID (and must not be imported) if it has no name, or is missing a
 * numeric latitude/longitude, or has out-of-range coordinates.
 */
export function parseSitesCsv(file, customFields = []) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: (res) => {
        const { map: km, custom } = buildKeyMap(res.meta?.fields, customFields)
        const headerOk = Boolean(km.name && km.lat && km.lng)
        const rows = (res.data || []).map((r, i) => {
          const lat = numOrNull(r[km.lat])
          const lng = numOrNull(r[km.lng])
          const name = (km.name ? r[km.name] : '')?.toString().trim() || ''
          const errors = []
          if (!name) errors.push('Missing site name')
          if (lat == null) errors.push('Missing/invalid latitude')
          else if (lat < -90 || lat > 90) errors.push('Latitude out of range')
          if (lng == null) errors.push('Missing/invalid longitude')
          else if (lng < -180 || lng > 180) errors.push('Longitude out of range')
          const attributes = {}
          for (const f of customFields) {
            const v = (custom[f.key] ? r[custom[f.key]] : '')?.toString().trim() || ''
            if (v) attributes[f.key] = v
          }
          return {
            __row: i + 2, // +1 header, +1 for 1-based
            __errors: errors,
            name,
            region: (km.region ? r[km.region] : '')?.toString().trim() || '',
            entity: (km.entity ? r[km.entity] : '')?.toString().trim() || '',
            address: (km.address ? r[km.address] : '')?.toString().trim() || '',
            lat,
            lng,
            firstAidBoxes: numOrNull(km.firstAidBoxes ? r[km.firstAidBoxes] : '') || 0,
            attributes,
          }
        })
        resolve({
          headerOk,
          rows,
          valid: rows.filter((r) => r.__errors.length === 0),
          invalid: rows.filter((r) => r.__errors.length > 0),
        })
      },
      error: reject,
    })
  })
}

// CSV template — appends a column per configured custom scope field.
export function sitesCsvTemplate(customFields = []) {
  const extraCols = customFields.map((f) => f.label).join(',')
  const extraHead = extraCols ? `,${extraCols}` : ''
  const extraVals = customFields.map(() => '').join(',')
  const extra = extraVals ? `,${extraVals}` : ''
  return (
    `Site Name,Region,Entity,Address,Latitude,Longitude,First Aid Boxes${extraHead}\n` +
    `North Plant,North,Acme Mfg,"Gelderd Rd, Leeds, UK",53.7833,-1.5766,4${extra}\n` +
    `South Warehouse,South,Acme Logistics,"Avonmouth, Bristol, UK",51.5045,-2.6997,2${extra}\n`
  )
}

/**
 * The site register as CSV, coordinates included.
 *
 * Headers are the SAME ones sitesCsvTemplate emits and buildKeyMap accepts, so
 * the file round-trips: export, fix the coordinates in a spreadsheet, import
 * the same file back. An export whose columns the importer rejects is a dead
 * end, and the two would drift the first time either was edited alone — hence
 * one source for the header row.
 *
 * Quoting is Papa's, not hand-rolled: addresses carry commas, names carry
 * apostrophes, and a naive join produces a file that opens misaligned in Excel
 * and imports as garbage.
 */
export const SITE_CSV_HEADERS = ['Site Name', 'Region', 'Entity', 'Address', 'Latitude', 'Longitude', 'First Aid Boxes']

export function sitesToCsv(sites = [], customFields = []) {
  const fields = [...SITE_CSV_HEADERS, ...customFields.map((f) => f.label)]
  const data = (sites || [])
    .filter(Boolean)
    .map((s) => [
      s.name ?? '',
      s.region ?? '',
      s.entity ?? '',
      s.address ?? '',
      // Blank, not 0 and not "null": a site whose coordinates were never set
      // must read as missing, because a zero here is a real place in the Gulf
      // of Guinea and would be plotted as one.
      s.lat == null || s.lat === '' ? '' : s.lat,
      s.lng == null || s.lng === '' ? '' : s.lng,
      s.firstAidBoxes == null || s.firstAidBoxes === '' ? '' : s.firstAidBoxes,
      ...customFields.map((f) => s.attributes?.[f.key] ?? ''),
    ])
  return Papa.unparse({ fields, data })
}

/** True when a site can actually be put on a map. */
export function hasCoordinates(site) {
  return Number.isFinite(Number(site?.lat)) && site?.lat !== '' && site?.lat != null
    && Number.isFinite(Number(site?.lng)) && site?.lng !== '' && site?.lng != null
}

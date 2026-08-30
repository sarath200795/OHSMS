import Papa from 'papaparse'

// Flexible header matching so common column names all work.
const HEADER_ALIASES = {
  name: ['site name', 'name', 'site'],
  // The site's id in the system that owns it. Deliberately generous, because
  // this column arrives named after whatever produced it — a warehouse export
  // says `center_service_id`, a property list says `Store Code`, and asking an
  // admin to rename a column before importing is a step they will skip.
  code: [
    'centre id', 'center id', 'centre code', 'center code', 'site code', 'code',
    'centre_service_id', 'center_service_id', 'centerserviceid', 'centreserviceid',
    'external id', 'externalid', 'store code', 'store id', 'site id',
  ],
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
 * Parse a sites CSV. Resolves to { rows, valid, invalid, headerOk, hasCodes }.
 * Each row: { name, code, region, entity, address, lat, lng, firstAidBoxes, __row, __errors }.
 * A row is INVALID (and must not be imported) if it has no name, is missing a
 * numeric latitude/longitude, has out-of-range coordinates, or carries a centre
 * id that something else already claims.
 *
 * Only the FILE is judged here. Whether a row is a new site or an edit to one
 * that already exists is `planImport`'s question, because it needs the register
 * and this does not.
 */
export function parseSitesCsv(file, customFields = []) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: (res) => {
        const { map: km, custom } = buildKeyMap(res.meta?.fields, customFields)
        const headerOk = Boolean(km.name && km.lat && km.lng)
        // ── Why a duplicate centre id is an ERROR, not a warning ─────────────
        //
        // The whole point of the column is to be a key. Two sites claiming one
        // id makes every join on it ambiguous, and the failure is silent and
        // wrong rather than loud: an external dataset's rows land on whichever
        // site the lookup happened to keep, so a centre's audits get attributed
        // to a different centre and nothing on any screen says so.
        //
        // Blocking the row is the kind thing to do. The alternative is an
        // import that succeeds and a dashboard that lies.
        const seen = new Map()
        const rows = (res.data || []).map((r, i) => {
          const rowNo = i + 2 // +1 header, +1 for 1-based
          const lat = numOrNull(r[km.lat])
          const lng = numOrNull(r[km.lng])
          const name = (km.name ? r[km.name] : '')?.toString().trim() || ''
          const code = (km.code ? r[km.code] : '')?.toString().trim() || ''
          const errors = []
          if (!name) errors.push('Missing site name')
          if (lat == null) errors.push('Missing/invalid latitude')
          else if (lat < -90 || lat > 90) errors.push('Latitude out of range')
          if (lng == null) errors.push('Missing/invalid longitude')
          else if (lng < -180 || lng > 180) errors.push('Longitude out of range')
          if (code) {
            // Only a collision INSIDE the file is an error. A code that matches
            // a site already in the register is not a clash — it is how you say
            // "this row is that site", and planImport turns it into an edit.
            const earlier = seen.get(code)
            if (earlier) errors.push(`Centre ID ${code} is already used on row ${earlier}`)
            else seen.set(code, rowNo)
          }
          const attributes = {}
          for (const f of customFields) {
            const v = (custom[f.key] ? r[custom[f.key]] : '')?.toString().trim() || ''
            if (v) attributes[f.key] = v
          }
          return {
            __row: rowNo,
            __errors: errors,
            name,
            code,
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
          // Whether the file offered the column at all. The import screen says
          // so, because "I imported the centre ids" and "the column was called
          // something nothing recognised" look identical afterwards.
          hasCodes: Boolean(km.code),
          // Which columns the file actually carried. Load-bearing for an
          // update: a file with no Region column must LEAVE the region alone,
          // not overwrite it with the empty string this parser filled in.
          present: {
            name: true, lat: true, lng: true,      // headerOk already required these
            code: Boolean(km.code),
            region: Boolean(km.region),
            entity: Boolean(km.entity),
            address: Boolean(km.address),
            firstAidBoxes: Boolean(km.firstAidBoxes),
            custom: customFields.filter((f) => custom[f.key]).map((f) => f.key),
          },
          rows,
          valid: rows.filter((r) => r.__errors.length === 0),
          invalid: rows.filter((r) => r.__errors.length > 0),
        })
      },
      error: reject,
    })
  })
}

const normName = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * Decide, for each parsed row, whether it is a NEW site or an edit to one that
 * already exists — and what exactly would change.
 *
 * ── Why an import updates rather than always inserting ───────────────────────
 *
 * Re-importing a corrected spreadsheet is the normal way this file gets used:
 * export the register, fix the coordinates or paste the centre ids in, put it
 * back. An importer that only ever inserts turns that into a duplicate of every
 * site, and the duplicates are indistinguishable from the originals.
 *
 * ── What counts as "the same site" ───────────────────────────────────────────
 *
 * The centre id first, because it is a key and a name is not — a site that has
 * been renamed still matches, which is exactly what you want. Failing that, the
 * name, compared case- and whitespace-insensitively so "north plant" and
 * "North  Plant" are one site.
 *
 * When a row's centre id points at one site and its name at another, the ID
 * wins and the name is treated as a rename. That is the only reading that keeps
 * an id meaning anything.
 *
 * ── What an update is allowed to touch ───────────────────────────────────────
 *
 * ONLY the columns the file actually carried. A spreadsheet holding just names
 * and centre ids must not wipe every address in the register on its way past,
 * and `present` is what stops it. Custom attributes are merged over the
 * existing ones for the same reason.
 */
export function planImport(parsed, sites = []) {
  const present = parsed?.present || { name: true, lat: true, lng: true, custom: [] }
  const byCode = new Map()
  const byName = new Map()
  for (const s of sites || []) {
    const code = String(s?.code ?? '').trim()
    if (code && !byCode.has(code)) byCode.set(code, s)
    const n = normName(s?.name)
    if (n && !byName.has(n)) byName.set(n, s)
  }

  // Two rows resolving to one site would apply in file order and leave whoever
  // ran the import with no idea which won, so the second is refused.
  const claimedBy = new Map()

  const rows = (parsed?.rows || []).map((r) => {
    if (r.__errors.length) return { ...r, __match: null }
    const target = (r.code && byCode.get(r.code)) || byName.get(normName(r.name)) || null
    if (!target) return { ...r, __match: null }

    const earlier = claimedBy.get(target.id)
    if (earlier) {
      return {
        ...r,
        __match: null,
        __errors: [...r.__errors, `Row ${earlier} already updates “${target.name}”`],
      }
    }
    claimedBy.set(target.id, r.__row)
    return {
      ...r,
      __match: {
        id: target.id,
        name: target.name,
        by: r.code && byCode.get(r.code) === target ? 'id' : 'name',
        // The rename is worth showing: a centre-id match on a row with a
        // different name silently retitles a site otherwise.
        renameTo: normName(target.name) === normName(r.name) ? '' : r.name,
      },
      __changes: changedFields(r, target, present),
    }
  })

  const valid = rows.filter((r) => r.__errors.length === 0)
  return {
    ...parsed,
    rows,
    valid,
    invalid: rows.filter((r) => r.__errors.length > 0),
    creates: valid.filter((r) => !r.__match),
    updates: valid.filter((r) => r.__match),
  }
}

/** The fields a row would actually change on the site it matched. */
function changedFields(row, site, present) {
  const out = {}
  const put = (k, v, was) => {
    // Compared as strings so 53.78 from the file and 53.78 from Firestore do
    // not read as a change every single import.
    if (String(v ?? '') !== String(was ?? '')) out[k] = { from: was ?? '', to: v ?? '' }
  }
  // Mirrors updatePayload: a difference in case or spacing alone is not a
  // change, so the preview must not advertise one.
  if (present.name && normName(row.name) !== normName(site.name)) put('name', row.name, site.name)
  if (present.code) put('code', row.code, site.code)
  if (present.region) put('region', row.region, site.region)
  if (present.entity) put('entity', row.entity, site.entity)
  if (present.address) put('address', row.address, site.address)
  if (present.lat) put('lat', row.lat, site.lat)
  if (present.lng) put('lng', row.lng, site.lng)
  if (present.firstAidBoxes) put('firstAidBoxes', row.firstAidBoxes, site.firstAidBoxes)
  for (const key of present.custom || []) {
    put(`attributes.${key}`, row.attributes?.[key], site.attributes?.[key])
  }
  return out
}

/**
 * The update payload for a matched row: the present columns and nothing else.
 *
 * This is the function that keeps an import from being destructive, so it is
 * deliberately dull — it copies across exactly what the file had a column for,
 * and merges custom attributes over whatever the site already carried rather
 * than replacing the map.
 */
export function updatePayload(row, site, present) {
  const out = {}
  // The name is rewritten only when it is genuinely different. Matching is
  // case- and whitespace-insensitive, so a sheet holding "north  plant" finds
  // "North Plant" — and then writing the sheet's spelling back would quietly
  // restyle the register every time somebody imported a hastily typed file.
  // A real rename (normally arriving on a centre-ID match) still goes through.
  if (present.name && normName(row.name) !== normName(site.name)) out.name = row.name
  if (present.code) out.code = row.code
  if (present.region) out.region = row.region
  if (present.entity) out.entity = row.entity
  if (present.address) out.address = row.address
  if (present.lat) out.lat = row.lat
  if (present.lng) out.lng = row.lng
  if (present.firstAidBoxes) out.firstAidBoxes = row.firstAidBoxes
  const custom = present.custom || []
  if (custom.length) {
    out.attributes = { ...(site.attributes || {}) }
    for (const key of custom) {
      const v = row.attributes?.[key]
      if (v) out.attributes[key] = v
    }
  }
  return out
}

/** code → site name, for the collision check above. Blank codes are not keys. */
export function codeIndex(sites = []) {
  const out = new Map()
  for (const s of sites || []) {
    const code = String(s?.code ?? '').trim()
    if (code && !out.has(code)) out.set(code, s.name || '')
  }
  return out
}

/**
 * Sites in the register sharing a centre id, as code → [names].
 *
 * Only ever produced by data that got in before the import gained its
 * duplicate check, or by two admins editing at once. Surfaced on the page
 * rather than left to be discovered through a wrong number on a dashboard.
 */
export function duplicateCodes(sites = []) {
  const byCode = new Map()
  for (const s of sites || []) {
    const code = String(s?.code ?? '').trim()
    if (!code) continue
    if (!byCode.has(code)) byCode.set(code, [])
    byCode.get(code).push(s.name || '(unnamed)')
  }
  return [...byCode.entries()].filter(([, names]) => names.length > 1)
}

// CSV template — appends a column per configured custom scope field.
export function sitesCsvTemplate(customFields = []) {
  const extraCols = customFields.map((f) => f.label).join(',')
  const extraHead = extraCols ? `,${extraCols}` : ''
  const extraVals = customFields.map(() => '').join(',')
  const extra = extraVals ? `,${extraVals}` : ''
  return (
    `Site Name,Centre ID,Region,Entity,Address,Latitude,Longitude,First Aid Boxes${extraHead}\n` +
    `North Plant,NP-001,North,Acme Mfg,"Gelderd Rd, Leeds, UK",53.7833,-1.5766,4${extra}\n` +
    `South Warehouse,SW-002,South,Acme Logistics,"Avonmouth, Bristol, UK",51.5045,-2.6997,2${extra}\n`
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
export const SITE_CSV_HEADERS = ['Site Name', 'Centre ID', 'Region', 'Entity', 'Address', 'Latitude', 'Longitude', 'First Aid Boxes']

export function sitesToCsv(sites = [], customFields = []) {
  const fields = [...SITE_CSV_HEADERS, ...customFields.map((f) => f.label)]
  const data = (sites || [])
    .filter(Boolean)
    .map((s) => [
      s.name ?? '',
      // Second column on purpose: exporting the register, pasting the ids in
      // beside the names and importing it back is the fastest way to fill this
      // in for an estate that already exists here.
      s.code ?? '',
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

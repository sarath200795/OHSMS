// ─────────────────────────────────────────────────────────────────────────────
// Bulk import for DVRs and cameras.
//
// The hard part is not parsing a spreadsheet, it is that a camera's value comes
// entirely from what it is attached to. Whoever fills in the sheet knows their
// DVR as "DVR-Gate-01" and their site as "North Plant"; Firestore knows them as
// auto-ids. So every row has to be resolved against what already exists, and a
// row that cannot be resolved has to FAIL rather than import with a blank link.
//
// That is the rule this file exists to enforce. A camera with no DVR is not a
// slightly incomplete record — it is a camera whose health can never be judged,
// invisible to the cascade, and quietly absent from every report. Importing a
// thousand of those and calling it a success is worse than importing none.
//
// Everything here is pure: rows in, validated rows out. Nothing writes.
// ─────────────────────────────────────────────────────────────────────────────

import { assertWorkbookSize, assertRowCount } from '../../../shared/lib/workbookGuard'
import { parseCsvText } from '../../../shared/lib/parseTable'

const clean = (v) => String(v ?? '').trim()
const key = (v) => clean(v).toLowerCase()

/** Column headings people actually type, mapped to our fields. */
const DVR_ALIASES = {
  name: ['dvr name', 'dvr', 'name', 'dvr id', 'device name'],
  ipAddress: ['ip address', 'ip', 'ipaddress', 'ip addr'],
  siteName: ['site', 'site name', 'location site', 'branch'],
  channels: ['channels', 'no. of channels', 'no of channels', 'channel count', 'ports'],
  make: ['make', 'brand', 'manufacturer'],
  model: ['model'],
  location: ['location', 'placed at', 'room'],
  status: ['status', 'state'],
}

const CAMERA_ALIASES = {
  name: ['camera name', 'camera', 'name', 'camera id', 'device name'],
  location: ['location', 'camera location', 'area', 'placed at', 'view'],
  dvrName: ['dvr', 'dvr name', 'records to', 'connected dvr', 'nvr'],
  siteName: ['site', 'site name', 'branch'],
  channel: ['channel', 'ch', 'channel no', 'port'],
  make: ['make', 'brand', 'manufacturer'],
  model: ['model'],
  status: ['status', 'state'],
}

export const DVR_COLUMNS = ['DVR Name', 'IP Address', 'Site', 'Channels', 'Make', 'Model', 'Location', 'Status']
export const CAMERA_COLUMNS = ['Camera Name', 'Location', 'DVR', 'Site', 'Channel', 'Make', 'Model', 'Status']

/** Free text to a status we store. Blank means "nobody has checked". */
export function normalizeStatus(raw) {
  const v = key(raw)
  if (!v) return 'unknown'
  if (['online', 'up', 'active', 'working', 'ok', 'yes'].includes(v)) return 'online'
  if (['offline', 'down', 'inactive', 'not working', 'faulty', 'no'].includes(v)) return 'offline'
  return 'unknown'
}

/** Build {ourField: theirHeader} from whatever the sheet actually calls things. */
function headerMap(fields = [], aliases) {
  const map = {}
  for (const raw of fields) {
    const k = key(raw)
    for (const [field, names] of Object.entries(aliases)) {
      // First match wins, so a sheet with both "DVR" and "DVR Name" does not
      // flip-flop depending on column order.
      if (!map[field] && names.includes(k)) map[field] = raw
    }
  }
  return map
}

/**
 * An index of existing records by lowercased name.
 *
 * Names that appear twice are recorded as ambiguous rather than resolving to
 * whichever was seen last: attaching forty cameras to the wrong one of two
 * identically-named DVRs is a mistake nobody would catch by looking.
 */
export function nameIndex(rows = [], field = 'name') {
  const byName = new Map()
  const duplicates = new Set()
  for (const r of rows) {
    const k = key(r?.[field])
    if (!k) continue
    if (byName.has(k)) duplicates.add(k)
    else byName.set(k, r)
  }
  return {
    lookup(name) {
      const k = key(name)
      if (!k) return { status: 'empty' }
      if (duplicates.has(k)) return { status: 'ambiguous' }
      const hit = byName.get(k)
      return hit ? { status: 'ok', row: hit } : { status: 'missing' }
    },
    has: (name) => byName.has(key(name)) && !duplicates.has(key(name)),
    size: byName.size,
  }
}

// ── DVR rows ─────────────────────────────────────────────────────────────────

export function validateDvrRows(raw = [], { sites = [], dvrs = [] } = {}) {
  const siteIdx = nameIndex(sites, 'name')
  const existing = nameIndex(dvrs, 'name')
  const seen = new Set()

  return raw.map((r, i) => {
    const errors = []
    const name = clean(r.name)
    if (!name) errors.push('Missing DVR name')
    else if (seen.has(key(name))) errors.push('Duplicate DVR name in this file')
    else if (existing.has(name)) errors.push('A DVR with this name already exists')
    seen.add(key(name))

    // A DVR with no site cannot be darkened by its Meraki, so the cascade
    // silently stops there. That is a hard error, not a blank field.
    const site = siteIdx.lookup(r.siteName)
    if (site.status === 'empty') errors.push('Missing site')
    else if (site.status === 'missing') errors.push(`Site "${clean(r.siteName)}" is not in the site registry`)
    else if (site.status === 'ambiguous') errors.push(`More than one site is called "${clean(r.siteName)}"`)

    const channelsRaw = clean(r.channels)
    const channels = channelsRaw ? Number(channelsRaw) : 0
    if (channelsRaw && (!Number.isFinite(channels) || channels < 0)) errors.push('Channels must be a number')

    return {
      row: i + 2, // +2: one for the header, one for 1-based spreadsheet rows
      errors,
      data: {
        name,
        ipAddress: clean(r.ipAddress),
        siteId: site.row?.id || '',
        siteName: site.row?.name || clean(r.siteName),
        channels: Number.isFinite(channels) ? channels : 0,
        make: clean(r.make),
        model: clean(r.model),
        location: clean(r.location),
        status: normalizeStatus(r.status),
        defects: [],
      },
    }
  })
}

// ── Camera rows ──────────────────────────────────────────────────────────────

export function validateCameraRows(raw = [], { sites = [], dvrs = [], cameras = [] } = {}) {
  const siteIdx = nameIndex(sites, 'name')
  const dvrIdx = nameIndex(dvrs, 'name')
  const existing = nameIndex(cameras, 'name')
  const seen = new Set()

  return raw.map((r, i) => {
    const errors = []
    const name = clean(r.name)
    if (!name) errors.push('Missing camera name')
    else if (seen.has(key(name))) errors.push('Duplicate camera name in this file')
    else if (existing.has(name)) errors.push('A camera with this name already exists')
    seen.add(key(name))

    // The link that decides whether this camera can ever be assessed.
    const dvr = dvrIdx.lookup(r.dvrName)
    if (dvr.status === 'empty') errors.push('Missing DVR — a camera must record to one')
    else if (dvr.status === 'missing') {
      errors.push(
        dvrIdx.size === 0
          ? `No DVRs exist yet — import the DVRs before the cameras`
          : `DVR "${clean(r.dvrName)}" was not found`
      )
    } else if (dvr.status === 'ambiguous') errors.push(`More than one DVR is called "${clean(r.dvrName)}"`)

    // Site is optional: a camera inherits its DVR's site when left blank, which
    // is the common case and saves repeating it on every row.
    const site = siteIdx.lookup(r.siteName)
    if (site.status === 'missing') errors.push(`Site "${clean(r.siteName)}" is not in the site registry`)
    else if (site.status === 'ambiguous') errors.push(`More than one site is called "${clean(r.siteName)}"`)

    const resolvedSite = site.row || (dvr.row ? { id: dvr.row.siteId, name: dvr.row.siteName } : null)

    return {
      row: i + 2,
      errors,
      data: {
        name,
        location: clean(r.location),
        dvrId: dvr.row?.id || '',
        siteId: resolvedSite?.id || '',
        siteName: resolvedSite?.name || '',
        channel: clean(r.channel),
        make: clean(r.make),
        model: clean(r.model),
        status: normalizeStatus(r.status),
        defects: [],
      },
    }
  })
}

// ── File parsing ─────────────────────────────────────────────────────────────

/**
 * Read a .xlsx/.xls/.csv into raw field objects.
 *
 * One parser for all three: SheetJS reads CSV as well as workbooks, and a
 * second code path would be a second place for the header aliasing to drift.
 */
export function parseWorkbook(buffer, kind) {
  const aliases = kind === 'dvrs' ? DVR_ALIASES : CAMERA_ALIASES
  assertWorkbookSize(buffer?.byteLength)
  // CSV, not a workbook: the npm xlsx package carries an unfixable
  // prototype-pollution advisory and this is an untrusted upload. See
  // shared/lib/parseTable.
  const text = typeof buffer === 'string'
    ? buffer
    : new TextDecoder().decode(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer || []))
  const { rows: table, fields } = parseCsvText(text)
  if (!fields.length) return { headerOk: false, rows: [], headers: [] }
  assertRowCount(table.length)
  const headers = fields
  const map = headerMap(headers, aliases)

  // Without these two the sheet is not the template, and every row would fail
  // for the same reason — better to say so once about the file.
  const headerOk = kind === 'dvrs' ? Boolean(map.name) : Boolean(map.name && map.dvrName)

  const rows = table.map((r) => {
    const out = {}
    for (const [field, header] of Object.entries(map)) out[field] = r[header]
    return out
  })
  return { headerOk, rows, headers, mapped: Object.keys(map) }
}

/** Parse and validate in one call — what the page actually wants. */
export function parseImport(buffer, kind, context) {
  const { headerOk, rows, headers } = parseWorkbook(buffer, kind)
  if (!headerOk) return { headerOk: false, headers, valid: [], invalid: [], total: 0 }
  const checked = kind === 'dvrs' ? validateDvrRows(rows, context) : validateCameraRows(rows, context)
  return {
    headerOk: true,
    headers,
    total: checked.length,
    valid: checked.filter((r) => r.errors.length === 0),
    invalid: checked.filter((r) => r.errors.length > 0),
  }
}

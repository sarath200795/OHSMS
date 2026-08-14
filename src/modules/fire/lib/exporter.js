// xlsx helpers: bulk-upload template, parsing uploads, and exporting lists.
import * as XLSX from 'xlsx'
import { format } from 'date-fns'
import {
  BULK_COLUMNS, TYPES, CAPACITIES, ENTITIES, REGIONS, DEFAULT_REGION, STATUS, STATUS_LABEL, DEFECTS, normalizeEntity,
  FAS_DEVICE_TYPES, AED_STATUS, AED_STATUS_LABEL, FAS_STATUS, FAS_STATUS_LABEL,
} from './constants'
import { severityLabel, toDate } from './extinguisherLogic'
import { tokenFromQrValue } from './qr'
import { assertWorkbookSize, assertRowCount } from '../../../shared/lib/workbookGuard'
import { parseCsvFile } from '../../../shared/lib/parseTable'

/**
 * Map an exported "Status" label back to its stored key.
 * Anything unrecognised falls back to Active, which is what a fresh unit is.
 */
export function statusFromLabel(value) {
  const v = String(value ?? '').trim().toLowerCase()
  if (!v) return STATUS.ACTIVE
  const hit = Object.entries(STATUS_LABEL).find(([, label]) => label.toLowerCase() === v)
  return hit ? hit[0] : STATUS.ACTIVE
}

/**
 * Map an exported "Condition" label back to a stored defect list.
 *
 * The export writes one label — the single most severe condition — so this
 * cannot recover a unit's full defect list. It recovers the one that matters,
 * which is the difference between a unit arriving flagged and arriving looking
 * healthy. Conditions derived from dates ("HPT Overdue", "Refill Due Soon") are
 * deliberately ignored: they are recomputed from the dates that come across,
 * and storing them as defects would double-count.
 */
export function defectsFromCondition(value) {
  const v = String(value ?? '').trim().toLowerCase()
  if (!v || v === 'healthy') return []
  const hit = DEFECTS.find((d) => d.label.toLowerCase() === v)
  return hit ? [hit.key] : []
}

// Normalize a cell value (Date or string) to a yyyy-MM-dd string.
function toISODate(v) {
  if (!v) return ''
  if (v instanceof Date) return format(v, 'yyyy-MM-dd')
  const d = toDate(v)
  return d ? format(d, 'yyyy-MM-dd') : String(v)
}

// Robust browser download: build an array buffer, wrap in a Blob, click a
// temporary link. (XLSX.writeFile can fail silently in some bundled builds.)
function downloadWorkbook(wb, filename) {
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  const blob = new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function bookFromRows(rows, sheetName = 'Extinguishers') {
  const ws = XLSX.utils.json_to_sheet(rows, rows.length ? undefined : { header: BULK_COLUMNS })
  ws['!cols'] = (rows.length ? Object.keys(rows[0]) : BULK_COLUMNS).map(() => ({ wch: 20 }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  return wb
}

/** Generic one-sheet export of an array of flat {column: value} row objects. */
export function exportRows(rows, sheetName = 'Sheet1', filename = 'export.xlsx') {
  downloadWorkbook(bookFromRows(rows, sheetName), filename)
}

// ── AED / FAS bulk upload ─────────────────────────────────────────────────────
export const AED_BULK_COLUMNS = ['Asset ID', 'Brand', 'Model', 'Site', 'Region', 'Entity', 'Location', 'Status', 'Install Date', 'Battery Expiry', 'Pad Expiry', 'Last Inspection', 'Next Inspection', 'Notes']
export const FAS_BULK_COLUMNS = ['Device ID', 'Device Type', 'Zone', 'Site', 'Region', 'Entity', 'Location', 'Status', 'Install Date', 'Last Service', 'Next Service', 'AMC Vendor', 'Notes']

const ASSET_CFG = {
  aed: {
    columns: AED_BULK_COLUMNS, sheet: 'AED', file: 'fire-marshal-aed-template.xlsx',
    statuses: AED_STATUS, statusLabels: AED_STATUS_LABEL, defaultStatus: AED_STATUS.READY,
    example: { 'Asset ID': 'AED-001', Brand: 'Philips', Model: 'HeartStart FRx', Site: 'Tower B - Lobby', Region: 'North', Entity: '1P', Location: 'Reception cabinet', Status: 'Ready', 'Install Date': '2024-01-15', 'Battery Expiry': '2027-01-15', 'Pad Expiry': '2026-01-15', 'Last Inspection': '2025-01-15', 'Next Inspection': '2026-01-15', Notes: '' },
  },
  fas: {
    columns: FAS_BULK_COLUMNS, sheet: 'FAS', file: 'fire-marshal-fas-template.xlsx',
    statuses: FAS_STATUS, statusLabels: FAS_STATUS_LABEL, defaultStatus: FAS_STATUS.OPERATIONAL,
    example: { 'Device ID': 'MCP-03', 'Device Type': 'Manual Call Point', Zone: 'Zone 4', Site: 'Tower B', Region: 'North', Entity: '1P', Location: '3rd floor lobby', Status: 'Operational', 'Install Date': '2024-01-15', 'Last Service': '2025-01-15', 'Next Service': '2026-01-15', 'AMC Vendor': 'Acme Fire Systems', Notes: '' },
  },
}

// Resolve a status cell to a valid key (accepts the key OR the label; blank → default).
function matchStatus(v, cfg) {
  const s = String(v ?? '').trim().toLowerCase()
  if (!s) return cfg.defaultStatus
  for (const key of Object.values(cfg.statuses)) {
    if (s === key || s === (cfg.statusLabels[key] || '').toLowerCase()) return key
  }
  return cfg.defaultStatus
}

/** Download an AED or FAS bulk-upload template. */
export function downloadAssetTemplate(kind) {
  const cfg = ASSET_CFG[kind]
  const ws = XLSX.utils.json_to_sheet([cfg.example], { header: cfg.columns })
  ws['!cols'] = cfg.columns.map(() => ({ wch: 18 }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, cfg.sheet)
  downloadWorkbook(wb, cfg.file)
}

/** Parse an AED/FAS upload → { valid, errors, total }. */
export async function parseAssetUpload(kind, file) {
  const cfg = ASSET_CFG[kind]
  assertWorkbookSize(file?.size, file?.name)
  // Wrap in Uint8Array: with a bare ArrayBuffer, SheetJS can misread the xlsx
  // zip container as a text sheet and silently return garbage rows instead of
  // failing — which looks like a bad spreadsheet rather than a parsing bug.
  const { rows } = await parseCsvFile(file)
  assertRowCount(rows.length)
  const valid = []
  const errors = []
  const S = (r, k) => String(r[k] ?? '').trim()

  rows.forEach((r, idx) => {
    const rowNum = idx + 2
    const region = S(r, 'Region')
    const entity = normalizeEntity(S(r, 'Entity'))
    const data = kind === 'aed'
      ? {
          assetId: S(r, 'Asset ID'), brand: S(r, 'Brand'), model: S(r, 'Model'), centerName: S(r, 'Site'),
          region, entity, location: S(r, 'Location'), status: matchStatus(r['Status'], cfg),
          installDate: toISODate(r['Install Date']), batteryExpiry: toISODate(r['Battery Expiry']),
          padExpiry: toISODate(r['Pad Expiry']), lastInspection: toISODate(r['Last Inspection']),
          nextInspection: toISODate(r['Next Inspection']), notes: S(r, 'Notes'),
        }
      : {
          deviceId: S(r, 'Device ID'), deviceType: S(r, 'Device Type') || 'Other', zone: S(r, 'Zone'),
          centerName: S(r, 'Site'), region, entity, location: S(r, 'Location'), status: matchStatus(r['Status'], cfg),
          installDate: toISODate(r['Install Date']), lastService: toISODate(r['Last Service']),
          nextService: toISODate(r['Next Service']), amcVendor: S(r, 'AMC Vendor'), notes: S(r, 'Notes'),
        }

    const issues = []
    if (!data.centerName) issues.push('Site is required')
    if (region && !REGIONS.includes(region)) issues.push(`Region must be one of ${REGIONS.join(', ')}`)
    if (entity && !ENTITIES.includes(entity)) issues.push(`Entity must be one of ${ENTITIES.join(', ')}`)
    if (kind === 'fas' && data.deviceType && !FAS_DEVICE_TYPES.includes(data.deviceType)) issues.push(`Device Type must be one of ${FAS_DEVICE_TYPES.join(', ')}`)

    if (issues.length) errors.push({ row: rowNum, data, issues })
    else valid.push(data)
  })
  return { valid, errors, total: rows.length }
}

/** Download an .xlsx template with the expected columns + one example row. */
export function downloadTemplate() {
  const example = {
    'Serial No': 'FE-0001',
    Type: 'ABC',
    Capacity: '5 Kg',
    Entity: '1P',
    Region: 'North',
    'Center Name': 'Tower B - Floor 3',
    'Date of Deployment': '2024-01-15',
    'Date of Next Refill': '2025-01-15',
    'Date of Next HPT': '2027-01-15',
    'QR Link': '',
  }
  const ws = XLSX.utils.json_to_sheet([example], { header: BULK_COLUMNS })
  ws['!cols'] = BULK_COLUMNS.map(() => ({ wch: 20 }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Extinguishers')
  downloadWorkbook(wb, 'fire-marshal-bulk-template.xlsx')
}

/**
 * Parse an uploaded .xlsx/.csv file into validated rows.
 * Returns { valid: [...extData], errors: [{row, issues}] }.
 */
export async function parseUpload(file) {
  assertWorkbookSize(file?.size, file?.name)
  // Wrap in Uint8Array: with a bare ArrayBuffer, SheetJS can misread the xlsx
  // zip container as a text sheet and silently return garbage rows instead of
  // failing — which looks like a bad spreadsheet rather than a parsing bug.
  const { rows } = await parseCsvFile(file)
  assertRowCount(rows.length)

  const valid = []
  const errors = []

  rows.forEach((r, idx) => {
    const rowNum = idx + 2 // header is row 1
    const region = String(r['Region'] ?? '').trim()
    const data = {
      serialNo: String(r['Serial No'] ?? '').trim(),
      type: String(r['Type'] ?? '').trim(),
      capacity: String(r['Capacity'] ?? '').trim(),
      // Accept the legacy 1P/2P/3P labels so older exports still upload.
      entity: normalizeEntity(r['Entity']),
      region: region || DEFAULT_REGION, // default if blank
      centerName: String(r['Center Name'] ?? '').trim(),
      dateOfDeployment: toISODate(r['Date of Deployment']),
      dateOfNextRefill: toISODate(r['Date of Next Refill']),
      dateOfNextHPT: toISODate(r['Date of Next HPT']),
      // Reuse a QR code the site has already printed, when one is supplied.
      qrToken: tokenFromQrValue(r['QR Link']),
      // Carry live state across when migrating from another system. Without
      // these, a unit that is empty or awaiting refill would arrive looking
      // healthy — the one import error with real safety consequences.
      status: statusFromLabel(r['Status']),
      physicalDefects: defectsFromCondition(r['Condition']),
    }

    const issues = []
    if (!data.centerName) issues.push('Center Name is required')
    if (!TYPES.includes(data.type)) issues.push(`Type must be one of ${TYPES.join(', ')}`)
    if (!CAPACITIES.includes(data.capacity)) issues.push(`Capacity must be one of ${CAPACITIES.join(', ')}`)
    if (!ENTITIES.includes(data.entity)) issues.push(`Entity must be one of ${ENTITIES.join(', ')}`)
    if (region && !REGIONS.includes(region)) issues.push(`Region must be one of ${REGIONS.join(', ')}`)

    // A QR Link that cannot be turned into a token used to be dropped in
    // silence: tokenFromQrValue returns '', the upsert falls through to
    // generateQrToken(), and the row imports looking perfectly fine with a
    // BRAND NEW code. The labels already stuck on those units then scan to
    // nothing, and the import reported success. Say so instead.
    const suppliedQr = String(r['QR Link'] ?? '').trim()
    if (suppliedQr && !data.qrToken) {
      // Name the actual problem. "Invalid QR Link" against a thousand-row
      // upload tells somebody to go hunting; the reason tells them what to
      // change. These are the three that come up: a code with spaces in it, one
      // shorter than the minimum, and characters that cannot survive being put
      // in a URL.
      const tail = suppliedQr.split(/[?#]/)[0].split('/').filter(Boolean).pop() || suppliedQr
      const why = /\s/.test(suppliedQr) ? 'it contains a space'
        : tail.length < 4 ? `"${tail}" is shorter than 4 characters`
          : `"${tail}" uses characters other than letters, digits, dot, underscore, tilde or hyphen`
      issues.push(
        `QR Link could not be read as a code — ${why}. Give the full scan URL `
        + '(https://…/qr/AB12CD34) or the code on its own, or leave the cell '
        + 'blank to generate a new code.',
      )
    }

    if (issues.length) errors.push({ row: rowNum, data, issues })
    else valid.push(data)
  })

  return { valid, errors, total: rows.length }
}

// Build the row objects used by both export + email attachment.
function rowsFor(list, today = new Date()) {
  return list.map((e) => ({
    'Serial No': e.serialNo || '',
    Type: e.type,
    Capacity: e.capacity,
    Entity: e.entity,
    Region: e.region || '',
    'Center Name': e.centerName,
    'Date of Deployment': toISODate(e.dateOfDeployment),
    'Date of Next Refill': toISODate(e.dateOfNextRefill),
    'Date of Next HPT': toISODate(e.dateOfNextHPT),
    Status: STATUS_LABEL[e.status] || e.status,
    Condition: severityLabel(e, today),
    'QR Link': typeof window !== 'undefined' ? `${window.location.origin}/qr/${e.qrToken}` : e.qrToken,
  }))
}

/** Export a list of extinguishers to .xlsx, including derived condition/status. */
export function exportExtinguishers(list, filename = 'extinguishers.xlsx', today = new Date()) {
  downloadWorkbook(bookFromRows(rowsFor(list, today)), filename)
}

/** Download an arbitrary object as a pretty-printed .json file (full backup snapshot). */
export function downloadJsonBackup(data, filename = 'backup.json') {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Export safety signage as a two-sheet workbook:
 *  - "Availability Matrix": one row per site, one column per signage type (counts).
 *  - "Signage Details": the flat list of every signage record.
 * Both `matrixRows` and `detailRows` are already shaped by the page.
 */
export function exportSignage(matrixRows, detailRows, filename = 'safety-signage.xlsx') {
  const wb = XLSX.utils.book_new()
  const mws = XLSX.utils.json_to_sheet(matrixRows.length ? matrixRows : [{ Site: '' }])
  mws['!cols'] = (matrixRows.length ? Object.keys(matrixRows[0]) : ['Site']).map((k) => ({ wch: k === 'Site' ? 26 : 16 }))
  XLSX.utils.book_append_sheet(wb, mws, 'Availability Matrix')
  const dws = XLSX.utils.json_to_sheet(detailRows.length ? detailRows : [{ Site: '', Type: '' }])
  dws['!cols'] = (detailRows.length ? Object.keys(detailRows[0]) : ['Site', 'Type']).map(() => ({ wch: 20 }))
  XLSX.utils.book_append_sheet(wb, dws, 'Signage Details')
  downloadWorkbook(wb, filename)
}

/**
 * Export defects as a site-wise work list, with the per-unit detail behind it.
 *
 * "By site" leads because that is the sheet the file is opened for: how many
 * defects each site has, of what kinds, where it is and how to drive there. The
 * detail sheet keeps every unit-level row, so nothing the old export carried is
 * lost by leading with the summary.
 */
export function exportSiteDefects(summaryRows, detailRows, filename = 'defects-by-site.xlsx') {
  downloadWorkbook(buildSiteDefectsBook(summaryRows, detailRows), filename)
}

/** The workbook itself, split out so the sheet layout can be tested without a DOM. */
export function buildSiteDefectsBook(summaryRows = [], detailRows = []) {
  const wb = XLSX.utils.book_new()

  const headers = ['Site', 'No. of Defects', 'Type of Defects', 'Address', 'Entity', 'Region', 'Location Link']
  const sws = XLSX.utils.json_to_sheet(
    summaryRows.length ? summaryRows : [Object.fromEntries(headers.map((h) => [h, '']))]
  )
  // The type list and the address are the long ones; the count is a number.
  sws['!cols'] = headers.map((h) => ({
    wch: h === 'Type of Defects' ? 46 : h === 'Address' ? 34 : h === 'Location Link' ? 44 : h === 'Site' ? 26 : 14,
  }))
  XLSX.utils.book_append_sheet(wb, sws, 'By Site')

  const dws = XLSX.utils.json_to_sheet(detailRows.length ? detailRows : [{ Site: '' }])
  dws['!cols'] = (detailRows.length ? Object.keys(detailRows[0]) : ['Site']).map(() => ({ wch: 20 }))
  XLSX.utils.book_append_sheet(wb, dws, 'Defect Detail')

  return wb
}

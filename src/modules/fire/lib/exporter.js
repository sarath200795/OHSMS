// xlsx helpers: bulk-upload template, parsing uploads, and exporting lists.
import * as XLSX from 'xlsx'
import { format } from 'date-fns'
import {
  BULK_COLUMNS, TYPES, CAPACITIES, ENTITIES, REGIONS, DEFAULT_REGION, STATUS_LABEL,
  FAS_DEVICE_TYPES, AED_STATUS, AED_STATUS_LABEL, FAS_STATUS, FAS_STATUS_LABEL,
} from './constants'
import { severityLabel, toDate } from './extinguisherLogic'

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
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellDates: true })
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
  const valid = []
  const errors = []
  const S = (r, k) => String(r[k] ?? '').trim()

  rows.forEach((r, idx) => {
    const rowNum = idx + 2
    const region = S(r, 'Region')
    const entity = S(r, 'Entity')
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
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })

  const valid = []
  const errors = []

  rows.forEach((r, idx) => {
    const rowNum = idx + 2 // header is row 1
    const region = String(r['Region'] ?? '').trim()
    const data = {
      serialNo: String(r['Serial No'] ?? '').trim(),
      type: String(r['Type'] ?? '').trim(),
      capacity: String(r['Capacity'] ?? '').trim(),
      entity: String(r['Entity'] ?? '').trim(),
      region: region || DEFAULT_REGION, // default if blank
      centerName: String(r['Center Name'] ?? '').trim(),
      dateOfDeployment: toISODate(r['Date of Deployment']),
      dateOfNextRefill: toISODate(r['Date of Next Refill']),
      dateOfNextHPT: toISODate(r['Date of Next HPT']),
    }

    const issues = []
    if (!data.centerName) issues.push('Center Name is required')
    if (!TYPES.includes(data.type)) issues.push(`Type must be one of ${TYPES.join(', ')}`)
    if (!CAPACITIES.includes(data.capacity)) issues.push(`Capacity must be one of ${CAPACITIES.join(', ')}`)
    if (!ENTITIES.includes(data.entity)) issues.push(`Entity must be one of ${ENTITIES.join(', ')}`)
    if (region && !REGIONS.includes(region)) issues.push(`Region must be one of ${REGIONS.join(', ')}`)

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

/** Same data as exportExtinguishers, but returned as a base64 string for email attachments. */
export function extinguishersToBase64(list, today = new Date()) {
  return XLSX.write(bookFromRows(rowsFor(list, today)), { type: 'base64', bookType: 'xlsx' })
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

/** Export audit-log rows to .xlsx. `rows` already shaped by the page (When/Actor/Action/…). */
export function exportAuditLogs(rows, filename = 'audit-log.xlsx') {
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ When: '', Actor: '', Action: '', Target: '', Summary: '' }])
  ws['!cols'] = [{ wch: 20 }, { wch: 20 }, { wch: 22 }, { wch: 28 }, { wch: 50 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Audit Log')
  downloadWorkbook(wb, filename)
}

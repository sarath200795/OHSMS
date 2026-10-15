// ─────────────────────────────────────────────────────────────────────────────
// The Defect Repository export: one flat row per defect on screen.
//
// The page lists every open equipment defect — approved extinguisher defects
// plus AED / fire-alarm defect reports raised from a QR scan, awaiting a
// manager's confirmation. A QR report only carries the asset's id and label, so
// its site, region, entity and placement are joined back from the AED / FAS
// registers that are already loaded; nothing is fetched for the export.
// ─────────────────────────────────────────────────────────────────────────────
import { format } from 'date-fns'
import { toDate } from './extinguisherLogic'

export const DEFECT_REPOSITORY_COLUMNS = [
  'Defect ID', 'Equipment Type', 'Asset ID / Serial No', 'Details', 'Site', 'Region', 'Entity',
  'Location', 'Defect', 'Status', 'Raised By', 'Reporter Role', 'Raised Date', 'Source',
  'Remarks', 'Next Refill Due', 'Next HPT Due',
  'Closure Remarks', 'Closed Date', 'Closed By', 'Evidence',
]

const day = (v) => {
  const d = toDate(v)
  return d ? format(d, 'yyyy-MM-dd') : ''
}

const text = (v) => (v == null ? '' : String(v).trim())

function closureCells(row) {
  const c = row.closure
  if (!c) return { 'Closure Remarks': '', 'Closed Date': '', 'Closed By': '', Evidence: '' }
  const photo = c.photo
  const evidence = photo?.name || (photo?.url || photo?.path || photo?.dataUrl ? 'Yes' : '')
  return {
    'Closure Remarks': text(c.remarks),
    'Closed Date': day(c.closedOn),
    'Closed By': text(c.closedBy),
    Evidence: text(evidence),
  }
}

/**
 * @param rows  the Defect Repository rows (as built by the page: kind, label,
 *              sub, site, region, defect, reportedAt, source, raw)
 * @param regs  { aeds, fas, extinguishers } — the loaded registers, for the join
 */
export function buildDefectRepositoryRows(rows = [], { aeds = [], fas = [], extinguishers = [] } = {}) {
  const aedById = new Map(aeds.map((a) => [a.id, a]))
  const fasById = new Map(fas.map((a) => [a.id, a]))
  const extById = new Map(extinguishers.map((e) => [e.id, e]))

  return rows.map((row) => {
    const r = row.raw || {}
    if (row.source === 'asset') {
      const asset = (r.assetKind === 'fas' ? fasById : aedById).get(r.assetRefId) || {}
      const detail = r.assetKind === 'fas'
        ? [asset.deviceType, asset.zone && `Zone ${asset.zone}`]
        : [asset.brand, asset.model]
      return {
        'Defect ID': text(r.id),
        'Equipment Type': row.kind,
        'Asset ID / Serial No': text(r.assetKind === 'fas' ? asset.deviceId : asset.assetId) || text(row.label).replace(/^—$/, ''),
        Details: detail.filter(Boolean).join(' · '),
        Site: text(asset.centerName || row.site),
        Region: text(asset.region || row.region),
        Entity: text(asset.entity),
        Location: text(asset.location),
        Defect: text(row.defect),
        Status: row.closure ? 'Closed' : 'Pending confirmation',
        'Raised By': text(r.reportedByName),
        'Reporter Role': text(r.reporterRole),
        'Raised Date': day(row.reportedAt),
        Source: r.source === 'qr' ? 'QR scan' : text(r.source),
        Remarks: text(r.note),
        'Next Refill Due': '',
        'Next HPT Due': '',
        ...closureCells(row),
      }
    }
    const ext = extById.get(r.extId) || {}
    return {
      'Defect ID': text(r.reportId || r.id),
      'Equipment Type': row.kind,
      'Asset ID / Serial No': text(r.serialNo || ext.serialNo),
      Details: text(row.sub),
      Site: text(row.site),
      Region: text(row.region),
      Entity: text(r.entity || ext.entity),
      Location: text(ext.location || r.location),
      Defect: text(row.defect),
      Status: row.closure ? 'Closed' : 'Open',
      'Raised By': text(r.reportedByName),
      'Reporter Role': '',
      'Raised Date': day(row.reportedAt),
      Source: row.source === 'derived' ? 'Derived from extinguisher record' : 'Approved defect report',
      Remarks: '',
      'Next Refill Due': day(r.dateOfNextRefill),
      'Next HPT Due': day(r.dateOfNextHPT),
      ...closureCells(row),
    }
  })
}

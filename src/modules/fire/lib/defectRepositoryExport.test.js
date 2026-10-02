import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { buildDefectRepositoryRows, DEFECT_REPOSITORY_COLUMNS } from './defectRepositoryExport'
import { buildDefectRepositoryBook } from './exporter'

const extRow = {
  key: 'ext:e1:PIN', kind: 'Extinguisher', label: 'FE-0001', sub: 'ABC · 5 Kg', site: 'Cult Ameerpet', region: 'South',
  defect: 'PIN', reportedAt: new Date('2026-09-10T08:00:00Z'), source: 'ext',
  raw: {
    id: 'e1:PIN', reportId: 'rep1', extId: 'e1', serialNo: 'FE-0001', entity: 'COCO', reportedByName: 'Ravi',
    dateOfNextRefill: '2027-01-15', dateOfNextHPT: '2028-02-01',
  },
}
const aedRow = {
  key: 'asset:r2', kind: 'AED', label: 'AED-0003', sub: 'Reported via QR scan', site: '', region: '',
  defect: 'Pads expired', reportedAt: new Date('2026-09-12T08:00:00Z'), source: 'asset',
  raw: { id: 'r2', assetKind: 'aed', assetRefId: 'a1', assetLabel: 'AED-0003', source: 'qr', reportedByName: 'QR Scan (Public)', reporterRole: 'Staff', note: 'Cabinet open' },
}
const fasRow = {
  key: 'asset:r3', kind: 'Fire Alarm', label: 'FAS-1', sub: '', site: '', region: '', defect: 'Fault light',
  reportedAt: null, source: 'asset', raw: { id: 'r3', assetKind: 'fas', assetRefId: 'missing', assetLabel: 'FAS-1' },
}
const regs = {
  aeds: [{ id: 'a1', assetId: 'AED-0003', brand: 'Philips', model: 'HS1', centerName: 'Depot', region: 'East', entity: 'FOFO', location: 'Reception' }],
  fas: [],
  extinguishers: [{ id: 'e1', serialNo: 'FE-0001', location: 'Lobby' }],
}

describe('buildDefectRepositoryRows', () => {
  const out = buildDefectRepositoryRows([extRow, aedRow, fasRow], regs)

  it('returns one row per defect, all with the same columns in order', () => {
    expect(out).toHaveLength(3)
    for (const r of out) expect(Object.keys(r)).toEqual(DEFECT_REPOSITORY_COLUMNS)
  })

  it('exports an extinguisher defect with its unit details', () => {
    expect(out[0]).toMatchObject({
      'Defect ID': 'rep1', 'Equipment Type': 'Extinguisher', 'Asset ID / Serial No': 'FE-0001', Details: 'ABC · 5 Kg',
      Site: 'Cult Ameerpet', Region: 'South', Entity: 'COCO', Location: 'Lobby', Defect: 'PIN', Status: 'Open',
      'Raised By': 'Ravi', 'Raised Date': '2026-09-10', 'Next Refill Due': '2027-01-15', 'Next HPT Due': '2028-02-01',
    })
  })

  it('joins an AED report back to its register for site, region, entity and placement', () => {
    expect(out[1]).toMatchObject({
      'Defect ID': 'r2', 'Equipment Type': 'AED', 'Asset ID / Serial No': 'AED-0003', Details: 'Philips · HS1',
      Site: 'Depot', Region: 'East', Entity: 'FOFO', Location: 'Reception', Status: 'Pending confirmation',
      Source: 'QR scan', 'Reporter Role': 'Staff', Remarks: 'Cabinet open',
    })
  })

  it('degrades to blanks when the asset or date is missing', () => {
    expect(out[2]).toMatchObject({ 'Asset ID / Serial No': 'FAS-1', Site: '', Entity: '', 'Raised Date': '' })
  })

  it('handles an empty list', () => {
    expect(buildDefectRepositoryRows([])).toEqual([])
    expect(buildDefectRepositoryRows(undefined)).toEqual([])
  })
})

describe('the workbook', () => {
  it('has a Defects sheet with the header even when empty', () => {
    const wb = buildDefectRepositoryBook([])
    expect(wb.SheetNames).toEqual(['Defects'])
    const [header] = XLSX.utils.sheet_to_json(wb.Sheets.Defects, { header: 1 })
    expect(header).toEqual(DEFECT_REPOSITORY_COLUMNS)
  })

  it('writes every row', () => {
    const rows = buildDefectRepositoryRows([extRow, aedRow], regs)
    const wb = buildDefectRepositoryBook(rows)
    const back = XLSX.utils.sheet_to_json(wb.Sheets.Defects)
    expect(back).toHaveLength(2)
    expect(back[1]['Asset ID / Serial No']).toBe('AED-0003')
  })
})

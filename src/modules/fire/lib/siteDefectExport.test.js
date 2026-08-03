import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { buildSiteDefectsBook } from './exporter'
import { summariseDefectsBySite } from './siteDefectSummary'

const SITES = [
  { id: 's1', name: 'Cult Gym Ameerpet', address: '12 Main Rd, Ameerpet', region: 'South', entity: 'COCO', lat: 17.4375, lng: 78.4483 },
  { id: 's2', name: 'Depot — Chennai', address: '9 Anna Salai', region: 'East', entity: 'FOFO', lat: 13.0827, lng: 80.2707 },
]

const DEFECTS = [
  { centerName: 'Cult Gym Ameerpet', entity: 'COCO', region: 'South', defectLabel: 'PIN', serialNo: 'FE-0001' },
  { centerName: 'Cult Gym Ameerpet', entity: 'COCO', region: 'South', defectLabel: 'Stand', serialNo: 'FE-0002' },
  { centerName: 'Depot — Chennai', entity: 'FOFO', region: 'East', defectLabel: 'PIN', serialNo: 'FE-0003' },
]

const sheet = (wb, name) => XLSX.utils.sheet_to_json(wb.Sheets[name])

// The rows going in are covered by siteDefectSummary.test.js; this is about the
// file that actually lands on someone's desk.
describe('the exported workbook', () => {
  const wb = buildSiteDefectsBook(summariseDefectsBySite(DEFECTS, SITES), DEFECTS)

  it('leads with the site-wise sheet', () => {
    expect(wb.SheetNames).toEqual(['By Site', 'Defect Detail'])
  })

  it('carries exactly the requested columns, in order', () => {
    const [header] = XLSX.utils.sheet_to_json(wb.Sheets['By Site'], { header: 1 })
    expect(header).toEqual([
      'Site', 'No. of Defects', 'Type of Defects', 'Address', 'Entity', 'Region', 'Location Link',
    ])
  })

  it('writes one row per site, worst first', () => {
    const rows = sheet(wb, 'By Site')
    expect(rows).toHaveLength(2)
    expect(rows[0].Site).toBe('Cult Gym Ameerpet')
    expect(rows[0]['No. of Defects']).toBe(2)
    expect(rows[1]['No. of Defects']).toBe(1)
  })

  it('keeps the count numeric so it can be summed in the sheet', () => {
    expect(typeof sheet(wb, 'By Site')[0]['No. of Defects']).toBe('number')
  })

  it('carries the address, entity, region and a working map link', () => {
    const row = sheet(wb, 'By Site')[0]
    expect(row.Address).toBe('12 Main Rd, Ameerpet')
    expect(row.Entity).toBe('COCO')
    expect(row.Region).toBe('South')
    expect(row['Location Link']).toBe('https://www.google.com/maps/search/?api=1&query=17.4375,78.4483')
  })

  it('names the defect types found at the site', () => {
    expect(sheet(wb, 'By Site')[0]['Type of Defects']).toBe('PIN, Stand')
  })

  it('keeps every per-unit row on the detail sheet, so nothing is lost', () => {
    const rows = sheet(wb, 'Defect Detail')
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.serialNo)).toEqual(['FE-0001', 'FE-0002', 'FE-0003'])
  })

  it('still produces both sheets with headers when there is nothing to report', () => {
    const empty = buildSiteDefectsBook([], [])
    expect(empty.SheetNames).toEqual(['By Site', 'Defect Detail'])
    const [header] = XLSX.utils.sheet_to_json(empty.Sheets['By Site'], { header: 1 })
    expect(header).toEqual([
      'Site', 'No. of Defects', 'Type of Defects', 'Address', 'Entity', 'Region', 'Location Link',
    ])
  })

  it('survives a round trip through a real xlsx file', () => {
    // Proves the book is something Excel can actually open, not just an object.
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    const reread = XLSX.read(buf, { type: 'array' })
    expect(reread.SheetNames).toEqual(['By Site', 'Defect Detail'])
    expect(XLSX.utils.sheet_to_json(reread.Sheets['By Site'])[0]['No. of Defects']).toBe(2)
  })
})

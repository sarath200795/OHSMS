import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { aoaToSheet, jsonToSheet } from './sheet'
import { sheetValue } from './csv'
import { incidentRows } from '../../modules/incidents/lib/exporter'
import { auditRows, auditExportSummary } from '../audit/auditExport'
import { weatherExportRows } from '../../modules/weather/lib/weatherExport'
import { cameraDefectRows } from '../../modules/cctv/lib/exporter'
import { meetingExportSheets } from '../../modules/committee/lib/actionOwner'
import { buildSiteDefectsBook } from '../../modules/fire/lib/exporter'

function cells(ws) {
  return Object.entries(ws)
    .filter(([addr]) => !addr.startsWith('!'))
    .map(([, cell]) => cell)
}

function roundTrip(ws) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Data')
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return XLSX.read(buf, { type: 'array' }).Sheets.Data
}

const hostile = [
  '=1+1',
  '=HYPERLINK("http://evil.test","click")',
  '+1 555',
  '-2+3',
  '@SUM(A1)',
  ' =1+1',
  '\t=cmd|calc',
  '\u0000=1+1',
]

describe('what this SheetJS build actually writes', () => {
  it('stores a leading equals as text, with no formula and no link', () => {
    const raw = XLSX.utils.json_to_sheet([{ note: '=HYPERLINK("http://evil.test","click")' }])
    const cell = cells(raw).find((c) => typeof c.v === 'string' && c.v.startsWith('='))
    expect(cell.t).toBe('s')
    expect(cell.f).toBeUndefined()
    expect(cell.l).toBeUndefined()
    const back = cells(roundTrip(raw)).find((c) => typeof c.v === 'string' && c.v.startsWith('='))
    expect(back.t).toBe('s')
    expect(back.f).toBeUndefined()
    expect(back.l).toBeUndefined()
  })
})

describe('sheetValue', () => {
  it('prefixes formula text once and leaves measurements alone', () => {
    for (const value of hostile) expect(sheetValue(value).startsWith('\t')).toBe(true)
    expect(sheetValue(-3)).toBe(-3)
    expect(sheetValue(0)).toBe(0)
    expect(sheetValue(false)).toBe(false)
    expect(sheetValue('Bay 3 = north wall')).toBe('Bay 3 = north wall')
    const when = new Date('2026-03-14T00:00:00Z')
    expect(sheetValue(when)).toBe(when)
  })
})

describe('a sanitised workbook round-trips', () => {
  it('keeps the prefix as a string and does not invent a formula or a link', () => {
    const when = new Date('2026-03-14T12:00:00Z')
    const ws = jsonToSheet([
      {
        Description: '=HYPERLINK("http://evil.test","click")',
        Count: -3,
        Open: false,
        When: when,
        Note: 'Bay 3 = north wall',
      },
    ])
    const back = roundTrip(ws)
    const values = cells(back)
    const text = values.find((c) => typeof c.v === 'string' && c.v.includes('HYPERLINK'))
    expect(text.v.startsWith('\t=HYPERLINK')).toBe(true)
    expect(text.t).toBe('s')
    expect(text.f).toBeUndefined()
    expect(text.l).toBeUndefined()
    expect(values.some((c) => c.f)).toBe(false)
    expect(values.some((c) => c.l)).toBe(false)
    expect(values.find((c) => c.v === -3).t).toBe('n')
    expect(values.find((c) => c.v === false).t).toBe('b')
    const dated = cells(ws).find((c) => c.t === 'n' && c.z)
    expect(dated?.t).toBe('n')
    const datedBack = values.find((c) => c.t === 'n' && c.v !== -3)
    expect(typeof datedBack?.v).toBe('number')
    expect(datedBack?.f).toBeUndefined()
    expect(values.find((c) => c.v === 'Bay 3 = north wall').t).toBe('s')
  })

  it('prefixes an audit summary and an audit detail the same way', () => {
    const summary = aoaToSheet(auditExportSummary({ orgName: '=1+1', count: 2 }))
    const org = cells(summary).find((c) => typeof c.v === 'string' && c.v.includes('1+1'))
    expect(org.v).toBe('\t=1+1')
    expect(org.f).toBeUndefined()

    const detail = jsonToSheet(
      auditRows([
        {
          id: 'a1',
          action: 'record.update',
          actorName: '@SUM(A1)',
          details: '=WEBSERVICE("http://evil.test")',
          at: '2026-03-14T00:00:00Z',
        },
      ])
    )
    const back = cells(roundTrip(detail))
    expect(
      back
        .filter(
          (c) => typeof c.v === 'string' && (c.v.includes('SUM') || c.v.includes('WEBSERVICE'))
        )
        .every((c) => c.v.startsWith('\t') && c.t === 's' && c.f === undefined && c.l === undefined)
    ).toBe(true)
  })
})

describe('exporters share that helper', () => {
  it('neutralises an incident description, a site, and a person without touching the count', () => {
    const rows = incidentRows([
      {
        id: 'i1',
        narrative: '=1+1',
        siteName: ' =cmd',
        reportedByName: '@Ada',
        location: 'Bay 3 = north',
        capa: [{ description: 'ok', status: 'open' }],
      },
    ])
    const back = cells(roundTrip(jsonToSheet(rows)))
    expect(back.find((c) => c.v === '\t=1+1').f).toBeUndefined()
    expect(
      back.find((c) => typeof c.v === 'string' && c.v.includes('cmd')).v.startsWith('\t')
    ).toBe(true)
    expect(back.find((c) => c.v === '\t@Ada').t).toBe('s')
    expect(back.find((c) => c.v === 'Bay 3 = north').t).toBe('s')
    expect(back.find((c) => c.v === 1).t).toBe('n')
  })

  it('neutralises a weather site name and keeps the temperature numeric', () => {
    const rows = weatherExportRows(
      [{ id: 's1', name: '=HYPERLINK("http://evil.test")', region: 'South', lat: 1, lng: 2 }],
      { s1: { obs: { apparentTempC: -3.2, aqi: 10 }, risk: { band: 'low', hazards: [] } } }
    )
    const back = cells(roundTrip(jsonToSheet(rows)))
    expect(
      back.find((c) => typeof c.v === 'string' && c.v.includes('HYPERLINK')).v.startsWith('\t')
    ).toBe(true)
    expect(back.find((c) => c.v === -3).t).toBe('n')
  })

  it('neutralises a camera name and a meeting action', () => {
    const camera = cameraDefectRows([
      {
        name: '+cmd',
        location: 'Gate',
        siteName: 'Plant',
        dvrName: 'DVR',
        status: 'offline',
        defects: [],
        cause: 'camera',
      },
    ])
    expect(
      cells(jsonToSheet(camera))
        .find((c) => typeof c.v === 'string' && c.v.includes('cmd'))
        .v.startsWith('\t')
    ).toBe(true)

    const sheets = meetingExportSheets(
      [
        {
          docId: 'm1',
          siteId: 's1',
          date: '2026-03-14',
          type: 'Safety',
          subject: 'Review',
          attendees: [],
          actions: [{ action: '=1+1', ownerKind: 'person', owner: 'Ada', due: '', status: 'Open' }],
        },
      ],
      () => '@Plant'
    )
    const actions = cells(jsonToSheet(sheets.actions))
    expect(actions.find((c) => c.v === '\t=1+1').f).toBeUndefined()
    expect(actions.find((c) => c.v === '\t@Plant').t).toBe('s')
  })

  it('neutralises a site address inside the fire workbook', () => {
    const wb = buildSiteDefectsBook(
      [
        {
          Site: 'Plant',
          'No. of Defects': 2,
          'Type of Defects': 'PIN',
          Address: '=HYPERLINK("http://evil.test")',
          Entity: 'COCO',
          Region: 'South',
          'Location Link': 'https://maps.example/a',
        },
      ],
      []
    )
    const back = cells(roundTrip(wb.Sheets['By Site']))
    const address = back.find((c) => typeof c.v === 'string' && c.v.includes('HYPERLINK'))
    expect(address.v.startsWith('\t=')).toBe(true)
    expect(address.f).toBeUndefined()
    expect(address.l).toBeUndefined()
    expect(back.find((c) => c.v === 2).t).toBe('n')
    expect(back.find((c) => c.v === 'https://maps.example/a').v.startsWith('=')).toBe(false)
  })
})

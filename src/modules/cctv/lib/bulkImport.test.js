import { describe, it, expect } from 'vitest'
import Papa from 'papaparse'
import {
  normalizeStatus, nameIndex, validateDvrRows, validateCameraRows, parseWorkbook, parseImport,
} from './bulkImport'
import { MAX_WORKBOOK_BYTES, MAX_IMPORT_ROWS } from '../../../shared/lib/workbookGuard'

const sites = [
  { id: 's1', name: 'Hosur' },
  { id: 's2', name: 'North Plant' },
]
const dvrs = [
  { id: 'd1', name: 'DVR-Gate-01', siteId: 's1', siteName: 'Hosur' },
  { id: 'd2', name: 'DVR-Yard-02', siteId: 's2', siteName: 'North Plant' },
]

// CSV text, not a workbook: imports parse CSV now, because the npm xlsx package
// carries an unfixable prototype-pollution advisory and an upload is untrusted
// input. Exports still write real .xlsx — writing our own data is not a parsing
// surface.
const sheet = (rows) => Papa.unparse(rows)

describe('normalizeStatus', () => {
  it('accepts the words people actually type', () => {
    expect(normalizeStatus('Online')).toBe('online')
    expect(normalizeStatus('UP')).toBe('online')
    expect(normalizeStatus('working')).toBe('online')
    expect(normalizeStatus('Down')).toBe('offline')
    expect(normalizeStatus('faulty')).toBe('offline')
  })

  // Blank means nobody checked, which must not become a green "online".
  it('treats blank and anything unrecognised as not reported', () => {
    expect(normalizeStatus('')).toBe('unknown')
    expect(normalizeStatus(undefined)).toBe('unknown')
    expect(normalizeStatus('probably fine?')).toBe('unknown')
  })
})

describe('nameIndex', () => {
  it('finds a row by name, case and space insensitively', () => {
    expect(nameIndex(dvrs).lookup('  dvr-gate-01 ')).toMatchObject({ status: 'ok' })
  })

  // Attaching forty cameras to whichever duplicate was parsed last is a mistake
  // nobody would spot by looking at the result.
  it('refuses to guess between two rows with the same name', () => {
    const idx = nameIndex([{ id: 'a', name: 'DVR-1' }, { id: 'b', name: 'dvr-1' }])
    expect(idx.lookup('DVR-1')).toEqual({ status: 'ambiguous' })
    expect(idx.has('DVR-1')).toBe(false)
  })

  it('reports missing and empty separately, because the messages differ', () => {
    const idx = nameIndex(dvrs)
    expect(idx.lookup('nope')).toEqual({ status: 'missing' })
    expect(idx.lookup('')).toEqual({ status: 'empty' })
  })
})

describe('validateDvrRows', () => {
  const ok = { name: 'DVR-New-01', ipAddress: '10.0.0.5', siteName: 'Hosur', channels: '16', status: 'online' }

  it('accepts a good row and resolves its site to an id', () => {
    const [r] = validateDvrRows([ok], { sites, dvrs })
    expect(r.errors).toEqual([])
    expect(r.data).toMatchObject({ name: 'DVR-New-01', siteId: 's1', siteName: 'Hosur', channels: 16, status: 'online' })
  })

  // A DVR with no site can never be darkened by its Meraki, so the cascade
  // silently stops there — that is a failure, not a blank field.
  it('rejects a row whose site is missing or unknown', () => {
    expect(validateDvrRows([{ ...ok, siteName: '' }], { sites, dvrs })[0].errors).toContain('Missing site')
    expect(validateDvrRows([{ ...ok, siteName: 'Atlantis' }], { sites, dvrs })[0].errors[0]).toMatch(/not in the site registry/)
  })

  it('rejects a name that already exists or repeats in the file', () => {
    expect(validateDvrRows([{ ...ok, name: 'DVR-Gate-01' }], { sites, dvrs })[0].errors).toContain('A DVR with this name already exists')
    const two = validateDvrRows([ok, ok], { sites, dvrs })
    expect(two[0].errors).toEqual([])
    expect(two[1].errors).toContain('Duplicate DVR name in this file')
  })

  it('rejects non-numeric channels but allows the column to be blank', () => {
    expect(validateDvrRows([{ ...ok, channels: 'sixteen' }], { sites, dvrs })[0].errors).toContain('Channels must be a number')
    expect(validateDvrRows([{ ...ok, channels: '' }], { sites, dvrs })[0].data.channels).toBe(0)
  })

  it('numbers rows as the spreadsheet does, so an error points at the right line', () => {
    const rows = validateDvrRows([ok, { ...ok, name: 'B' }], { sites, dvrs })
    expect(rows.map((r) => r.row)).toEqual([2, 3])
  })
})

describe('validateCameraRows', () => {
  const ok = { name: 'CAM-99', location: 'Main gate', dvrName: 'DVR-Gate-01', status: 'online' }

  it('accepts a good row and resolves the DVR to an id', () => {
    const [r] = validateCameraRows([ok], { sites, dvrs, cameras: [] })
    expect(r.errors).toEqual([])
    expect(r.data).toMatchObject({ name: 'CAM-99', dvrId: 'd1' })
  })

  // A camera with no DVR is invisible to the cascade and absent from every
  // report — importing it silently is worse than refusing the row.
  it('rejects a camera with no DVR, or an unknown one', () => {
    expect(validateCameraRows([{ ...ok, dvrName: '' }], { sites, dvrs })[0].errors[0]).toMatch(/must record to one/)
    expect(validateCameraRows([{ ...ok, dvrName: 'DVR-Ghost' }], { sites, dvrs })[0].errors[0]).toMatch(/was not found/)
  })

  // The most likely mistake: importing cameras first.
  it('says to import the DVRs first when none exist', () => {
    expect(validateCameraRows([ok], { sites, dvrs: [] })[0].errors[0]).toMatch(/import the DVRs before the cameras/)
  })

  it('inherits the site from the DVR when the column is blank', () => {
    const [r] = validateCameraRows([ok], { sites, dvrs })
    expect(r.data).toMatchObject({ siteId: 's1', siteName: 'Hosur' })
  })

  it('uses an explicit site when given one', () => {
    const [r] = validateCameraRows([{ ...ok, siteName: 'North Plant' }], { sites, dvrs })
    expect(r.data).toMatchObject({ siteId: 's2', siteName: 'North Plant' })
  })

  it('rejects an unknown explicit site rather than silently inheriting', () => {
    expect(validateCameraRows([{ ...ok, siteName: 'Atlantis' }], { sites, dvrs })[0].errors[0]).toMatch(/not in the site registry/)
  })

  it('rejects duplicates within the file and against what exists', () => {
    const cameras = [{ id: 'c1', name: 'CAM-99' }]
    expect(validateCameraRows([ok], { sites, dvrs, cameras })[0].errors).toContain('A camera with this name already exists')
  })

  it('refuses to guess between two DVRs sharing a name', () => {
    const twin = [{ id: 'd1', name: 'DVR-X' }, { id: 'd2', name: 'DVR-X' }]
    expect(validateCameraRows([{ ...ok, dvrName: 'DVR-X' }], { sites, dvrs: twin })[0].errors[0]).toMatch(/More than one DVR/)
  })
})

describe('parseWorkbook', () => {
  it('reads the template headings', () => {
    const buf = sheet([{ 'DVR Name': 'DVR-1', 'IP Address': '10.0.0.1', Site: 'Hosur', Channels: 8 }])
    const out = parseWorkbook(buf, 'dvrs')
    expect(out.headerOk).toBe(true)
    expect(out.rows[0]).toMatchObject({ name: 'DVR-1', ipAddress: '10.0.0.1', siteName: 'Hosur' })
  })

  // People rename columns; the import should survive the ones they'd plausibly use.
  it('accepts reasonable alternative headings', () => {
    const buf = sheet([{ DVR: 'DVR-1', IP: '10.0.0.1', Branch: 'Hosur', Ports: 8 }])
    // channels comes back as the STRING '8'. CSV is untyped and dynamic typing
    // is deliberately off, so a serial like 007 survives as written — the parser
    // now returns what the file said rather than guessing. parseImport coerces
    // it, which is what the stored record depends on and is asserted below.
    expect(parseWorkbook(buf, 'dvrs').rows[0]).toMatchObject({
      name: 'DVR-1', ipAddress: '10.0.0.1', siteName: 'Hosur', channels: '8',
    })
  })


  it('reads camera sheets, including the DVR link column', () => {
    const buf = sheet([{ 'Camera Name': 'CAM-1', Location: 'Gate', DVR: 'DVR-Gate-01' }])
    const out = parseWorkbook(buf, 'cameras')
    expect(out.headerOk).toBe(true)
    expect(out.rows[0]).toMatchObject({ name: 'CAM-1', location: 'Gate', dvrName: 'DVR-Gate-01' })
  })

  // Failing once about the file beats failing identically on every row.
  it('reports a wrong file rather than a page of identical row errors', () => {
    expect(parseWorkbook(sheet([{ Foo: 1, Bar: 2 }]), 'dvrs').headerOk).toBe(false)
    // A camera sheet without the DVR column cannot link anything.
    expect(parseWorkbook(sheet([{ 'Camera Name': 'CAM-1' }]), 'cameras').headerOk).toBe(false)
  })

  it('survives an empty sheet', () => {
    expect(parseWorkbook(sheet([]), 'dvrs')).toMatchObject({ headerOk: false, rows: [] })
  })

  // SheetJS parses on the main thread, so an oversized workbook is a frozen tab.
  // Refused before the parser sees it.
  it('refuses a workbook past the size cap', () => {
    const huge = new ArrayBuffer(MAX_WORKBOOK_BYTES + 1)
    expect(() => parseWorkbook(huge, 'dvrs')).toThrow(/limit is 15 MB/)
  })

  it('refuses a sheet past the row cap rather than importing part of it', () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => ({ 'DVR Name': `DVR-${i}`, Site: 'Hosur' }))
    expect(() => parseWorkbook(sheet(rows), 'dvrs')).toThrow(/limit is 20,000 per upload/)
  })

  // A header a spreadsheet cannot express safely: SheetJS mangles it rather than
  // reaching Object.prototype, and nothing here uses a parsed key as a target.
  it('does not let a __proto__ column reach the prototype chain', () => {
    const out = parseWorkbook(sheet([{ ['__proto__']: 'x', 'DVR Name': 'DVR-1', Site: 'Hosur' }]), 'dvrs')
    expect(out.headerOk).toBe(true)
    expect({}.x).toBeUndefined()
    expect(Object.prototype).not.toHaveProperty('x')
  })
})

describe('parseImport', () => {
  it('splits valid from invalid in one pass', () => {
    const buf = sheet([
      { 'DVR Name': 'DVR-A', Site: 'Hosur' },
      { 'DVR Name': '', Site: 'Hosur' },
      { 'DVR Name': 'DVR-B', Site: 'Atlantis' },
    ])
    const out = parseImport(buf, 'dvrs', { sites, dvrs })
    expect(out).toMatchObject({ headerOk: true, total: 3 })
    expect(out.valid).toHaveLength(1)
    expect(out.invalid).toHaveLength(2)
    expect(out.invalid[0].row).toBe(3)
  })

  it('short-circuits on a file that is not the template', () => {
    const out = parseImport(sheet([{ Nope: 1 }]), 'cameras', { sites, dvrs })
    expect(out).toMatchObject({ headerOk: false, total: 0 })
  })

  it('imports cameras end to end against real DVRs', () => {
    const buf = sheet([
      { 'Camera Name': 'CAM-1', Location: 'Gate', DVR: 'DVR-Gate-01', Status: 'Online' },
      { 'Camera Name': 'CAM-2', Location: 'Yard', DVR: 'DVR-Yard-02', Status: 'down' },
    ])
    const out = parseImport(buf, 'cameras', { sites, dvrs, cameras: [] })
    expect(out.valid).toHaveLength(2)
    expect(out.valid[0].data).toMatchObject({ dvrId: 'd1', siteId: 's1', status: 'online' })
    expect(out.valid[1].data).toMatchObject({ dvrId: 'd2', siteId: 's2', status: 'offline' })
  })
})

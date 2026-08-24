// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { safeHeaders, toRows, parseCsvText, parseCsvFile } from './parseTable'

describe('the header row is not trusted', () => {
  // The whole reason the imports moved off SheetJS. A header cell reading
  // __proto__ is the prototype pollution being escaped, and a parser that
  // builds an object from headers will happily accept it — the vulnerability
  // is the parser being trusting, not which parser it is.
  it('drops __proto__, constructor and prototype, whatever their case', () => {
    expect(safeHeaders(['Name', '__proto__', 'Constructor', 'PROTOTYPE', 'Site']))
      .toEqual(['Name', 'Site'])
  })

  it('does not pollute Object.prototype when a row carries one', () => {
    const { rows } = parseCsvText('Name,__proto__\nA,{"polluted":true}\n')
    expect(rows[0].Name).toBe('A')
    expect({}.polluted).toBeUndefined()
    expect(Object.prototype.polluted).toBeUndefined()
  })

  it('trims headers and drops blank ones', () => {
    expect(safeHeaders([' Site Name ', '', '   ', 'Region'])).toEqual(['Site Name', 'Region'])
  })

  it('survives no headers at all', () => {
    expect(safeHeaders()).toEqual([])
    expect(safeHeaders(null)).toEqual([])
  })
})

describe('the row shape the importers already expect', () => {
  // Same as XLSX.utils.sheet_to_json(ws, { defval: '' }) produced, so the row
  // handling in each importer is untouched by the move.
  it('keys rows by header and defaults a missing cell to empty string', () => {
    const { rows } = parseCsvText('Serial,Type\nA-1,CO2\nA-2,\n')
    expect(rows).toEqual([
      { Serial: 'A-1', Type: 'CO2' },
      { Serial: 'A-2', Type: '' },
    ])
  })

  it('never returns undefined for a declared column', () => {
    const rows = toRows([{ A: 'x' }], ['A', 'B'])
    expect(rows[0]).toEqual({ A: 'x', B: '' })
  })

  // A trailing newline yields a row of empty strings, and an importer counting
  // records would report one more than the file contains.
  it('drops the blank row a trailing newline leaves behind', () => {
    expect(parseCsvText('Serial\nA-1\n\n').rows).toEqual([{ Serial: 'A-1' }])
  })

  it('keeps a value that only looks numeric exactly as written', () => {
    const { rows } = parseCsvText('Serial,Qty\n007,01\n')
    expect(rows[0].Serial).toBe('007')
    expect(rows[0].Qty).toBe('01')
  })

  it('handles quoted fields containing commas', () => {
    const { rows } = parseCsvText('Name,Address\nA,"Gelderd Rd, Leeds"\n')
    expect(rows[0].Address).toBe('Gelderd Rd, Leeds')
  })

  it('returns nothing rather than throwing on an empty file', () => {
    expect(parseCsvText('').rows).toEqual([])
    expect(parseCsvText(null).rows).toEqual([])
  })
})

describe('parsing an uploaded file', () => {
  it('reads a File and reports its headers', async () => {
    const file = new File(['Serial,Type\nA-1,CO2\n'], 'assets.csv', { type: 'text/csv' })
    const { rows, fields } = await parseCsvFile(file)
    expect(fields).toEqual(['Serial', 'Type'])
    expect(rows).toEqual([{ Serial: 'A-1', Type: 'CO2' }])
  })
})

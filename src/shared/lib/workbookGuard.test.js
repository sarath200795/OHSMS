import { describe, it, expect } from 'vitest'
import {
  assertWorkbookSize, assertRowCount, formatBytes, MAX_WORKBOOK_BYTES, MAX_IMPORT_ROWS,
} from './workbookGuard'

describe('assertWorkbookSize', () => {
  it('lets a normal spreadsheet through', () => {
    expect(assertWorkbookSize(250 * 1024, 'assets.xlsx')).toBe(250 * 1024)
    expect(assertWorkbookSize(MAX_WORKBOOK_BYTES)).toBe(MAX_WORKBOOK_BYTES)
  })

  it('refuses one byte over the cap', () => {
    expect(() => assertWorkbookSize(MAX_WORKBOOK_BYTES + 1)).toThrow()
  })

  // The person has to be able to act on it, so the message carries both numbers
  // and the name of the file they picked.
  it('names the file and both sizes', () => {
    expect(() => assertWorkbookSize(210 * 1024 * 1024, 'estate.xlsx'))
      .toThrow(/estate\.xlsx is 210 MB.*limit is 15 MB/)
  })

  it('falls back to "That file" when no name is available', () => {
    expect(() => assertWorkbookSize(210 * 1024 * 1024)).toThrow(/^That file is/)
  })

  // A File whose size we could not read must not be treated as enormous, and a
  // missing buffer must not be treated as a 200 MB one either.
  it('treats a missing or unreadable size as zero rather than failing', () => {
    expect(assertWorkbookSize(undefined)).toBe(0)
    expect(assertWorkbookSize(null)).toBe(0)
    expect(assertWorkbookSize(NaN)).toBe(0)
  })
})

describe('assertRowCount', () => {
  it('lets a large but plausible import through', () => {
    expect(assertRowCount(4000)).toBe(4000)
    expect(assertRowCount(MAX_IMPORT_ROWS)).toBe(MAX_IMPORT_ROWS)
  })

  it('refuses more rows than one upload should carry', () => {
    expect(() => assertRowCount(MAX_IMPORT_ROWS + 1)).toThrow(/20,001 rows.*limit is 20,000/)
  })

  // Refusing beats truncating: 20,000 imported units and a success message is
  // indistinguishable from a complete import when someone audits the register.
  it('does not return a truncated count', () => {
    expect(() => assertRowCount(90000)).toThrow()
  })

  it('mentions trailing blank rows, which is the usual cause', () => {
    expect(() => assertRowCount(1048576)).toThrow(/empty rows/)
  })
})

describe('formatBytes', () => {
  it('reads the way a person would write it', () => {
    expect(formatBytes(512)).toBe('512 bytes')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB')
    expect(formatBytes(210 * 1024 * 1024)).toBe('210 MB')
  })

  it('survives nonsense input', () => {
    expect(formatBytes(undefined)).toBe('0 KB')
    expect(formatBytes(-1)).toBe('0 KB')
  })
})

import { describe, expect, it } from 'vitest'
import { TEXT, asText, overlongField, tooLong } from './textCap'

describe('text caps', () => {
  it('accepts a note inside the public QR cap and refuses one past it', () => {
    expect(tooLong('nozzle blocked', TEXT.note, 'Note')).toBe('')
    expect(tooLong('x'.repeat(TEXT.note + 1), TEXT.note, 'Note')).toMatch(/500/)
  })

  it('treats null as empty and trims cells', () => {
    expect(asText(null)).toBe('')
    expect(asText('  Bay 3  ')).toBe('Bay 3')
    expect(tooLong(null, TEXT.name, 'Name')).toBe('')
  })

  it('names the first overlong spreadsheet field', () => {
    const row = { serialNo: 'FE-1', centerName: 'x'.repeat(TEXT.site + 1), location: 'Bay' }
    expect(
      overlongField(row, {
        serialNo: [TEXT.serial, 'Serial No'],
        centerName: [TEXT.site, 'Center Name'],
        location: [TEXT.location, 'Location'],
      })
    ).toMatch(/Center Name/)
  })
})

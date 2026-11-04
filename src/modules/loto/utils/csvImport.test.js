import { describe, expect, it } from 'vitest'
import { importRows, templateCsv } from './csvImport'

describe('csv import', () => {
  it('builds a template with a header and one example row', () => {
    expect(templateCsv('locks').startsWith('lockNo,tagNo,color')).toBe(true)
    expect(templateCsv('groups')).toContain('GL-1,Yard box')
  })

  it('skips the header and rejects a technician expiry that is not a date', () => {
    const text = 'name,lockNo,licenceNo,licenceExp\nAsha,P-1,WL-1,2027-01-02\nNo Date,P-2,WL-2,tomorrow'
    const { rows, errors } = importRows('technicians', text)
    expect(rows).toEqual([{ name: 'Asha', lockNo: 'P-1', licenceNo: 'WL-1', licenceExp: '2027-01-02' }])
    expect(errors[0]).toMatch(/YYYY-MM-DD/)
  })

  it('rejects a group number with a space', () => {
    const { rows, errors } = importRows('groups', 'no,description\nBad number,box')
    expect(rows).toEqual([])
    expect(errors[0]).toMatch(/hyphens/)
  })
})

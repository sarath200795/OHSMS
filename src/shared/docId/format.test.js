import { describe, it, expect } from 'vitest'
import {
  DOC_CODES, DOC_KIND_LABEL, deriveOrgCode, normalizeOrgCode,
  formatDocId, parseDocId, highestSeq,
} from './format'

describe('the code table', () => {
  it('gives every kind a code and a label', () => {
    for (const kind of Object.keys(DOC_CODES)) {
      expect(DOC_CODES[kind]).toMatch(/^[A-Z]{2,6}$/)
      expect(DOC_KIND_LABEL[kind]).toBeTruthy()
    }
  })

  it('never reuses a code for two kinds', () => {
    // A repurposed code would make an id already written on paper ambiguous.
    const codes = Object.values(DOC_CODES)
    expect(new Set(codes).size).toBe(codes.length)
  })
})

describe('deriveOrgCode', () => {
  it('uses the name people actually say', () => {
    expect(deriveOrgCode('Acme Corporation')).toBe('ACME')
    expect(deriveOrgCode('Cult Fit')).toBe('CULT')
    expect(deriveOrgCode('Tata Steel Limited')).toBe('TATA')
  })

  it('drops the part that says what kind of company it is', () => {
    expect(deriveOrgCode('Acme Corporation Pvt Ltd')).toBe('ACME')
    expect(deriveOrgCode('The Acme Group')).toBe('ACME')
  })

  it('falls back to initials when the first word is too short to recognise', () => {
    expect(deriveOrgCode('AB Industries')).toBe('AB')
    expect(deriveOrgCode('J K Cement')).toBe('JKC')
  })

  it('caps the length so the id stays quotable', () => {
    expect(deriveOrgCode('Constellation Energy')).toHaveLength(5)
    expect(deriveOrgCode('Constellation Energy')).toBe('CONST')
  })

  it('strips punctuation and accents-as-symbols rather than emitting them', () => {
    expect(deriveOrgCode("O'Brien & Sons")).toBe('OBRIE')
    expect(deriveOrgCode('Fit-India')).toBe('FIT')
  })

  it('never returns empty, whatever it is given', () => {
    for (const bad of ['', '   ', null, undefined, '!!!', 123]) {
      expect(deriveOrgCode(bad)).toMatch(/^[A-Z0-9]{2,5}$/)
    }
  })

  it('keeps a name that is only a noise word rather than giving up', () => {
    // "Ltd" alone is a poor name, but blanking it would be worse.
    expect(deriveOrgCode('Limited')).toBe('LIMIT')
  })
})

describe('normalizeOrgCode', () => {
  it('uppercases and strips anything not alphanumeric', () => {
    expect(normalizeOrgCode('ac-me!')).toBe('ACME')
    expect(normalizeOrgCode(' xy 1 ')).toBe('XY1')
  })

  it('rejects a code too short to mean anything', () => {
    expect(normalizeOrgCode('A')).toBe('')
    expect(normalizeOrgCode('')).toBe('')
    expect(normalizeOrgCode('!')).toBe('')
  })

  it('truncates rather than rejecting a long one', () => {
    expect(normalizeOrgCode('ABCDEFGH')).toBe('ABCDE')
  })
})

describe('formatDocId', () => {
  it('builds MODULE-ORG_0001', () => {
    expect(formatDocId('ptw', 'ACME', 1)).toBe('PTW-ACME_0001')
    expect(formatDocId('incidents', 'ACME', 42)).toBe('INC-ACME_0042')
    expect(formatDocId('hira', 'ACME', 7)).toBe('HIRA-ACME_0007')
  })

  it('keeps counting past four digits instead of wrapping', () => {
    expect(formatDocId('incidents', 'ACME', 12345)).toBe('INC-ACME_12345')
  })

  it('cleans a code that was stored loosely', () => {
    expect(formatDocId('ptw', 'ac-me', 1)).toBe('PTW-ACME_0001')
  })

  it('still produces something usable when the org has no code', () => {
    expect(formatDocId('ptw', '', 1)).toBe('PTW-ORG_0001')
    expect(formatDocId('ptw', null, 1)).toBe('PTW-ORG_0001')
  })

  it('never emits a zeroth document', () => {
    expect(formatDocId('ptw', 'ACME', 0)).toBe('PTW-ACME_0001')
  })
})

describe('parseDocId', () => {
  it('reads back what formatDocId wrote, for every kind', () => {
    for (const kind of Object.keys(DOC_CODES)) {
      const id = formatDocId(kind, 'ACME', 9)
      expect(parseDocId(id)).toEqual({ code: DOC_CODES[kind], kind, orgCode: 'ACME', seq: 9 })
    }
  })

  it('tolerates surrounding whitespace, since these get pasted', () => {
    expect(parseDocId('  PTW-ACME_0001 ')?.seq).toBe(1)
  })

  it('does not mistake the old reference numbers for the new format', () => {
    // IRA-2026-0001 and ILL-2026-0001 predate this and must not parse as ids.
    expect(parseDocId('IRA-2026-0001')).toBeNull()
    expect(parseDocId('ILL-2026-0001')).toBeNull()
  })

  it('rejects anything malformed rather than guessing', () => {
    for (const bad of ['', 'PTW-ACME', 'PTW_ACME_0001', 'ptw-acme_0001', 'PTW-ACME_', '-ACME_0001', null, undefined]) {
      expect(parseDocId(bad)).toBeNull()
    }
  })
})

describe('highestSeq', () => {
  it('finds the largest number already issued', () => {
    expect(highestSeq(['PTW-ACME_0003', 'PTW-ACME_0041', 'PTW-ACME_0007'])).toBe(41)
  })

  it('ignores records that have no id yet, and older reference numbers', () => {
    expect(highestSeq(['PTW-ACME_0005', '', null, 'IRA-2026-0900'])).toBe(5)
  })

  it('is zero when nothing has been issued, so the first is 0001', () => {
    expect(highestSeq([])).toBe(0)
    expect(highestSeq(['', null])).toBe(0)
  })
})

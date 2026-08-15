import { describe, it, expect } from 'vitest'
import * as copy from './docId.js'

// The original, imported from the app tree. This is the only file in server/
// that reaches across, and it is a TEST — .dockerignore keeps **/*.test.js out
// of the image, so the container still has no dependency on src/. Asserting the
// two against each other is what makes the vendored copy honest: the reason to
// copy at all is that the build context is server/, and the risk of copying is
// that the two drift and one org ends up with two numbering schemes.
const original = await import('../../../src/shared/docId/format.js')

describe('the vendored id format matches the app', () => {
  it('carries the same module codes', () => {
    expect(copy.DOC_CODES).toEqual(original.DOC_CODES)
    expect(copy.SEQ_PAD).toBe(original.SEQ_PAD)
  })

  // Every kind, because a code may be added but never repurposed — an id
  // already written on a paper permit cannot be re-pointed at another module.
  Object.keys(original.DOC_CODES).forEach((kind) => {
    it(`formats ${kind} identically`, () => {
      expect(copy.formatDocId(kind, 'ACME', 42)).toBe(original.formatDocId(kind, 'ACME', 42))
    })
  })

  const NAMES = [
    'Acme Corporation Pvt Ltd',
    'AB Industries',
    "O'Brien Engineering",
    'The Company',
    '  ',
    '株式会社',
    'X',
  ]

  NAMES.forEach((name) => {
    it(`derives the same code from ${JSON.stringify(name)}`, () => {
      expect(copy.deriveOrgCode(name)).toBe(original.deriveOrgCode(name))
    })
  })

  const CODES = ['acme', 'a', 'toolongcode', 'a-b-c', '', null, undefined, 'AB']

  CODES.forEach((value) => {
    it(`normalises ${JSON.stringify(value)} the same way`, () => {
      expect(copy.normalizeOrgCode(value)).toBe(original.normalizeOrgCode(value))
    })
  })

  const SEQS = [0, 1, 9, 10, 9999, 10000, -1, null, undefined, '7']

  SEQS.forEach((seq) => {
    it(`pads sequence ${JSON.stringify(seq)} the same way`, () => {
      expect(copy.formatDocId('inspections', 'ACME', seq)).toBe(original.formatDocId('inspections', 'ACME', seq))
    })
  })

  it('falls back the same way for a kind nobody registered', () => {
    expect(copy.formatDocId('somethingNew', 'ACME', 1)).toBe(original.formatDocId('somethingNew', 'ACME', 1))
    expect(copy.formatDocId('', '', 1)).toBe(original.formatDocId('', '', 1))
  })
})

describe('the one deliberate deviation', () => {
  // DOC_CODES is an object literal, so `DOC_CODES['constructor']` is the Object
  // CONSTRUCTOR — truthy, so the original's `||` fallback never fires and the
  // id is built by interpolating a function into a string. Not reachable (a
  // kind is developer-supplied) and one word to close, which is the same
  // inherited-key trap that was a live authorization bypass in authz/policy.js.
  it('does not read an inherited Object.prototype key as a module code', () => {
    expect(copy.formatDocId('constructor', 'ACME', 1)).toBe('CONSTRUCTOR-ACME_0001')
    expect(copy.formatDocId('toString', 'ACME', 1)).toBe('TOSTRING-ACME_0001')
    expect(original.formatDocId('constructor', 'ACME', 1)).toContain('native code')
  })
})

describe('what an id looks like', () => {
  it('is MODULE-ORG_0000, so it survives being read down a phone line', () => {
    expect(copy.formatDocId('inspections', 'Acme', 7)).toBe('INSP-ACME_0007')
  })

  it('never issues a zeroth id, whatever the counter says', () => {
    expect(copy.formatDocId('inspections', 'ACME', 0)).toBe('INSP-ACME_0001')
  })
})

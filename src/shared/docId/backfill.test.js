import { describe, it, expect } from 'vitest'
import { DOC_COLLECTIONS, BACKFILL_KINDS } from './backfill'
import { DOC_CODES, DOC_KIND_LABEL, formatDocId, parseDocId } from './format'

// The backfill itself talks to Firestore and is exercised against the emulator;
// what is worth pinning here is that the two tables agree, because a kind that
// is numbered but has no code — or numbered out of a collection that belongs to
// a different module — produces wrong ids on real records and no error at all.
describe('the kind tables line up', () => {
  it('gives every backfillable kind a code and a label', () => {
    for (const kind of BACKFILL_KINDS) {
      expect(DOC_CODES[kind], `${kind} has no code`).toBeTruthy()
      expect(DOC_KIND_LABEL[kind], `${kind} has no label`).toBeTruthy()
    }
  })

  it('never points two kinds at one collection', () => {
    // Two kinds sharing a collection would interleave two sequences in it.
    const cols = Object.values(DOC_COLLECTIONS)
    expect(new Set(cols).size).toBe(cols.length)
  })

  it('produces a parseable id for every kind it can number', () => {
    for (const kind of BACKFILL_KINDS) {
      const id = formatDocId(kind, 'ACME', 1)
      expect(parseDocId(id)).toMatchObject({ kind, orgCode: 'ACME', seq: 1 })
    }
  })

  it('leaves equipment out, since a unit already has a serial', () => {
    expect(DOC_COLLECTIONS.equipment).toBeUndefined()
    expect(DOC_CODES.equipment).toBeUndefined()
  })

  it('leaves LOTO out until its records are org-scoped', () => {
    // It has a code so creates can use one later; it has no collection here
    // because the procedures collection is top-level and carries no orgId.
    expect(DOC_CODES.loto).toBe('LOTO')
    expect(DOC_COLLECTIONS.loto).toBeUndefined()
  })
})

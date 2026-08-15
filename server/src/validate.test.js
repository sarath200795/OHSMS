import { describe, it, expect } from 'vitest'
import { compileFieldSpec, readDocumentFields, MAX_DEPTH } from './validate.js'
import { ApiError } from './errors.js'

const spec = compileFieldSpec({
  accepts: ['title', 'status', 'fields', 'responses'],
  stamps: ['createdAt', 'updatedAt', 'createdBy'],
})

/** The code a body was refused with, or null when it was accepted. */
function refusal(body, s = spec) {
  try {
    readDocumentFields(body, s)
    return null
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(400)
    return err.code
  }
}

const wrap = (data) => ({ data })

describe('the allowlist', () => {
  it('passes the fields a spec accepts, unchanged', () => {
    const data = { title: 'Monthly walk', status: 'Draft', fields: [{ id: 'q1', label: 'Extinguisher' }] }
    expect(readDocumentFields(wrap(data), spec)).toEqual(data)
  })

  // Dropping it silently would mean a client that thinks it saved something and
  // a server that did not — the same class of lie as the QR report that came
  // back "already reported" when it had in fact been refused.
  it('REFUSES an unexpected field rather than ignoring it', () => {
    expect(refusal(wrap({ title: 'x', lifecycle: 'closed' }))).toBe('unknown_field')
  })

  // Two different developer mistakes, so two different codes: "there is no such
  // field" sends someone hunting a typo that is not there.
  it('tells a caller that sent a server-stamped field so, specifically', () => {
    expect(refusal(wrap({ title: 'x', createdAt: 12345 }))).toBe('reserved_field')
    expect(refusal(wrap({ createdBy: 'somebody else' }))).toBe('reserved_field')
  })

  // The inherited-key trap that was a live authorization bypass in
  // src/authz/policy.js: an object-literal allowlist answers "yes" for every
  // key on Object.prototype. A Set has none.
  const INHERITED = ['constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', '__proto__']

  INHERITED.forEach((key) => {
    it(`refuses ${JSON.stringify(key)}, which an object-literal allowlist would pass`, () => {
      expect(refusal(wrap({ [key]: 'x' }))).toMatch(/unknown_field|invalid_field_name/)
    })
  })

  // JSON.parse produces __proto__ as a real own property rather than invoking
  // the setter, so it reaches Object.keys and would ride along on a spread.
  it('never lets a parsed __proto__ key into the written document', () => {
    const parsed = JSON.parse('{"title":"x","__proto__":{"role":"admin"}}')
    expect(refusal(wrap(parsed))).toBe('invalid_field_name')
  })

  it('builds a fresh object rather than handing back the caller\'s', () => {
    const data = { title: 'x' }
    const out = readDocumentFields(wrap(data), spec)
    expect(out).not.toBe(data)
    out.title = 'mutated'
    expect(data.title).toBe('x')
  })
})

describe('field names', () => {
  // The Admin SDK reads a dot in an update key as a FIELD PATH, so
  // `responses.q1.actionStatus` writes one nested leaf. A whole-key allowlist
  // would refuse it and a first-segment allowlist would let a caller write to
  // an arbitrary depth of a field it was only allowed to replace.
  it('refuses a dotted key even when its first segment is accepted', () => {
    expect(refusal(wrap({ 'responses.q1.actionStatus': 'closed' }))).toBe('invalid_field_name')
    expect(refusal(wrap({ 'responses.q1': {} }))).toBe('invalid_field_name')
  })

  it('refuses a slash, an empty name and a reserved __ prefix', () => {
    expect(refusal(wrap({ 'a/b': 1 }))).toBe('invalid_field_name')
    expect(refusal(wrap({ '': 1 }))).toBe('invalid_field_name')
    expect(refusal(wrap({ __name__: 1 }))).toBe('invalid_field_name')
  })

  // The same names, one level down. A nested map is written wholesale, so a key
  // Firestore rejects there fails the whole write at commit time — after the
  // authorization check has passed and with a message from the storage layer.
  it('applies the same names check inside a nested map', () => {
    expect(refusal(wrap({ responses: { 'q1.answer': 'Pass' } }))).toBe('invalid_field_name')
    // Written as JSON because that is the only way to GET a `__proto__` own
    // property — an object literal with that key sets the prototype instead, so
    // a test written by hand would prove the check on a key that is not there.
    const parsed = JSON.parse('{"responses":{"q1":{"__proto__":{"role":"admin"}}}}')
    expect(refusal(wrap(parsed))).toBe('invalid_field_name')
  })
})

describe('field values', () => {
  it('accepts the shapes JSON actually carries', () => {
    const data = {
      title: '',
      status: null,
      fields: [1, 'two', true, null, { nested: { deeper: [] } }],
      responses: {},
    }
    expect(readDocumentFields(wrap(data), spec)).toEqual(data)
  })

  // A sentinel that reached Firestore as a plain object would be stored as an
  // empty map — a serverTimestamp silently becoming `{}` is a timestamp nobody
  // notices is missing.
  it('refuses anything that is not plain JSON', () => {
    class FieldValue {}
    expect(refusal(wrap({ title: new Date() }))).toBe('invalid_field_value')
    expect(refusal(wrap({ title: new FieldValue() }))).toBe('invalid_field_value')
    expect(refusal(wrap({ title: () => 'x' }))).toBe('invalid_field_value')
    expect(refusal(wrap({ title: undefined }))).toBe('invalid_field_value')
    expect(refusal(wrap({ fields: [new Date()] }))).toBe('invalid_field_value')
  })

  // Firestore stores NaN, after which every comparison against it is false and
  // a score of NaN reads as an inspection nobody failed.
  it('refuses a non-finite number', () => {
    expect(refusal(wrap({ title: NaN }))).toBe('invalid_field_value')
    expect(refusal(wrap({ title: Infinity }))).toBe('invalid_field_value')
    expect(readDocumentFields(wrap({ title: 0 }), spec)).toEqual({ title: 0 })
  })

  it('accepts an object with a null prototype, which is still plain data', () => {
    const bare = Object.create(null)
    bare.answer = 'Pass'
    expect(readDocumentFields(wrap({ responses: bare }), spec)).toEqual({ responses: { answer: 'Pass' } })
  })

  it(`refuses nesting deeper than the ${MAX_DEPTH} levels Firestore stores`, () => {
    const deep = (n) => (n === 0 ? 'leaf' : { down: deep(n - 1) })
    expect(refusal(wrap({ responses: deep(MAX_DEPTH + 2) }))).toBe('invalid_field_value')
    expect(refusal(wrap({ responses: deep(3) }))).toBe(null)
  })
})

describe('the envelope', () => {
  // `body.data` rather than the body itself, so a flag like `merge` cannot
  // collide with a document field of the same name — and users define their own
  // form questions on this system.
  it('reads the document out of body.data', () => {
    expect(refusal({ title: 'x' })).toBe('invalid_body')
    expect(refusal({ data: null })).toBe('invalid_body')
    expect(refusal({ data: [] })).toBe('invalid_body')
    expect(refusal(undefined)).toBe('invalid_body')
    expect(refusal('a string')).toBe('invalid_body')
  })

  // An empty write still stamps updatedAt, so it is a document touched with
  // nothing said rather than the no-op it looks like.
  it('refuses a write that says nothing', () => {
    expect(refusal({ data: {} })).toBe('invalid_body')
  })
})

describe('compiling a spec', () => {
  // One of the two is a typo, and the wrong reading is the one where the caller
  // gets to choose a field the server was supposed to pin.
  it('refuses a spec that both accepts and stamps a field', () => {
    expect(() => compileFieldSpec({ accepts: ['createdAt'], stamps: ['createdAt'] })).toThrow(/both accepts and stamps/)
  })

  it('refuses a spec naming a field Firestore cannot store', () => {
    expect(() => compileFieldSpec({ accepts: ['a.b'] })).toThrow(/unusable field/)
    expect(() => compileFieldSpec({ stamps: ['__x'] })).toThrow(/unusable field/)
  })

  it('is empty by default, which accepts nothing at all', () => {
    expect(refusal(wrap({ title: 'x' }), compileFieldSpec())).toBe('unknown_field')
  })
})

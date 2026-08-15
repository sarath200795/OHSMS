// ─────────────────────────────────────────────────────────────────────────────
// The server's keys().hasOnly() — an allowlist over the request body.
//
// WHY THIS EXISTS AT ALL, GIVEN THE RULE DOES NOT. The generic org-data rule
// (firestore.rules:1054-1058) constrains WHO writes and never WHAT: for
// inspectionTemplates and inspectionRecords it validates no field, no type and
// no key set. So this is deliberately STRICTER than the rule it replaces, and
// that direction is the safe one — it refuses writes the rules would have
// allowed, never the reverse.
//
// The reason to be stricter here rather than "later" is that the rules already
// wrote down what happens when a payload is not pinned. /reports and
// /observations both shipped without a hasOnly() and both had to be patched
// (firestore.rules:762-767): an unconstrained create is an invitation to store
// whatever the client feels like in someone else's tenant, and every field that
// arrives unannounced is a field some later query, export or PDF will render
// without anyone having decided it should exist.
//
// AN UNEXPECTED FIELD IS REFUSED, NOT DROPPED. Silently discarding it would
// mean a client that thinks it saved something and a server that did not — the
// same class of lie as the QR report that came back "already reported" when it
// had in fact been refused (firestore.rules:96-104).
//
// WHAT A REFUSAL SAYS. A code, and the offending key only in the LOG. That is
// src/errors.js's contract for the whole server: the caller gets
// `{ error: { code, requestId } }`, and whoever can read the logs joins the two.
// The codes below are narrow on purpose — "there is no such field" and "the
// server sets that one" are different mistakes and a developer should not have
// to guess which they made.
// ─────────────────────────────────────────────────────────────────────────────
import { ApiError } from './errors.js'

/**
 * Firestore refuses a document nested deeper than 20 levels, so anything past
 * that cannot be stored and only buys the server a recursive walk it was told
 * to do by the caller. Refusing at the same depth means the error names the
 * real problem instead of arriving later as an opaque write failure.
 */
export const MAX_DEPTH = 20

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * A field name this server will accept as a top-level key.
 *
 * THE DOT IS THE IMPORTANT ONE. The Admin SDK reads a dot in an update key as a
 * FIELD PATH — `.update({ 'responses.q1.actionStatus': 'closed' })` writes one
 * nested leaf. An allowlist that compared the whole key would see
 * `responses.q1.actionStatus`, not find it, and refuse; an allowlist that
 * compared only the first segment would let a caller write to an arbitrary
 * depth of a field it was merely allowed to replace. Neither is a good answer,
 * so a dotted key is refused outright and callers write whole fields. Nothing
 * in this module needs a nested write, and the day one does it should arrive
 * with its own route rather than through a hole in the key check.
 *
 * `/` cannot appear in a Firestore field name at all. `__`-prefixed names are
 * reserved by Firestore, and `__proto__` is the one JSON.parse will hand over
 * as a real own property — the allowlist below already excludes it, and this
 * makes that true even if a spec is ever written carelessly.
 */
const isUsableFieldName = (key) =>
  typeof key === 'string' &&
  key !== '' &&
  !key.includes('.') &&
  !key.includes('/') &&
  !key.startsWith('__')

/** A refusal the caller sees as a code and the log sees in full. */
const refuse = (code, detail) => new ApiError(400, code, detail)

/**
 * Everything this seam can carry to Firestore, and nothing else.
 *
 * Recursive, because the shapes these routes accept are genuinely nested — a
 * template's `fields` and a record's `responses` are both maps of maps. What is
 * refused is anything that is not JSON: a class instance, a function, a
 * Timestamp, `undefined`, NaN or Infinity. Those cannot arrive over HTTP from
 * an honest client, so their presence means either a caller sending something
 * hand-rolled or a bug, and storing an object whose prototype nobody inspected
 * is not a thing to do quietly.
 */
function assertStorableValue(value, path, depth) {
  if (depth > MAX_DEPTH) throw refuse('invalid_field_value', `${path}: nested deeper than ${MAX_DEPTH}`)

  if (value === null || typeof value === 'boolean' || typeof value === 'string') return
  if (typeof value === 'number') {
    // JSON has no NaN or Infinity, so one here was constructed, not parsed —
    // and Firestore stores NaN happily, after which every comparison against it
    // is false and a score of NaN reads as an inspection nobody failed.
    if (!Number.isFinite(value)) throw refuse('invalid_field_value', `${path}: not a finite number`)
    return
  }

  if (Array.isArray(value)) {
    value.forEach((v, i) => assertStorableValue(v, `${path}[${i}]`, depth + 1))
    return
  }

  if (isPlainObject(value)) {
    // Prototype check, not a duck-type: `Object.create(null)` and a literal are
    // both fine, a Date or a FieldValue is not. A sentinel reaching here would
    // otherwise be stored as `{}` — a serverTimestamp silently becoming an
    // empty map is a timestamp nobody notices is missing.
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) {
      throw refuse('invalid_field_value', `${path}: ${value.constructor?.name || 'non-plain object'}`)
    }
    for (const key of Object.keys(value)) {
      if (!isUsableFieldName(key)) throw refuse('invalid_field_name', `${path}.${key}`)
      assertStorableValue(value[key], `${path}.${key}`, depth + 1)
    }
    return
  }

  throw refuse('invalid_field_value', `${path}: ${typeof value}`)
}

/**
 * The `{ accepts, stamps }` of a collection, in the form the checks below want.
 *
 * SETS, NOT OBJECT LITERALS. A `{}` map inherits from Object.prototype, so
 * `accepts['constructor']` is truthy and a field called `constructor` walks
 * through an allowlist that never mentioned it. That exact shape was a live
 * authorization bypass in src/authz/policy.js — the predicate registry answered
 * "yes" for `constructor` and a guard built on it refused nobody. A Set has no
 * inherited keys and cannot be got wrong the same way twice.
 */
export function compileFieldSpec({ accepts = [], stamps = [] } = {}) {
  const accept = new Set(accepts)
  const stamp = new Set(stamps)

  // A spec that both accepts and stamps a key is ambiguous — one of the two is
  // a typo, and the wrong reading is the one where the caller wins. Fail at
  // wiring time, where it is a startup crash rather than a data question.
  for (const key of stamp) {
    if (accept.has(key)) throw new Error(`Field spec both accepts and stamps "${key}"`)
  }
  for (const key of [...accept, ...stamp]) {
    if (!isUsableFieldName(key)) throw new Error(`Field spec names an unusable field: ${JSON.stringify(key)}`)
  }

  return { accept, stamp }
}

/**
 * The caller's fields, or a 400.
 *
 * Returns a FRESH object built key by key from the allowlist. Never the parsed
 * body, never a spread of it: a spread copies own keys the check did not visit,
 * and `JSON.parse('{"__proto__":{}}')` produces exactly such a key.
 *
 * `body.data` rather than the body itself, so the envelope can carry a flag
 * (`merge`) without it colliding with a document field of the same name — a
 * document with a `merge` field is not a hypothetical in a system where users
 * define their own form questions.
 */
export function readDocumentFields(body, spec) {
  if (!isPlainObject(body)) throw refuse('invalid_body', 'body is not a JSON object')
  const data = body.data
  if (!isPlainObject(data)) throw refuse('invalid_body', 'body.data is not a JSON object')

  const keys = Object.keys(data)
  // An empty write still stamps `updatedAt`, so it is not the harmless no-op it
  // looks like — it is a document touched with nothing said. Every call site in
  // the app sends at least one field; a body with none is a client bug and
  // reads better as one than as a successful save.
  if (keys.length === 0) throw refuse('invalid_body', 'body.data has no fields')

  const out = {}
  for (const key of keys) {
    if (!isUsableFieldName(key)) throw refuse('invalid_field_name', key)
    // Checked before the allowlist so the message names the real mistake: a
    // caller sending `createdAt` has not invented a field, it has tried to
    // choose one the server pins. Telling them "unknown field" would send them
    // looking for a typo that is not there.
    if (spec.stamp.has(key)) throw refuse('reserved_field', key)
    if (!spec.accept.has(key)) throw refuse('unknown_field', key)
    assertStorableValue(data[key], key, 1)
    out[key] = data[key]
  }
  return out
}

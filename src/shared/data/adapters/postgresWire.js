// Values that cross the postgres adapter.
//
// Stored JSON is not a place to turn a Firestore Timestamp into an ISO string.
// Call sites read `.seconds` and `.toDate()`, and a comparator that returns 0
// leaves the original order, so a list can look sorted and be wrong. A timestamp
// is carried as `{ __ohsms: 'ts', s, ns }` on the wire and revived into an
// object with those methods on the way out.
//
// Sentinels stay opaque until the engine resolves them, in the same statement
// as the write. `increment` is not a read the caller performs.

const FIELD = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/

export class PgTimestamp {
  constructor(seconds, nanoseconds) {
    this.seconds = seconds
    this.nanoseconds = nanoseconds
    Object.freeze(this)
  }
  static now() {
    return nextTimestamp()
  }
  static fromMillis(ms) {
    const s = Math.floor(ms / 1000)
    return new PgTimestamp(s, (ms - s * 1000) * 1e6)
  }
  static fromDate(date) {
    return PgTimestamp.fromMillis(date.getTime())
  }
  toMillis() {
    return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6)
  }
  toDate() {
    return new Date(this.toMillis())
  }
  toJSON() {
    return { __ohsms: 'ts', s: this.seconds, ns: this.nanoseconds }
  }
}

let lastMicros = 0
export function nextTimestamp(nowMs = Date.now()) {
  const micros = Math.max(nowMs * 1000, lastMicros + 1)
  lastMicros = micros
  return new PgTimestamp(Math.floor(micros / 1e6), (micros % 1e6) * 1000)
}

export function serverTimestamp() {
  return Object.freeze({ __ohsms: 'serverTimestamp' })
}
export function increment(n) {
  return Object.freeze({ __ohsms: 'increment', n: Number(n) || 0 })
}
export function arrayUnion(...values) {
  return Object.freeze({ __ohsms: 'arrayUnion', values })
}
export function deleteField() {
  return Object.freeze({ __ohsms: 'deleteField' })
}

export function isSentinel(v) {
  return Boolean(v) && typeof v === 'object' && typeof v.__ohsms === 'string' && v.__ohsms !== 'ts'
}

function isPlain(v) {
  return (
    Boolean(v) &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    !(v instanceof Date) &&
    !(v instanceof PgTimestamp)
  )
}

export function assertField(field) {
  if (!field || typeof field !== 'string' || !FIELD.test(field)) {
    throw Object.assign(new Error('postgres: a where entry needs a field'), {
      code: 'invalid-argument',
    })
  }
  return field.split('.')
}

export function jsonbPath(field) {
  return `{${assertField(field).join(',')}}`
}

function timeParts(v) {
  if (v instanceof Date) {
    const ms = v.getTime()
    const s = Math.floor(ms / 1000)
    return [s, (ms - s * 1000) * 1e6]
  }
  if (v instanceof PgTimestamp) return [v.seconds, v.nanoseconds]
  if (!v || typeof v !== 'object') return null
  if (v.__ohsms === 'ts' && typeof v.s === 'number') return [v.s, v.ns || 0]
  if (typeof v.seconds === 'number' && typeof v.nanoseconds === 'number')
    return [v.seconds, v.nanoseconds]
  if (typeof v.toMillis === 'function' && typeof v.seconds === 'number')
    return [v.seconds, v.nanoseconds || 0]
  return null
}

export function encodeTree(value, now) {
  if (isSentinel(value)) return value
  const parts = timeParts(value)
  if (parts) return { __ohsms: 'ts', s: parts[0], ns: parts[1] }
  if (Array.isArray(value)) return value.map((v) => encodeTree(v, now))
  if (isPlain(value)) {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = encodeTree(v, now)
    return out
  }
  return value
}

export function revive(value) {
  if (Array.isArray(value)) return value.map(revive)
  if (!value || typeof value !== 'object') return value
  if (value.__ohsms === 'ts') return new PgTimestamp(value.s, value.ns || 0)
  const out = {}
  for (const [k, v] of Object.entries(value)) out[k] = revive(v)
  return out
}

function deepEqual(a, b) {
  if (a === b) return true
  const ta = timeParts(a)
  const tb = timeParts(b)
  if (ta || tb) return Boolean(ta && tb) && ta[0] === tb[0] && ta[1] === tb[1]
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]))
  if (isPlain(a) && isPlain(b)) {
    const ka = Object.keys(a)
    return ka.length === Object.keys(b).length && ka.every((k) => deepEqual(a[k], b[k]))
  }
  return false
}

function getPath(obj, segs) {
  let cur = obj
  for (const s of segs) {
    if (!isPlain(cur)) return undefined
    cur = cur[s]
    if (cur === undefined) return undefined
  }
  return cur
}

function setPath(obj, segs, value) {
  let cur = obj
  for (let i = 0; i < segs.length - 1; i += 1) {
    if (!isPlain(cur[segs[i]])) cur[segs[i]] = {}
    cur = cur[segs[i]]
  }
  cur[segs[segs.length - 1]] = value
}

function resolveSentinel(s, prev, now) {
  if (s.__ohsms === 'serverTimestamp') return encodeTree(now(), now)
  if (s.__ohsms === 'increment') return (typeof prev === 'number' ? prev : 0) + s.n
  if (s.__ohsms === 'arrayUnion') {
    const base = Array.isArray(prev) ? [...prev] : []
    for (const v of s.values || []) {
      const enc = encodeTree(v, now)
      if (!base.some((x) => deepEqual(x, enc))) base.push(enc)
    }
    return base
  }
  if (s.__ohsms === 'deleteField') return undefined
  throw Object.assign(new Error(`postgres: unknown sentinel ${s.__ohsms}`), {
    code: 'invalid-argument',
  })
}

function mergeTree(prev, value, now) {
  if (isSentinel(value)) return resolveSentinel(value, prev, now)
  if (isPlain(value)) {
    const base = isPlain(prev) ? { ...prev } : {}
    for (const [k, v] of Object.entries(value)) {
      const next = mergeTree(base[k], v, now)
      if (next === undefined) delete base[k]
      else base[k] = next
    }
    return base
  }
  return encodeTree(value, now)
}

/**
 * The document after one write op. `prev` is the stored JSON (already encoded)
 * or undefined when the row is absent. deleteField removes the key.
 */
export function applyPatch(prev, op, now = () => nextTimestamp()) {
  const data = op.data || {}
  if (op.type === 'update') {
    const out = isPlain(prev) ? structuredClone(prev) : {}
    for (const [key, value] of Object.entries(data)) {
      const segs = key.split('.')
      const before = getPath(out, segs)
      const next = isSentinel(value)
        ? resolveSentinel(value, before, now)
        : mergeTree(before, value, now)
      if (next === undefined) {
        let cur = out
        for (let i = 0; i < segs.length - 1; i += 1) cur = cur?.[segs[i]]
        if (cur && typeof cur === 'object') delete cur[segs[segs.length - 1]]
      } else {
        setPath(out, segs, next)
      }
    }
    return out
  }
  if (op.merge) return mergeTree(prev, data, now)
  return mergeTree(undefined, data, now)
}

export function assertWritable(value, trail = '') {
  if (value === undefined) {
    throw Object.assign(
      new Error(`postgres: undefined is not a value (field ${trail || '<root>'})`),
      {
        code: 'invalid-argument',
      }
    )
  }
  if (isSentinel(value) || value === null || typeof value !== 'object') return
  if (value instanceof Date || value instanceof PgTimestamp) return
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertWritable(v, `${trail}[${i}]`))
    return
  }
  if (!isPlain(value)) return
  for (const [k, v] of Object.entries(value)) assertWritable(v, trail ? `${trail}.${k}` : k)
}

const OPS = new Set(['==', '!=', '<', '<=', '>', '>=', 'in'])

export function assertOpts(opts = {}) {
  for (const c of opts.where || []) {
    if (!c || !c.field) {
      throw Object.assign(new Error('postgres: a where entry needs a field'), {
        code: 'invalid-argument',
      })
    }
    assertField(c.field)
    if (!OPS.has(c.op)) {
      throw Object.assign(new Error(`postgres: unsupported where op '${c.op}'`), {
        code: 'invalid-argument',
      })
    }
    if (c.op === 'in' && !Array.isArray(c.value)) {
      throw Object.assign(new Error("postgres: 'in' needs an array of values"), {
        code: 'invalid-argument',
      })
    }
  }
  if (opts.orderBy && (!Array.isArray(opts.orderBy) || !opts.orderBy[0])) {
    throw Object.assign(new Error('postgres: orderBy is [field, "asc"|"desc"]'), {
      code: 'invalid-argument',
    })
  }
}

export function collectionPath(path) {
  const segs = String(path || '')
    .split('/')
    .filter(Boolean)
  if (!segs.length)
    throw Object.assign(new Error('postgres: empty collection path'), { code: 'invalid-argument' })
  if (segs.length % 2 === 0) {
    throw Object.assign(new Error(`postgres: '${path}' is a document path, not a collection`), {
      code: 'invalid-argument',
    })
  }
  return segs.join('/')
}

export function documentId(id) {
  const s = String(id ?? '')
  if (!s || s.includes('/')) {
    throw Object.assign(new Error(`postgres: '${s}' is not a document id`), {
      code: 'invalid-argument',
    })
  }
  return s
}

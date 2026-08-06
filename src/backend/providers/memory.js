// ─────────────────────────────────────────────────────────────────────────────
// The in-memory provider.
//
// Two jobs. It is the executable proof that the ports are real — the contract
// suite runs identically against this and against Firebase, so a third
// implementation has a specification to pass rather than a vibe to match. And
// it is the reference for anyone writing a client adapter: every method here is
// the smallest honest implementation of its contract.
//
// Single-threaded JS makes the atomicity easy — createExclusive and
// runTransaction are naturally isolated because nothing interleaves a
// synchronous section. A real networked adapter has to earn the same guarantees
// from its database (unique constraints, SELECT … FOR UPDATE, compare-and-set),
// which is exactly why the contract names them.
// ─────────────────────────────────────────────────────────────────────────────

const SERVER_TIME = Symbol('serverTimestamp')

const clone = (v) => JSON.parse(JSON.stringify(v, (k, val) => (val === SERVER_TIME ? undefined : val)))

const resolveTimestamps = (data, now) => {
  const out = {}
  for (const [k, v] of Object.entries(data)) {
    out[k] = v === SERVER_TIME ? now : v && typeof v === 'object' && !Array.isArray(v) ? resolveTimestamps(v, now) : v
  }
  return out
}

export function createMemoryData() {
  const docs = new Map() // path -> data

  const write = (path, data, { merge = false } = {}) => {
    const resolved = resolveTimestamps(data, new Date().toISOString())
    docs.set(path, merge ? { ...(docs.get(path) || {}), ...resolved } : resolved)
  }

  return {
    async get(path) {
      return docs.has(path) ? clone(docs.get(path)) : null
    },

    async set(path, data, opts) {
      write(path, data, opts)
    },

    async delete(path) {
      docs.delete(path)
    },

    async createExclusive(path, data) {
      if (docs.has(path)) {
        const e = new Error(`already exists: ${path}`)
        e.code = 'already-exists'
        throw e
      }
      write(path, data)
    },

    async runTransaction(fn) {
      // Buffer writes; apply only when fn resolves — a thrown fn changes nothing.
      const staged = []
      const tx = {
        get: async (path) => (docs.has(path) ? clone(docs.get(path)) : null),
        set: (path, data, opts) => staged.push([path, data, opts]),
      }
      const result = await fn(tx)
      for (const [path, data, opts] of staged) write(path, data, opts)
      return result
    },

    batch() {
      const ops = []
      return {
        createExclusive: (path, data) => ops.push(['createExclusive', path, data]),
        set: (path, data, opts) => ops.push(['set', path, data, opts]),
        delete: (path) => ops.push(['delete', path]),
        commit: async () => {
          // Validate every exclusive create BEFORE applying anything, so the
          // batch is all-or-nothing like the contract says.
          for (const [op, path] of ops) {
            if (op === 'createExclusive' && docs.has(path)) {
              const e = new Error(`already exists: ${path}`)
              e.code = 'already-exists'
              throw e
            }
          }
          for (const [op, path, data, opts] of ops) {
            if (op === 'delete') docs.delete(path)
            else write(path, data, opts)
          }
        },
      }
    },

    serverTimestamp: () => SERVER_TIME,

    /** Test seam: peek at raw contents. */
    _dump: () => new Map(docs),
  }
}

export function createMemoryStorage() {
  const objects = new Map() // path -> Blob

  return {
    async put(path, blob) {
      objects.set(path, blob)
      // A data-ish URL keeps the contract ("a fetchable URL") honest without a
      // server; real adapters return their CDN/bucket URL here.
      return { url: `memory://${path}` }
    },
    async remove(path) {
      objects.delete(path)
    },
    _dump: () => new Map(objects),
  }
}

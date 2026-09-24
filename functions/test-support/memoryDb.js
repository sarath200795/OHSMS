// In-memory stand-in for the Admin SDK calls the mail deliver functions make.
// where() is a real filter here: audience tests are about which profile matched.

export function memoryDb(seed = {}) {
  const store = new Map(Object.entries(seed))

  const docRef = (path) => ({
    path,
    id: path.split('/').pop(),
    async get() {
      const data = store.get(path)
      return {
        id: path.split('/').pop(),
        exists: data !== undefined,
        data: () => (data === undefined ? undefined : data),
      }
    },
    async create(data) {
      if (store.has(path)) {
        const err = new Error('already exists')
        err.code = 6
        throw err
      }
      store.set(path, { ...data })
    },
    async update(patch) {
      store.set(path, { ...(store.get(path) || {}), ...patch })
    },
    async delete() {
      store.delete(path)
    },
  })

  function rowsUnder(prefix) {
    const needle = `${prefix}/`
    return [...store.entries()]
      .filter(([p]) => p.startsWith(needle) && !p.slice(needle.length).includes('/'))
      .map(([p, data]) => ({
        id: p.split('/').pop(),
        data: () => data,
        ref: docRef(p),
      }))
  }

  const collection = (name) => ({
    doc: (id) => docRef(`${name}/${id}`),
    async get() {
      const docs = rowsUnder(name)
      return { docs, empty: docs.length === 0, size: docs.length }
    },
    where(field, _op, value) {
      return {
        async get() {
          const docs = rowsUnder(name).filter((d) => (d.data() || {})[field] === value)
          return { docs, empty: docs.length === 0, size: docs.length }
        },
      }
    },
  })

  return {
    store,
    doc: docRef,
    collection,
    notifications() {
      return [...store.keys()].filter((p) => p.includes('/notifications/'))
    },
  }
}

export function mailer(sent, { pass = 'secret', origin = 'https://suite.weehs.org' } = {}) {
  return {
    config: {
      host: 'mail.privateemail.com',
      from: 'EHS notifications <info@weehs.org>',
      pass,
      appOrigin: origin,
    },
    async send(message) {
      sent.push(message)
    },
  }
}

export function user(uid, extra = {}) {
  return {
    uid,
    orgId: 'orgA',
    status: 'approved',
    email: `${uid}@example.com`,
    role: 'member',
    access: { sites: [], regions: [], entities: [] },
    ...extra,
  }
}

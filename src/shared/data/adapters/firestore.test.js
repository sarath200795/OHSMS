import { describe, it, expect, vi, beforeEach } from 'vitest'

// This adapter is a translation layer, so what these tests pin is the
// translation: which SDK call each contract method makes, against which path,
// carrying which shape. The guarantees UNDER those calls — atomic exclusive
// create, all-or-nothing batches — are Firestore's and firestore.rules', and no
// mock can prove them. What a mock can prove is that the adapter asks for them
// and never quietly substitutes something weaker, which is the way this seam
// would most plausibly rot: a get-then-set exclusive create, a batch split into
// two commits, an update turned into an upsert.

vi.mock('../../firebase', () => ({ db: { __db: true } }))

vi.mock('firebase/firestore', () => {
  // Refs are just their path, so every assertion below reads as the address it
  // is really about. doc() has two shapes in the SDK — doc(db, ...segments) and
  // doc(collectionRef) minting a new id — and the adapter uses both.
  const isRef = (v) => Boolean(v && typeof v.path === 'string')
  let minted = 0

  return {
    collection: (_db, ...s) => ({ path: s.join('/') }),
    doc: (first, ...rest) => {
      if (isRef(first)) {
        const id = `minted${(minted += 1)}`
        return { path: `${first.path}/${id}`, id }
      }
      return { path: rest.join('/'), id: rest[rest.length - 1] }
    },
    query: (base, ...constraints) => ({ path: base.path, constraints }),
    where: (field, op, value) => ({ c: 'where', field, op, value }),
    orderBy: (field, dir) => ({ c: 'orderBy', field, dir }),
    limit: (n) => ({ c: 'limit', n }),

    serverTimestamp: () => ({ sentinel: 'serverTimestamp' }),
    increment: (n) => ({ sentinel: 'increment', n }),
    arrayUnion: (...values) => ({ sentinel: 'arrayUnion', values }),

    getDoc: vi.fn(),
    getDocs: vi.fn(),
    getCountFromServer: vi.fn(),
    onSnapshot: vi.fn(),
    addDoc: vi.fn(),
    setDoc: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    writeBatch: vi.fn(),
    runTransaction: vi.fn(),
  }
})

const fs = await import('firebase/firestore')
const { default: provider } = await import('./firestore')

const INCIDENTS = 'organizations/org1/incidents'

const docSnap = (id, data) => ({ id, exists: () => data != null, data: () => data })
const colSnap = (rows) => ({ docs: rows.map(([id, data]) => ({ id, data: () => data })) })
const denied = () => Object.assign(new Error('refused'), { code: 'permission-denied' })

beforeEach(() => {
  vi.clearAllMocks()
  fs.getDoc.mockResolvedValue(docSnap('x', null))
  fs.getDocs.mockResolvedValue(colSnap([]))
  fs.getCountFromServer.mockResolvedValue({ data: () => ({ count: 0 }) })
  fs.onSnapshot.mockReturnValue(() => {})
  fs.addDoc.mockResolvedValue({ id: 'new1' })
  fs.setDoc.mockResolvedValue(undefined)
  fs.updateDoc.mockResolvedValue(undefined)
  fs.deleteDoc.mockResolvedValue(undefined)
})

// ── The six that already had a consumer ───────────────────────────────────────
// module-kit/service.js is live against these today. Their shape is not open for
// improvement; anything that changes here changes every module at once.
describe('the methods module-kit already depends on', () => {
  it('lists ordered records as plain rows', async () => {
    fs.getDocs.mockResolvedValue(colSnap([['a', { title: 'One' }], ['b', { title: 'Two' }]]))
    const rows = await provider.list(INCIDENTS, { orderBy: ['createdAt', 'desc'] })
    expect(rows).toEqual([{ id: 'a', title: 'One' }, { id: 'b', title: 'Two' }])
    expect(fs.getDocs.mock.calls[0][0]).toEqual({
      path: INCIDENTS,
      constraints: [{ c: 'orderBy', field: 'createdAt', dir: 'desc' }],
    })
  })

  it('queries the bare collection when there is nothing to constrain', async () => {
    await provider.list(INCIDENTS)
    expect(fs.getDocs.mock.calls[0][0]).toEqual({ path: INCIDENTS })
  })

  it('subscribes with the caller onError, and hands back an unsubscribe now', () => {
    const cb = vi.fn()
    const onError = vi.fn()
    const stop = vi.fn()
    fs.onSnapshot.mockReturnValue(stop)

    // Synchronously: a caller that stores this in a useEffect cleanup has no
    // way to await it, and a listener nobody can stop outlives its screen.
    const unsub = provider.subscribe(INCIDENTS, { limit: 10 }, cb, onError)
    expect(unsub).toBe(stop)

    const [, next, err] = fs.onSnapshot.mock.calls[0]
    next(colSnap([['a', { n: 1 }]]))
    expect(cb).toHaveBeenCalledWith([{ id: 'a', n: 1 }])
    expect(err).toBe(onError)
  })

  it('creates with a backend-assigned id', async () => {
    fs.addDoc.mockResolvedValue({ id: 'generated' })
    expect(await provider.create(INCIDENTS, { title: 'x' })).toBe('generated')
    expect(fs.addDoc).toHaveBeenCalledWith({ path: INCIDENTS }, { title: 'x' })
  })

  it('updates and removes by (path, id)', async () => {
    await provider.update(INCIDENTS, 'i1', { status: 'open' })
    expect(fs.updateDoc).toHaveBeenCalledWith({ path: `${INCIDENTS}/i1`, id: 'i1' }, { status: 'open' })

    await provider.remove(INCIDENTS, 'i1')
    expect(fs.deleteDoc).toHaveBeenCalledWith({ path: `${INCIDENTS}/i1`, id: 'i1' })
  })

  it('offers serverTimestamp as an opaque value', () => {
    expect(provider.serverTimestamp()).toEqual({ sentinel: 'serverTimestamp' })
  })
})

// ── Addressing ────────────────────────────────────────────────────────────────
describe('paths', () => {
  // A third of this app's writes are not under organizations/: the QR mirrors,
  // orgIndex, users, and LOTO's top-level collections.
  it('addresses a top-level collection as readily as a nested one', async () => {
    await provider.get('qr', 'token123')
    expect(fs.getDoc).toHaveBeenCalledWith({ path: 'qr/token123', id: 'token123' })
  })

  it('tolerates stray slashes rather than building a broken ref', async () => {
    await provider.list('/organizations/org1/incidents/')
    expect(fs.getDocs.mock.calls[0][0]).toEqual({ path: INCIDENTS })
  })
})

// ── Filters ───────────────────────────────────────────────────────────────────
describe('query options', () => {
  it('applies where, then order, then limit', async () => {
    await provider.list(INCIDENTS, {
      where: [{ field: 'deletedAt', op: '==', value: null }, { field: 'type', op: '==', value: 'ABC' }],
      orderBy: ['createdAt', 'desc'],
      limit: 50,
    })
    expect(fs.getDocs.mock.calls[0][0].constraints).toEqual([
      { c: 'where', field: 'deletedAt', op: '==', value: null },
      { c: 'where', field: 'type', op: '==', value: 'ABC' },
      { c: 'orderBy', field: 'createdAt', dir: 'desc' },
      { c: 'limit', n: 50 },
    ])
  })

  it('passes an `in` filter through as one constraint, chunking left to the caller', async () => {
    // documents/lib/readScope.js already emits this descriptor and does its own
    // 30-value chunking, because splitting is the only correct answer — capping
    // would drop documents with nothing on screen to say so.
    await provider.list('organizations/org1/documents', {
      where: [{ field: 'siteId', op: 'in', value: ['s1', 's2'] }],
    })
    expect(fs.getDocs.mock.calls[0][0].constraints).toEqual([
      { c: 'where', field: 'siteId', op: 'in', value: ['s1', 's2'] },
    ])
  })

  it('defaults an orderBy with no direction to ascending', async () => {
    await provider.list(INCIDENTS, { orderBy: ['name'] })
    expect(fs.getDocs.mock.calls[0][0].constraints).toEqual([{ c: 'orderBy', field: 'name', dir: 'asc' }])
  })
})

// ── Single documents ──────────────────────────────────────────────────────────
describe('reading one document', () => {
  it('returns the row with its id', async () => {
    fs.getDoc.mockResolvedValue(docSnap('i1', { title: 'Spill' }))
    expect(await provider.get(INCIDENTS, 'i1')).toEqual({ id: 'i1', title: 'Spill' })
  })

  // Absence is a normal answer. Only a refusal or a dead connection is an error,
  // and the two have to stay tellable apart.
  it('returns null for a document that is not there, and rejects for one refused', async () => {
    fs.getDoc.mockResolvedValue(docSnap('i1', null))
    expect(await provider.get(INCIDENTS, 'i1')).toBeNull()

    fs.getDoc.mockRejectedValue(denied())
    await expect(provider.get(INCIDENTS, 'i1')).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('subscribes to one document, reporting deletion as null', () => {
    const cb = vi.fn()
    const onError = vi.fn()
    const stop = vi.fn()
    fs.onSnapshot.mockReturnValue(stop)

    expect(provider.subscribeDoc('organizations/org1/meta', 'stats', cb, onError)).toBe(stop)
    expect(fs.onSnapshot.mock.calls[0][0]).toEqual({ path: 'organizations/org1/meta/stats', id: 'stats' })

    const [, next, err] = fs.onSnapshot.mock.calls[0]
    next(docSnap('stats', { total: 4 }))
    expect(cb).toHaveBeenCalledWith({ id: 'stats', total: 4 })
    next(docSnap('stats', null))
    expect(cb).toHaveBeenLastCalledWith(null)
    expect(err).toBe(onError)
  })
})

// ── Counting ──────────────────────────────────────────────────────────────────
describe('count', () => {
  it('uses the server aggregate rather than reading the documents', async () => {
    fs.getCountFromServer.mockResolvedValue({ data: () => ({ count: 4123 }) })
    expect(await provider.count(INCIDENTS)).toBe(4123)
    expect(fs.getDocs).not.toHaveBeenCalled()
  })

  it('counts a filtered query', async () => {
    await provider.count('users', { where: [{ field: 'orgId', op: '==', value: 'org1' }] })
    expect(fs.getCountFromServer.mock.calls[0][0]).toEqual({
      path: 'users',
      constraints: [{ c: 'where', field: 'orgId', op: '==', value: 'org1' }],
    })
  })

  // Reporting a refused count as 0 would put a confident, wrong number on a
  // dashboard. Callers that would rather omit the stat catch it themselves.
  it('rejects rather than reporting zero when the read is refused', async () => {
    fs.getCountFromServer.mockRejectedValue(denied())
    await expect(provider.count(INCIDENTS)).rejects.toMatchObject({ code: 'permission-denied' })
  })
})

// ── Client-minted ids ─────────────────────────────────────────────────────────
describe('newId', () => {
  it('mints a fresh id with no I/O, usable as the id of the write that follows', async () => {
    const id = provider.newId(INCIDENTS)
    expect(typeof id).toBe('string')
    expect(id).not.toBe(provider.newId(INCIDENTS))
    // Nothing was asked of the network to get it — the id has to exist BEFORE
    // the write, so a QR mirror in the same batch can name the document.
    expect(fs.getDoc).not.toHaveBeenCalled()
    expect(fs.addDoc).not.toHaveBeenCalled()

    await provider.set(INCIDENTS, id, { title: 'x' })
    expect(fs.setDoc.mock.calls[0][0]).toEqual({ path: `${INCIDENTS}/${id}`, id })
  })
})

// ── set / update ──────────────────────────────────────────────────────────────
describe('set', () => {
  it('replaces wholesale by default and merges only when asked', async () => {
    await provider.set(INCIDENTS, 'i1', { a: 1 })
    expect(fs.setDoc.mock.calls[0]).toEqual([{ path: `${INCIDENTS}/i1`, id: 'i1' }, { a: 1 }])

    await provider.set(INCIDENTS, 'i1', { a: 1 }, { merge: true })
    expect(fs.setDoc.mock.calls[1]).toEqual([{ path: `${INCIDENTS}/i1`, id: 'i1' }, { a: 1 }, { merge: true }])

    // merge:false is the same write as no options at all, and must send the
    // same two-argument call every existing call site sends.
    await provider.set(INCIDENTS, 'i1', { a: 1 }, { merge: false })
    expect(fs.setDoc.mock.calls[2]).toHaveLength(2)
  })
})

describe('update', () => {
  it('carries dotted field paths through untouched', async () => {
    await provider.update('organizations/org1/meta', 'stats', { 'byStatus.active': 3 })
    expect(fs.updateDoc.mock.calls[0][1]).toEqual({ 'byStatus.active': 3 })
  })

  // incidents' bumpStats seeds its stats document off the back of this
  // rejection, and the seed drops nextSeq first so a merge cannot rewind the
  // reference-number counter. An adapter that upserted would break that
  // silently — the counter would go backwards and reprint an issued number.
  it('rejects on a missing document instead of creating one', async () => {
    fs.updateDoc.mockRejectedValue(Object.assign(new Error('No document to update'), { code: 'not-found' }))
    await expect(provider.update(INCIDENTS, 'gone', { a: 1 })).rejects.toMatchObject({ code: 'not-found' })
    expect(fs.setDoc).not.toHaveBeenCalled()
  })
})

// ── Exclusive create ──────────────────────────────────────────────────────────
// The fire defect lock is what stops the same fault being reported twice. It is
// a create that fails when the document exists — enforced by a rule granting
// create and nothing else — never a read followed by a write.
describe('createExclusive', () => {
  it('is a single write, never a read-then-write', async () => {
    await provider.createExclusive('organizations/org1/defectLocks', 'ext1__empty', {
      extId: 'ext1', defectType: 'empty', token: 'tok',
    })
    expect(fs.getDoc).not.toHaveBeenCalled()
    expect(fs.getDocs).not.toHaveBeenCalled()
    expect(fs.setDoc).toHaveBeenCalledTimes(1)
    // Two arguments: no merge, so an existing document is not partially updated
    // on a backend where the rule ever failed to apply.
    expect(fs.setDoc.mock.calls[0]).toHaveLength(2)
  })

  it('rethrows the collision verbatim, code intact', async () => {
    // On Firestore a collision on a create-only path comes back as
    // permission-denied, so callers cannot pattern-match on 'already-exists'.
    fs.setDoc.mockRejectedValue(denied())
    await expect(provider.createExclusive('organizations/org1/defectLocks', 'l1', {}))
      .rejects.toMatchObject({ code: 'permission-denied' })
  })
})

// ── Batches ───────────────────────────────────────────────────────────────────
describe('batch', () => {
  const makeBatch = () => {
    const b = { set: vi.fn(), update: vi.fn(), delete: vi.fn(), commit: vi.fn(async () => {}) }
    fs.writeBatch.mockReturnValue(b)
    return b
  }

  it('queues every kind of op on ONE underlying batch and commits once', async () => {
    const b = makeBatch()
    const batch = provider.batch()
    batch.set(INCIDENTS, 'i1', { a: 1 })
    batch.set(INCIDENTS, 'i2', { a: 2 }, { merge: true })
    batch.update(INCIDENTS, 'i3', { a: 3 })
    batch.remove(INCIDENTS, 'i4')
    batch.createExclusive('organizations/org1/defectLocks', 'l1', { extId: 'e' })
    await batch.commit()

    expect(fs.writeBatch).toHaveBeenCalledTimes(1)
    expect(b.set.mock.calls[0]).toEqual([{ path: `${INCIDENTS}/i1`, id: 'i1' }, { a: 1 }])
    expect(b.set.mock.calls[1]).toEqual([{ path: `${INCIDENTS}/i2`, id: 'i2' }, { a: 2 }, { merge: true }])
    expect(b.update).toHaveBeenCalledWith({ path: `${INCIDENTS}/i3`, id: 'i3' }, { a: 3 })
    expect(b.delete).toHaveBeenCalledWith({ path: `${INCIDENTS}/i4`, id: 'i4' })
    expect(b.set.mock.calls[2]).toEqual([{ path: 'organizations/org1/defectLocks/l1', id: 'l1' }, { extId: 'e' }])
    expect(b.commit).toHaveBeenCalledTimes(1)
  })

  // The defect lock and the report it guards go in together. Nothing may slip
  // between them, which means one batch and one commit — never a lock write
  // that lands while the report it was protecting fails, or the reverse.
  it('puts a colliding exclusive create and its companion write in the same commit', async () => {
    const b = makeBatch()
    b.commit.mockRejectedValue(denied())

    const batch = provider.batch()
    batch.createExclusive('organizations/org1/defectLocks', 'ext1__empty', { extId: 'ext1' })
    batch.set('organizations/org1/reports', 'r1', { extId: 'ext1', kind: 'defect' })
    await expect(batch.commit()).rejects.toMatchObject({ code: 'permission-denied' })

    // Both ops on one batch, one commit: the report cannot land without the
    // lock. (That the backend then applies neither is Firestore's guarantee —
    // provable only against a real driver, not a mock.)
    expect(fs.writeBatch).toHaveBeenCalledTimes(1)
    expect(b.set).toHaveBeenCalledTimes(2)
    expect(b.commit).toHaveBeenCalledTimes(1)
    expect(fs.setDoc).not.toHaveBeenCalled()
  })

  it('does not write anything before commit', () => {
    const b = makeBatch()
    const batch = provider.batch()
    batch.set(INCIDENTS, 'i1', { a: 1 })
    batch.remove(INCIDENTS, 'i2')
    expect(b.commit).not.toHaveBeenCalled()
    expect(fs.setDoc).not.toHaveBeenCalled()
    expect(fs.deleteDoc).not.toHaveBeenCalled()
  })
})

// ── Transactions ──────────────────────────────────────────────────────────────
describe('runTransaction', () => {
  const runReal = (tx) => fs.runTransaction.mockImplementation((_db, fn) => fn(tx))

  it('reads rows and stages writes through the same tx', async () => {
    const tx = {
      get: vi.fn(async () => docSnap('p1', { status: 'approved' })),
      set: vi.fn(),
      update: vi.fn(),
    }
    runReal(tx)

    const seen = await provider.runTransaction(async (t) => {
      const row = await t.get('procedures', 'p1')
      t.update('procedures', 'p1', { status: 'locked' })
      t.set('procedureQr', 'p1', { procedureId: 'p1' }, { merge: true })
      return row
    })

    expect(seen).toEqual({ id: 'p1', status: 'approved' })
    expect(tx.get).toHaveBeenCalledWith({ path: 'procedures/p1', id: 'p1' })
    expect(tx.update).toHaveBeenCalledWith({ path: 'procedures/p1', id: 'p1' }, { status: 'locked' })
    expect(tx.set.mock.calls[0]).toEqual([
      { path: 'procedureQr/p1', id: 'p1' }, { procedureId: 'p1' }, { merge: true },
    ])
  })

  it('reports a missing document as null rather than throwing', async () => {
    runReal({ get: vi.fn(async () => docSnap('p1', null)), set: vi.fn(), update: vi.fn() })
    expect(await provider.runTransaction(async (t) => t.get('procedures', 'p1'))).toBeNull()
  })

  // LOTO throws its lockout rules from inside the transaction — "remove all
  // group-lock technicians first" — and expects nothing written when it does.
  it('propagates a throw from the body with nothing staged after it', async () => {
    const tx = { get: vi.fn(async () => docSnap('p1', {})), set: vi.fn(), update: vi.fn() }
    runReal(tx)

    await expect(provider.runTransaction(async (t) => {
      await t.get('procedures', 'p1')
      throw new Error('Remove all group-lock technicians before removing the primary lock')
    })).rejects.toThrow(/group-lock technicians/)

    expect(tx.set).not.toHaveBeenCalled()
    expect(tx.update).not.toHaveBeenCalled()
  })

  // Firestore rejects a transaction body that does not return a Promise. The
  // adapter's own wrapper settles that, so it never depends on each caller
  // having remembered to write `async`.
  it('always hands the SDK a promise, whatever the body returns', async () => {
    fs.runTransaction.mockImplementation(() => {})
    provider.runTransaction(() => 'a synchronous value')

    const wrapper = fs.runTransaction.mock.calls[0][1]
    const returned = wrapper({ get: vi.fn(), set: vi.fn(), update: vi.fn() })
    expect(returned).toBeInstanceOf(Promise)
    expect(await returned).toBe('a synchronous value')
  })
})

// ── Sentinels ─────────────────────────────────────────────────────────────────
describe('sentinels', () => {
  it('hands back opaque values for the write payload', () => {
    expect(provider.increment(-1)).toEqual({ sentinel: 'increment', n: -1 })
    expect(provider.arrayUnion('a', 'b')).toEqual({ sentinel: 'arrayUnion', values: ['a', 'b'] })
  })

  it('survives being nested in a dotted-path update, which is how stats are kept', async () => {
    await provider.update('organizations/org1/meta', 'stats', {
      'byStatus.active': provider.increment(1),
      updatedAt: provider.serverTimestamp(),
    })
    expect(fs.updateDoc.mock.calls[0][1]['byStatus.active']).toEqual({ sentinel: 'increment', n: 1 })
  })
})

// ── Error classification ──────────────────────────────────────────────────────
// One predicate, two codes, because Firestore cannot separate them: a
// create-only rule turns a duplicate defect report into permission-denied. A
// caller that matched only 'already-exists' would report every duplicate as a
// system fault; one that matched only 'permission-denied' would call a genuine
// refusal a duplicate — which is exactly the bug that once hid a rule refusing
// every report for a day.
describe('isWriteRefused', () => {
  it('is true for a refusal and for a collision', () => {
    expect(provider.isWriteRefused({ code: 'permission-denied' })).toBe(true)
    expect(provider.isWriteRefused({ code: 'already-exists' })).toBe(true)
  })

  it('is false for anything that is not the backend refusing the write', () => {
    // A dropped connection is not an authorisation failure and must never be
    // dressed up as a duplicate.
    for (const code of ['unavailable', 'not-found', 'deadline-exceeded', 'aborted', undefined]) {
      expect(provider.isWriteRefused({ code })).toBe(false)
    }
    expect(provider.isWriteRefused(new Error('offline'))).toBe(false)
    expect(provider.isWriteRefused(null)).toBe(false)
    expect(provider.isWriteRefused(undefined)).toBe(false)
  })
})

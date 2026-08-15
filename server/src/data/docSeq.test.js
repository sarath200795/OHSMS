import { describe, it, expect } from 'vitest'
import { reserveDocId, SEQ_COLLECTION } from './docSeq.js'

// A transaction the size of what this module actually uses: getAll and set.
// Real enough to prove the ORDER (every read before the one write) and the
// exact document written, which is what the rule pins — and small enough that
// the assertions read as the rule does.
function fakeStore(documents = {}) {
  const writes = []
  const reads = []

  const refFor = (path) => ({
    path,
    collection: (name) => ({ doc: (id) => refFor(`${path}/${name}/${id}`) }),
  })

  const db = { collection: (name) => ({ doc: (id) => refFor(`${name}/${id}`) }) }

  const tx = {
    getAll: async (...refs) => {
      if (writes.length) throw new Error('read after write: Firestore refuses this transaction')
      refs.forEach((r) => reads.push(r.path))
      return refs.map((r) => ({
        exists: Object.hasOwn(documents, r.path),
        data: () => documents[r.path],
      }))
    },
    set: (ref, data) => writes.push({ path: ref.path, data }),
  }

  return { db, tx, writes, reads }
}

const ORG = 'organizations/orgA'
const SEQ = `${ORG}/${SEQ_COLLECTION}/inspections`

describe('reserving an id', () => {
  it('starts at one for an org that has never reserved', async () => {
    const { db, tx, writes } = fakeStore({ [ORG]: { name: 'Acme Corporation' } })

    expect(await reserveDocId(tx, db, { orgId: 'orgA', kind: 'inspections' })).toBe('INSP-ACME_0001')
    expect(writes).toEqual([{ path: SEQ, data: { n: 1 } }])
  })

  it('continues from the stored counter', async () => {
    const { db, tx, writes } = fakeStore({ [ORG]: { docCode: 'WEHS' }, [SEQ]: { n: 41 } })

    expect(await reserveDocId(tx, db, { orgId: 'orgA', kind: 'inspections' })).toBe('INSP-WEHS_0042')
    expect(writes[0].data).toEqual({ n: 42 })
  })

  // hasOnly(['n']) — the rule pins the key set, so the write is a full replace
  // and not a merge. A counter carrying anything else would be refused by the
  // rule the day a client writes it directly, which during the migration is
  // every module that has not moved yet.
  it('writes exactly { n } and nothing beside it', async () => {
    const { db, tx, writes } = fakeStore({ [ORG]: {}, [SEQ]: { n: 3, updatedBy: 'someone' } })

    await reserveDocId(tx, db, { orgId: 'orgA', kind: 'inspections' })
    expect(Object.keys(writes[0].data)).toEqual(['n'])
  })

  // Firestore requires every read in a transaction to precede every write. The
  // fake enforces it, so a future edit that reads after the counter write fails
  // here rather than at the emulator.
  it('does every read before it writes', async () => {
    const { db, tx, reads } = fakeStore({ [ORG]: {} })

    await reserveDocId(tx, db, { orgId: 'orgA', kind: 'inspections' })
    expect(reads).toEqual([ORG, SEQ, `${ORG}/meta/docSeq`])
  })
})

describe('monotonicity', () => {
  // `n > resource.data.n` — STRICTLY greater (firestore.rules:917). An equal
  // write is refused outright, because a replayed write that re-issued a number
  // already printed on a document is the failure the counter exists to prevent.
  it('always advances', async () => {
    const { db, tx, writes } = fakeStore({ [ORG]: {}, [SEQ]: { n: 42 } })

    await reserveDocId(tx, db, { orgId: 'orgA', kind: 'inspections' })
    expect(writes[0].data.n).toBeGreaterThan(42)
  })

  // A counter written by hand, or corrupted, must not be able to rewind the
  // sequence by reading as zero.
  const JUNK = [{ n: 'twelve' }, { n: null }, { n: -5 }, {}, { n: 1.5 }]

  JUNK.forEach((stored) => {
    it(`does not go backwards from a stored ${JSON.stringify(stored)}`, async () => {
      const { db, tx, writes } = fakeStore({ [ORG]: {}, [SEQ]: stored })

      await reserveDocId(tx, db, { orgId: 'orgA', kind: 'inspections' })
      expect(Number.isInteger(writes[0].data.n)).toBe(true)
      expect(writes[0].data.n).toBeGreaterThanOrEqual(1)
    })
  })

  it('respects a floor, so a backfill can continue past what it numbered', async () => {
    const { db, tx, writes } = fakeStore({ [ORG]: {}, [SEQ]: { n: 2 } })

    await reserveDocId(tx, db, { orgId: 'orgA', kind: 'inspections', floor: 90 })
    expect(writes[0].data).toEqual({ n: 91 })
  })
})

describe('the pre-split counter', () => {
  // The old shape was one document with a field per kind, which rules could not
  // secure — they cannot compare a dynamically-named field, so any approved
  // member could set it backwards. Reading it as a floor is what migrates an
  // existing org on first use, with no script and no downtime.
  it('is read as a floor so an existing org does not restart at one', async () => {
    const { db, tx, writes } = fakeStore({ [ORG]: {}, [`${ORG}/meta/docSeq`]: { inspections: 17, incidents: 300 } })

    expect(await reserveDocId(tx, db, { orgId: 'orgA', kind: 'inspections' })).toContain('_0018')
    expect(writes[0].data).toEqual({ n: 18 })
  })

  it('never lets another kind\'s counter decide this one', async () => {
    const { db, tx, writes } = fakeStore({ [ORG]: {}, [`${ORG}/meta/docSeq`]: { incidents: 300 } })

    await reserveDocId(tx, db, { orgId: 'orgA', kind: 'inspections' })
    expect(writes[0].data).toEqual({ n: 1 })
  })

  it('loses to the per-kind counter once that has moved past it', async () => {
    const { db, tx, writes } = fakeStore({
      [ORG]: {},
      [SEQ]: { n: 50 },
      [`${ORG}/meta/docSeq`]: { inspections: 17 },
    })

    await reserveDocId(tx, db, { orgId: 'orgA', kind: 'inspections' })
    expect(writes[0].data).toEqual({ n: 51 })
  })
})

describe('the org code', () => {
  // Deriving rather than refusing means an org that predates the scheme gets
  // sensible ids without an admin having to do anything first.
  it('comes from docCode, and is derived from the name when it has never been set', async () => {
    const set = fakeStore({ [ORG]: { docCode: 'wehs', name: 'Acme' } })
    expect(await reserveDocId(set.tx, set.db, { orgId: 'orgA', kind: 'inspections' })).toBe('INSP-WEHS_0001')

    const derived = fakeStore({ [ORG]: { name: 'Acme Corporation Pvt Ltd' } })
    expect(await reserveDocId(derived.tx, derived.db, { orgId: 'orgA', kind: 'inspections' })).toBe('INSP-ACME_0001')

    // Nothing at all still produces a well-formed, unique id rather than a
    // failed submit — the id is what the record is quoted by, not a decision.
    const nothing = fakeStore({})
    expect(await reserveDocId(nothing.tx, nothing.db, { orgId: 'orgA', kind: 'inspections' })).toBe('INSP-ORG_0001')
  })

  // Nothing is cached, unlike the client. A Cloud Run instance lives for hours
  // and serves EVERY tenant, so a cached code keeps printing a stale reference
  // on real documents long after an admin corrected it — across all of them.
  it('is re-read for every reservation', async () => {
    const first = fakeStore({ [ORG]: { docCode: 'OLD' } })
    expect(await reserveDocId(first.tx, first.db, { orgId: 'orgA', kind: 'inspections' })).toContain('OLD')

    const second = fakeStore({ [ORG]: { docCode: 'NEW' } })
    expect(await reserveDocId(second.tx, second.db, { orgId: 'orgA', kind: 'inspections' })).toContain('NEW')
  })
})

describe('what it refuses to do', () => {
  it('will not reserve without an org and a kind', async () => {
    const { db, tx } = fakeStore({})
    await expect(reserveDocId(tx, db, { kind: 'inspections' })).rejects.toThrow(/orgId and a kind/)
    await expect(reserveDocId(tx, db, { orgId: 'orgA' })).rejects.toThrow(/orgId and a kind/)
  })
})

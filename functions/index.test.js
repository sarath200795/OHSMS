import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { logger } from 'firebase-functions'
import * as functions from './index.js'
import { purgeOrgCollection } from './index.js'
import { PURGEABLE } from './lib/retention.js'
import { ACTION_COLLECTIONS } from './lib/notify.js'

// ── Stand-ins ────────────────────────────────────────────────────────────────
// Both fakes append to one shared `log`, because the thing that went wrong here
// was an ORDER: the pointer document was destroyed while the object it named
// stayed in the bucket.

function makeDb(seed = {}) {
  const store = new Map(Object.entries(seed))
  const log = []

  const snapOf = (path) => ({ id: path.split('/').pop(), data: () => store.get(path), ref: docRef(path) })

  // where() and limit() are accepted and ignored. The query is only a filter —
  // planPurge is the guarantee, and it is what decides here as it does in
  // production. retention.test.js is where the selection itself is tested.
  const query = (prefix) => ({
    where: () => query(prefix),
    limit: () => query(prefix),
    doc: (id) => docRef(`${prefix}/${id}`),
    async get() {
      const docs = [...store.keys()]
        .filter((k) => k.startsWith(`${prefix}/`) && !k.slice(prefix.length + 1).includes('/'))
        .map(snapOf)
      return { docs, size: docs.length, empty: !docs.length }
    },
  })

  const docRef = (path) => ({
    path,
    collection: (name) => query(`${path}/${name}`),
    async delete() {
      log.push(`doc:${path}`)
      store.delete(path)
    },
  })

  return { collection: (name) => query(name), store, log }
}

const fakeBucket = (log, { fails = () => false } = {}) => {
  const deleted = []
  const options = []
  return {
    deleted,
    options,
    file: (name) => ({
      async delete(opts) {
        options.push(opts)
        if (fails(name)) throw Object.assign(new Error('storage unavailable'), { code: 503 })
        deleted.push(name)
        log.push(`file:${name}`)
      },
    }),
  }
}

const NOW = Date.parse('2026-08-14T00:00:00.000Z')
const daysAgo = (n) => new Date(NOW - n * 24 * 60 * 60 * 1000)
const specFor = (collection) => PURGEABLE.find((p) => p.collection === collection)

const illnessWithFile = (over = {}) => ({
  'organizations/orgA/illnesses/i1': { refNo: 'ILL-1', deletedAt: daysAgo(40) },
  'organizations/orgA/illnesses/i1/files/f1': { name: 'report.pdf', path: 'orgs/orgA/illness-files/f1.pdf' },
  ...over,
})

// ─────────────────────────────────────────────────────────────────────────────

describe('purging a record whose attachments live in Cloud Storage', () => {
  beforeEach(() => {
    vi.spyOn(logger, 'error').mockImplementation(() => {})
    vi.spyOn(logger, 'info').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  // The pointer document is the only record of where the object is. Destroying
  // it first leaves retained occupational-health data in the bucket that nobody
  // can find, produce or erase.
  it('deletes the stored object before the pointer document that names it', async () => {
    const db = makeDb(illnessWithFile())
    const bucket = fakeBucket(db.log)

    const res = await purgeOrgCollection(db, 'orgA', specFor('illnesses'), NOW, bucket)

    expect(bucket.deleted).toEqual(['orgs/orgA/illness-files/f1.pdf'])
    expect(db.log).toEqual([
      'file:orgs/orgA/illness-files/f1.pdf',
      'doc:organizations/orgA/illnesses/i1/files/f1',
      'doc:organizations/orgA/illnesses/i1',
    ])
    expect(res).toEqual({ purged: 1, kept: 0, files: 1 })
    expect(db.store.size).toBe(0)
  })

  // An object deleted by hand, or by an earlier half-finished run, is the
  // expected state of a retry — not a failure to report.
  it('asks Storage to treat an object that has already gone as done', async () => {
    const db = makeDb(illnessWithFile())
    const bucket = fakeBucket(db.log)
    await purgeOrgCollection(db, 'orgA', specFor('illnesses'), NOW, bucket)
    expect(bucket.options).toEqual([{ ignoreNotFound: true }])
  })

  // A file too small to be worth an object is stored as base64 on the pointer
  // itself, so there is nothing in the bucket to chase.
  it('leaves Storage alone for an attachment that was inlined', async () => {
    const db = makeDb(
      illnessWithFile({
        'organizations/orgA/illnesses/i1/files/f1': { name: 'note.txt', path: '', dataUrl: 'data:text/plain;base64,AAA' },
      })
    )
    const bucket = fakeBucket(db.log)

    const res = await purgeOrgCollection(db, 'orgA', specFor('illnesses'), NOW, bucket)

    expect(bucket.deleted).toEqual([])
    expect(res.files).toBe(0)
    expect(db.store.size).toBe(0)
  })

  // A bucket having a bad minute must not save a record that is 30 days past
  // the retention window the screen promised.
  it('finishes the purge, and the run, when Storage refuses a delete', async () => {
    const db = makeDb({
      ...illnessWithFile(),
      'organizations/orgA/illnesses/i2': { refNo: 'ILL-2', deletedAt: daysAgo(45) },
      'organizations/orgA/illnesses/i2/files/f2': { path: 'orgs/orgA/illness-files/f2.pdf' },
    })
    const bucket = fakeBucket(db.log, { fails: (name) => name.endsWith('f1.pdf') })

    const res = await purgeOrgCollection(db, 'orgA', specFor('illnesses'), NOW, bucket)

    expect(res).toEqual({ purged: 2, kept: 0, files: 1 })
    expect(db.store.size).toBe(0)
    // And the object nobody could delete is named, because it is now the only
    // trace of a file the database no longer knows about.
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringMatching(/storage/),
      expect.objectContaining({ path: 'orgs/orgA/illness-files/f1.pdf', collection: 'illnesses', orgId: 'orgA' })
    )
  })

  it('touches nothing belonging to a record still inside its window', async () => {
    const db = makeDb({
      'organizations/orgA/illnesses/i1': { refNo: 'ILL-1', deletedAt: daysAgo(3) },
      'organizations/orgA/illnesses/i1/files/f1': { path: 'orgs/orgA/illness-files/f1.pdf' },
    })
    const bucket = fakeBucket(db.log)

    expect(await purgeOrgCollection(db, 'orgA', specFor('illnesses'), NOW, bucket)).toEqual({
      purged: 0,
      kept: 1,
      files: 0,
    })
    expect(bucket.deleted).toEqual([])
    expect(db.log).toEqual([])
  })

  it('still cascades the public QR mirror of an asset that has no files', async () => {
    const db = makeDb({
      'organizations/orgA/extinguishers/e1': { serialNo: 'FE-1', qrToken: 'tok9', deletedAt: daysAgo(40) },
      'qr/tok9': { orgId: 'orgA' },
    })
    const bucket = fakeBucket(db.log)

    const res = await purgeOrgCollection(db, 'orgA', specFor('extinguishers'), NOW, bucket)

    expect(res).toEqual({ purged: 1, kept: 0, files: 0 })
    expect(db.store.has('qr/tok9')).toBe(false)
    expect(bucket.deleted).toEqual([])
  })
})

describe('the deployed function list', () => {
  const watched = () =>
    Object.values(functions)
      .map((f) => f?.__endpoint?.eventTrigger?.eventFilterPathPatterns?.document)
      .filter(Boolean)

  // A collection listed in ACTION_SOURCES with no trigger here is silent: no
  // assignment mail, ever, and nobody finds out. Four of them were.
  it('watches every collection that carries corrective actions', () => {
    for (const collection of ACTION_COLLECTIONS) {
      expect(watched(), collection).toContain(`organizations/{orgId}/${collection}/{docId}`)
    }
  })

  // The other half of the same rule: a trigger on a collection notify.js does
  // not know about would read every write of it and decide nothing.
  it('watches nothing else', () => {
    expect(watched()).toHaveLength(ACTION_COLLECTIONS.length + 1) // + users/{uid}
    expect(watched()).toContain('users/{uid}')
  })
})

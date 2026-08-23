import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { logger } from 'firebase-functions'
import { FieldValue } from 'firebase-admin/firestore'
import { purgeOrgCollection, moveMedicalRecords, assertPathSegment } from './index.js'
import { PURGEABLE } from './lib/retention.js'
import { planMedicalRecordMove } from './lib/medicalRecords.js'

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
    // The purge reads a QR mirror before deleting it, to prove the mirror
    // belongs to the org being purged. /qr is shared by every tenant.
    async get() {
      const data = store.get(path)
      return { exists: data !== undefined, data: () => data }
    },
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
    expect(res).toEqual({ purged: 1, kept: 0, files: 1, problems: [] })
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

    expect(res).toMatchObject({ purged: 2, kept: 0, files: 1 })
    expect(db.store.size).toBe(0)
    // And the object nobody could delete is named, because it is now the only
    // trace of a file the database no longer knows about.
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringMatching(/storage/),
      expect.objectContaining({ path: 'orgs/orgA/illness-files/f1.pdf', collection: 'illnesses', orgId: 'orgA' })
    )
    // Naming it in the log is not enough — a log nobody reads is how this ran
    // broken for months. It has to come back to the caller so the invocation
    // can be failed, which is the part something actually alerts on.
    expect(res.problems).toEqual([
      { kind: 'file-left-behind', docId: 'i1', path: 'orgs/orgA/illness-files/f1.pdf' },
    ])
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
      problems: [],
    })
    expect(bucket.deleted).toEqual([])
    expect(db.log).toEqual([])
  })

  // The sweep runs with Admin SDK privileges that never consult storage.rules,
  // and the fields it follows are written by clients. Both of these were live:
  // a plain member could name any object in the bucket, or any tenant's QR
  // token, and have the nightly job destroy it on their behalf.
  it('refuses a file path outside the org being purged', async () => {
    const db = makeDb({
      'organizations/orgA/incidents/i1': { deletedAt: daysAgo(40) },
      'organizations/orgA/incidents/i1/photos/p1': { path: 'orgs/orgB/incidents/victim.jpg' },
    })
    const bucket = fakeBucket(db.log)
    await purgeOrgCollection(db, 'orgA', specFor('incidents'), NOW, bucket)
    expect(bucket.deleted).toEqual([])
    // The record still goes; only the foreign file is spared.
    expect(db.store.has('organizations/orgA/incidents/i1')).toBe(false)
  })

  it('refuses a path that climbs out of the org prefix', async () => {
    const db = makeDb({
      'organizations/orgA/incidents/i1': { deletedAt: daysAgo(40) },
      'organizations/orgA/incidents/i1/photos/p1': { path: 'orgs/orgA/../orgB/secret.jpg' },
    })
    const bucket = fakeBucket(db.log)
    await purgeOrgCollection(db, 'orgA', specFor('incidents'), NOW, bucket)
    expect(bucket.deleted).toEqual([])
  })

  it('refuses a QR mirror belonging to another tenant', async () => {
    const db = makeDb({
      'organizations/orgA/extinguishers/e1': { qrToken: 'tokVictim', deletedAt: daysAgo(40) },
      'qr/tokVictim': { orgId: 'orgB' },
    })
    await purgeOrgCollection(db, 'orgA', specFor('extinguishers'), NOW, fakeBucket(db.log))
    expect(db.store.has('qr/tokVictim')).toBe(true)
  })

  it('still deletes a QR mirror that does belong to this org', async () => {
    const db = makeDb({
      'organizations/orgA/extinguishers/e1': { qrToken: 'tokMine', deletedAt: daysAgo(40) },
      'qr/tokMine': { orgId: 'orgA' },
    })
    await purgeOrgCollection(db, 'orgA', specFor('extinguishers'), NOW, fakeBucket(db.log))
    expect(db.store.has('qr/tokMine')).toBe(false)
  })

  it('still cascades the public QR mirror of an asset that has no files', async () => {
    const db = makeDb({
      'organizations/orgA/extinguishers/e1': { serialNo: 'FE-1', qrToken: 'tok9', deletedAt: daysAgo(40) },
      'qr/tok9': { orgId: 'orgA' },
    })
    const bucket = fakeBucket(db.log)

    const res = await purgeOrgCollection(db, 'orgA', specFor('extinguishers'), NOW, bucket)

    expect(res).toEqual({ purged: 1, kept: 0, files: 0, problems: [] })
    expect(db.store.has('qr/tok9')).toBe(false)
    expect(bucket.deleted).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Moving medical records out of the shared photo subcollection.
//
// Same shape of fake and the same reason for it: what is being tested is an
// ORDER. Nothing may be destroyed until the new copy has been read back out of
// Firestore, because a crash in the middle has to leave the record findable in
// both places rather than neither. Losing a medical record is worse than the
// exposure being closed.

/** A db whose every operation lands in one shared, ordered log. */
function makeMoveDb(seed = {}, { corrupts = () => false } = {}) {
  const store = new Map(Object.entries(seed))
  const log = []
  const updates = []

  const doc = (path) => ({
    async set(data) {
      log.push(`write:${path}`)
      store.set(path, data)
    },
    async get() {
      log.push(`read:${path}`)
      const data = store.get(path)
      // A write that reports success and stores something else is the case the
      // read-back exists for — a rules refusal, a wrong path, a bad minute.
      return {
        exists: data !== undefined,
        data: () => (corrupts(path) ? { ...data, path: 'somewhere-else' } : data),
      }
    },
    async update(patch) {
      log.push(`update:${path}`)
      updates.push({ path, patch })
      store.set(path, { ...store.get(path), ...patch })
    },
    async delete() {
      log.push(`doc:${path}`)
      store.delete(path)
    },
  })

  return { doc, store, log, updates }
}

/** A bucket that can copy, re-stamp metadata and delete, in the same log. */
function fakeStore(log, present = [], { failsCopy = () => false, failsMeta = () => false } = {}) {
  const objects = new Set(present)
  const options = []
  return {
    objects,
    options,
    file: (name) => ({
      name,
      async exists() { return [objects.has(name)] },
      async copy(dest) {
        if (failsCopy(name)) throw Object.assign(new Error('storage unavailable'), { code: 503 })
        log.push(`copy:${name}>${dest.name}`)
        objects.add(dest.name)
      },
      async setMetadata(meta) {
        if (failsMeta(name)) throw new Error('metadata refused')
        log.push(`meta:${name}:${JSON.stringify(meta)}`)
      },
      async delete(opts) {
        options.push(opts)
        log.push(`file:${name}`)
        objects.delete(name)
      },
    }),
  }
}

const OLD_PATH = 'orgs/orgA/incident-photos/deadbeef-discharge.pdf'
const NEW_PATH = 'orgs/orgA/medical-records/deadbeef-discharge.pdf'
const RECORD = 'organizations/orgA/injuries/inc1__u1/records/p1'
const POINTER = 'organizations/orgA/incidents/inc1/photos/p1'

const record = (over = {}) => ({
  id: 'p1',
  name: 'discharge.pdf',
  kind: 'medical_record',
  path: OLD_PATH,
  url: 'https://firebasestorage.googleapis.com/v0/b/x/o/f?alt=media&token=abc',
  size: 4096,
  uploadedAt: { seconds: 1 },
  ...over,
})

const movesFor = (photos, injuries = new Map([['inc1__u1', {}]])) =>
  planMedicalRecordMove(
    [{ id: 'inc1', refNo: 'INC-001', injuryReports: [{ personId: 'u1' }], photos }],
    injuries,
    'orgA',
  ).moves

describe('moving a medical record out of the photo album', () => {
  beforeEach(() => {
    vi.spyOn(logger, 'error').mockImplementation(() => {})
    vi.spyOn(logger, 'info').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  // The whole safety property, in one assertion. Bytes first, then the pointer,
  // then the proof, and only then the two deletions — the old OBJECT before the
  // old POINTER, so a crash between them can never strand a medical file in the
  // bucket with nothing left in the database naming it.
  it('copies, writes, verifies, and only then deletes — object before pointer', async () => {
    const db = makeMoveDb({ [POINTER]: record(), 'organizations/orgA/incidents/inc1': { photoCount: 3 } })
    const store = fakeStore(db.log, [OLD_PATH])

    const res = await moveMedicalRecords(db, store, 'orgA', movesFor([record()]))

    expect(db.log).toEqual([
      `copy:${OLD_PATH}>${NEW_PATH}`,
      `meta:${NEW_PATH}:{"metadata":{"firebaseStorageDownloadTokens":null}}`,
      `write:${RECORD}`,
      `read:${RECORD}`,
      `file:${OLD_PATH}`,
      `doc:${POINTER}`,
      'update:organizations/orgA/incidents/inc1',
    ])
    expect(res).toMatchObject({ moved: 1, filesMoved: 1, tokensLeft: 0, failed: [] })
    expect(store.objects.has(NEW_PATH)).toBe(true)
    expect(store.objects.has(OLD_PATH)).toBe(false)
  })

  // The url is what made the pointer dangerous: a permanent bearer link that no
  // rule is ever consulted for.
  it('lands the record without the download URL that came with it', async () => {
    const db = makeMoveDb({ [POINTER]: record() })
    await moveMedicalRecords(db, fakeStore(db.log, [OLD_PATH]), 'orgA', movesFor([record()]))

    const landed = db.store.get(RECORD)
    expect('url' in landed).toBe(false)
    expect('kind' in landed).toBe(false)
    expect(landed.path).toBe(NEW_PATH)
    expect(landed.personId).toBe('u1')
    expect(landed.incidentId).toBe('inc1')
  })

  // The one that matters most. A write that did not land the way it was asked to
  // must not be allowed to license a delete.
  it('destroys nothing when the new record does not read back intact', async () => {
    const db = makeMoveDb({ [POINTER]: record() }, { corrupts: (p) => p === RECORD })
    const store = fakeStore(db.log, [OLD_PATH])

    const res = await moveMedicalRecords(db, store, 'orgA', movesFor([record()]))

    expect(res.moved).toBe(0)
    expect(res.failed).toEqual([
      { incidentId: 'inc1', refNo: 'INC-001', photoId: 'p1', error: 'the moved record did not read back intact' },
    ])
    // Reachable exactly where it always was: pointer and file both untouched.
    expect(db.store.has(POINTER)).toBe(true)
    expect(store.objects.has(OLD_PATH)).toBe(true)
    expect(db.log).not.toContain(`doc:${POINTER}`)
    expect(db.log).not.toContain(`file:${OLD_PATH}`)
  })

  // A crash between the copy and the pointer delete leaves the file confined and
  // the old pointer standing. The next run must finish that, not start a second
  // copy of somebody's discharge summary.
  it('finishes an interrupted run without copying or duplicating anything', async () => {
    const db = makeMoveDb({ [POINTER]: record() })
    const store = fakeStore(db.log, [NEW_PATH])

    const res = await moveMedicalRecords(db, store, 'orgA', movesFor([record()]))

    expect(db.log.some((l) => l.startsWith('copy:'))).toBe(false)
    expect(res.moved).toBe(1)
    // One record, at the id it has always had — the source document id is the
    // destination document id precisely so a retry cannot fork it.
    expect([...db.store.keys()].filter((k) => k.includes('/records/'))).toEqual([RECORD])
    expect(db.store.has(POINTER)).toBe(false)
  })

  // Under MAX_INLINE_BYTES with no bucket configured, the file is base64 on the
  // pointer itself. There is nothing to copy, and the document IS the record.
  it('moves an inlined record without touching Storage', async () => {
    const inline = record({ path: '', url: '', dataUrl: 'data:application/pdf;base64,AAA' })
    const db = makeMoveDb({ [POINTER]: inline })
    const store = fakeStore(db.log)

    const res = await moveMedicalRecords(db, store, 'orgA', movesFor([inline]))

    expect(res).toMatchObject({ moved: 1, filesMoved: 0 })
    expect(db.log.filter((l) => l.startsWith('copy:') || l.startsWith('file:'))).toEqual([])
    expect(db.store.get(RECORD).dataUrl).toBe('data:application/pdf;base64,AAA')
  })

  // An object already gone is the expected state of a retry, not a failure.
  it('asks Storage to treat an object that has already gone as done', async () => {
    const db = makeMoveDb({ [POINTER]: record() })
    const store = fakeStore(db.log, [OLD_PATH])
    await moveMedicalRecords(db, store, 'orgA', movesFor([record()]))
    expect(store.options).toEqual([{ ignoreNotFound: true }])
  })

  // A record whose file is in neither place means somebody has been deleting
  // objects out from under the database. It is reported, and its pointer is left
  // exactly where it is rather than moved as though the file had come along.
  it('reports a record whose file is in neither place, and keeps its pointer', async () => {
    const db = makeMoveDb({ [POINTER]: record() })
    const store = fakeStore(db.log)

    const res = await moveMedicalRecords(db, store, 'orgA', movesFor([record()]))

    expect(res.moved).toBe(0)
    expect(res.failed[0].error).toMatch(/neither place/)
    expect(db.store.has(POINTER)).toBe(true)
  })

  // The token is unused — no URL has ever been minted for the new path — so
  // failing the move over it would leave a readable record in the photo album to
  // protect a door in a room nobody has been shown.
  it('confines the file even when the download token cannot be stripped', async () => {
    const db = makeMoveDb({ [POINTER]: record() })
    const store = fakeStore(db.log, [OLD_PATH], { failsMeta: () => true })

    const res = await moveMedicalRecords(db, store, 'orgA', movesFor([record()]))

    expect(res).toMatchObject({ moved: 1, tokensLeft: 1 })
    expect(db.store.has(POINTER)).toBe(false)
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringMatching(/download token/),
      expect.objectContaining({ orgId: 'orgA', recordId: 'p1' }),
    )
  })

  // One bad record must not leave forty confinable ones exposed.
  it('keeps going after a record it cannot move', async () => {
    const two = [record(), record({ id: 'p2', path: 'orgs/orgA/incident-photos/beef-note.pdf' })]
    const db = makeMoveDb({
      [POINTER]: two[0],
      'organizations/orgA/incidents/inc1/photos/p2': two[1],
    })
    const store = fakeStore(db.log, [OLD_PATH, 'orgs/orgA/incident-photos/beef-note.pdf'], {
      failsCopy: (n) => n.endsWith('discharge.pdf'),
    })

    const res = await moveMedicalRecords(db, store, 'orgA', movesFor(two))

    expect(res.moved).toBe(1)
    expect(res.failed).toHaveLength(1)
    expect(db.store.has(POINTER)).toBe(true)
    expect(db.store.has('organizations/orgA/incidents/inc1/photos/p2')).toBe(false)
  })

  // subscribeMedicalRecords orders by uploadedAt, and Firestore drops documents
  // missing the ordered field: a record moved without one would be confined onto
  // no screen at all.
  it('stamps a timestamp on a legacy pointer that never had one', async () => {
    const old = record({ uploadedAt: undefined })
    const db = makeMoveDb({ [POINTER]: old })
    await moveMedicalRecords(db, fakeStore(db.log, [OLD_PATH]), 'orgA', movesFor([old]))
    expect(db.store.get(RECORD).uploadedAt).toBeDefined()
  })

  // photoCount is maintained by the add and delete paths on both sides, so a
  // migration that removes pointers without it leaves a counter that no longer
  // counts anything. Once per incident, not once per record.
  it('corrects the incident photo count once, for all of its records', async () => {
    const two = [record(), record({ id: 'p2', path: 'orgs/orgA/incident-photos/beef-note.pdf' })]
    const db = makeMoveDb({
      'organizations/orgA/incidents/inc1': { photoCount: 5 },
      [POINTER]: two[0],
      'organizations/orgA/incidents/inc1/photos/p2': two[1],
    })

    await moveMedicalRecords(db, fakeStore(db.log, [OLD_PATH, 'orgs/orgA/incident-photos/beef-note.pdf']), 'orgA', movesFor(two))

    expect(db.updates).toEqual([
      { path: 'organizations/orgA/incidents/inc1', patch: { photoCount: FieldValue.increment(-2) } },
    ])
    // And it is the last thing that happens, after every record has moved.
    expect(db.log.at(-1)).toBe('update:organizations/orgA/incidents/inc1')
  })
})

// ── Path segments ──────────────────────────────────────────────────
// exportSubjectData takes a uid from the caller and builds `users/{uid}` from
// it. A slash inside that value silently addresses a different document, so
// the tenancy check made about the uid stops describing what the queries then
// read. Read-only, and the org comparison still contains it — but the id no
// longer names the person the permission was granted for.
describe('validating a caller-supplied path segment', () => {
  it('accepts an ordinary Firebase uid', () => {
    expect(() => assertPathSegment('7bQ2xKmLp0Xf3nYc', 'uid')).not.toThrow()
  })

  it('rejects a value carrying a slash, which would re-target the document', () => {
    expect(() => assertPathSegment('abc/sub/def', 'uid')).toThrow(/not a usable id/)
  })

  it('rejects the traversal segments', () => {
    expect(() => assertPathSegment('.', 'uid')).toThrow()
    expect(() => assertPathSegment('..', 'uid')).toThrow()
  })

  it('rejects the reserved __name__ shape', () => {
    expect(() => assertPathSegment('__name__', 'uid')).toThrow()
  })

  // A control character renders as nothing in a log, so the two ids below
  // would be indistinguishable to anyone investigating afterwards.
  it('rejects control characters', () => {
    expect(() => assertPathSegment('nul\u0000id', 'uid')).toThrow()
    expect(() => assertPathSegment('tab\u0009id', 'uid')).toThrow()
  })

  it('rejects an empty or non-string value', () => {
    expect(() => assertPathSegment('', 'uid')).toThrow()
    expect(() => assertPathSegment(null, 'uid')).toThrow()
    expect(() => assertPathSegment(42, 'uid')).toThrow()
  })

  it('rejects a segment over the 1500-byte limit', () => {
    expect(() => assertPathSegment('a'.repeat(1501), 'uid')).toThrow()
  })

  it('names the field it rejected, so the caller can tell uid from personId', () => {
    expect(() => assertPathSegment('a/b', 'personId')).toThrow(/personId/)
  })
})

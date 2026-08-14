import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createMailer, MailError } from './email.js'
import {
  ACTION_COLLECTIONS,
  LEDGER_COLLECTION,
  RETRY_WINDOW_MS,
  addDays,
  appConfigFromEnv,
  dayIn,
  digestItems,
  eventAge,
  isRetryable,
  ledgerId,
  mailConfigFromEnv,
  onActionWrite,
  openActionsOf,
  orgScope,
  orgUsers,
  planAssignmentMail,
  runDailyDigest,
  sendOnce,
} from './notify.js'

// ── A Firestore stand-in ─────────────────────────────────────────────────────
// Flat path → data, which makes "did this write land in the collection the
// trigger watches?" a question a test can actually ask.

const matches = (filter, data) => {
  const v = data?.[filter.field]
  if (v === undefined) return false // Firestore skips documents missing the field
  if (filter.op === '==') return v === filter.value
  if (filter.op === '<') return v < filter.value
  if (filter.op === '<=') return v <= filter.value
  throw new Error(`fake db: unsupported operator ${filter.op}`)
}

function makeDb(seed = {}) {
  const store = new Map(Object.entries(seed))
  const stats = { reads: 0, writes: 0 }

  const snapOf = (path) => ({ id: path.split('/').pop(), exists: store.has(path), data: () => store.get(path) })

  const query = (prefix, filters = [], cap = Infinity) => ({
    where: (field, op, value) => query(prefix, [...filters, { field, op, value }], cap),
    limit: (n) => query(prefix, filters, n),
    doc: (id) => docRef(`${prefix}/${id}`),
    async get() {
      stats.reads += 1
      const docs = [...store.keys()]
        .filter((k) => k.startsWith(`${prefix}/`) && !k.slice(prefix.length + 1).includes('/'))
        .map(snapOf)
        .filter((d) => filters.every((f) => matches(f, d.data())))
        .slice(0, cap)
      return { docs, size: docs.length, empty: !docs.length }
    },
  })

  const docRef = (path) => ({
    path,
    collection: (name) => query(`${path}/${name}`),
    async get() {
      stats.reads += 1
      return snapOf(path)
    },
    async create(data) {
      if (store.has(path)) {
        const err = new Error(`Document already exists: ${path}`)
        err.code = 6
        throw err
      }
      stats.writes += 1
      store.set(path, { ...data })
    },
    async update(patch) {
      stats.writes += 1
      store.set(path, { ...store.get(path), ...patch })
    },
    async delete() {
      stats.writes += 1
      store.delete(path)
    },
  })

  return { collection: (name) => query(name), store, stats }
}

const fakeMailer = (onSend) => {
  const sent = []
  return {
    sent,
    provider: 'fake',
    async send(message) {
      sent.push(message)
      if (onSend) return onSend(message, sent.length)
      return `id-${sent.length}`
    },
  }
}

const NOW = new Date('2026-08-11T09:00:00Z')

const user = (uid, over = {}) => ({
  [`users/${uid}`]: { name: uid, email: `${uid}@acme.test`, orgId: 'orgA', role: 'member', status: 'approved', ...over },
})

const writeEvent = ({ orgId = 'orgA', docId = 'inc1', before = null, after = {}, time = NOW.toISOString() } = {}) => ({
  params: { orgId, docId },
  time,
  data: { before: { data: () => before }, after: { data: () => after } },
})

const capaFor = (uid) => ({ capa: [{ id: 'c1', description: 'Fix the guard', dueDate: '2026-08-20', assignees: [{ uid }] }] })

// An audit as InternalAudit.jsx writes it: the finding names nobody and dates
// itself with `auditeeDueDate`, and the responsible person is on the parent.
const auditDoc = (over = {}) => ({
  docId: 'IAF-14023',
  status: 'Reported',
  auditor: 'Meera Nair',
  taskDetails: { auditee: 'Ravi Kumar', dept: 'Maintenance' },
  findings: [{ id: 'AF-1', type: 'Major NC', desc: 'Machine guard missing', clause: '8.1', auditeeDueDate: '2026-08-01' }],
  ...over,
})

/** The same db, but one organization's user read fails — a whole-tenant fault. */
const usersUnreadableIn = (db, orgId) => ({
  ...db,
  collection: (name) => {
    const q = db.collection(name)
    if (name !== 'users') return q
    return {
      ...q,
      where: (field, op, value) =>
        value === orgId
          ? { ...q, get: async () => { throw new Error('firestore unavailable') } }
          : q.where(field, op, value),
    }
  },
})

// ─────────────────────────────────────────────────────────────────────────────

describe('orgScope', () => {
  it('refuses to exist without an organization', () => {
    const db = makeDb()
    expect(() => orgScope(db, '')).toThrow(/without an organization/)
    expect(() => orgScope(db, null)).toThrow(/without an organization/)
    expect(() => orgScope(db, '   ')).toThrow(/without an organization/)
  })

  // The users collection is top-level, so the path cannot do the scoping and a
  // filter has to. This is the query resolveRecipient() ultimately eats.
  it('filters the top-level users collection to one org', async () => {
    const db = makeDb({ ...user('u1'), ...user('u2', { orgId: 'orgB' }) })
    const snap = await orgScope(db, 'orgA').users().get()
    expect(snap.docs.map((d) => d.id)).toEqual(['u1'])
  })

  it('roots every other read under the organization document', () => {
    const db = makeDb()
    const scope = orgScope(db, 'orgA')
    expect(scope.doc('incidents', 'x').path).toBe('organizations/orgA/incidents/x')
    expect(scope.org().path).toBe('organizations/orgA')
  })
})

describe('orgUsers', () => {
  it('takes the uid from the document id, which is where it lives', () => {
    expect(orgUsers('orgA', [{ id: 'u1', data: () => ({ orgId: 'orgA', name: 'Ravi' }) }])).toEqual([
      { uid: 'u1', orgId: 'orgA', name: 'Ravi' },
    ])
  })

  // The attacker payload for this file: a pool that was NOT scoped by the query.
  // resolveRecipient has no org filter of its own, so if this passes anything
  // through, one tenant's mail reaches another's staff.
  it('drops a foreign-org user even when handed one directly', () => {
    const pool = [
      { uid: 'u1', orgId: 'orgA', email: 'a@x.test', status: 'approved' },
      { uid: 'u2', orgId: 'orgB', email: 'b@x.test', status: 'approved' },
      { uid: 'u3', email: 'c@x.test', status: 'approved' },
      { uid: 'u4', orgId: null, email: 'd@x.test', status: 'approved' },
    ]
    expect(orgUsers('orgA', pool).map((u) => u.uid)).toEqual(['u1'])
  })

  it('refuses to build a pool without an org at all', () => {
    expect(() => orgUsers('', [{ uid: 'u1' }])).toThrow(/without an organization/)
  })
})

describe('planAssignmentMail', () => {
  const base = { collection: 'incidents', before: null, orgId: 'orgA', orgName: 'Acme', now: NOW }

  it('addresses the assignee', () => {
    const out = planAssignmentMail({
      ...base,
      after: capaFor('u1'),
      users: [{ uid: 'u1', orgId: 'orgA', email: 'r@acme.test', name: 'Ravi', status: 'approved' }],
    })
    expect(out).toHaveLength(1)
    expect(out[0].to.email).toBe('r@acme.test')
    expect(out[0].subject).toContain('Fix the guard')
  })

  // The leak this whole file is shaped to prevent: the uid on the row is real,
  // the person is real, and they belong to somebody else's tenant.
  it('sends nothing when the assigned uid belongs to another org', () => {
    const out = planAssignmentMail({
      ...base,
      after: capaFor('u9'),
      users: [{ uid: 'u9', orgId: 'orgB', email: 'other@rival.test', name: 'Ravi', status: 'approved' }],
    })
    expect(out).toEqual([])
  })

  // Free-text owners are matched by name. A name that is unique in the WRONG
  // org must not become a unique match here.
  it('sends nothing when a free-text owner only matches someone in another org', () => {
    const out = planAssignmentMail({
      ...base,
      after: { capa: [{ id: 'c1', description: 'Fix', owner: 'Ravi Kumar' }] },
      users: [{ uid: 'u9', orgId: 'orgB', email: 'ravi@rival.test', name: 'Ravi Kumar', status: 'approved' }],
    })
    expect(out).toEqual([])
  })

  it('says nothing about someone recipients.js refused to identify', () => {
    const out = planAssignmentMail({
      ...base,
      after: { capa: [{ id: 'c1', description: 'Fix', owner: 'Ravi' }] },
      users: [
        { uid: 'u1', orgId: 'orgA', email: 'r1@acme.test', name: 'Ravi', status: 'approved' },
        { uid: 'u2', orgId: 'orgA', email: 'r2@acme.test', name: 'Ravi', status: 'approved' },
      ],
    })
    expect(out).toEqual([])
  })

  it('skips a user who is not approved or has turned notifications off', () => {
    const pending = planAssignmentMail({
      ...base,
      after: capaFor('u1'),
      users: [{ uid: 'u1', orgId: 'orgA', email: 'r@acme.test', status: 'pending' }],
    })
    const muted = planAssignmentMail({
      ...base,
      after: capaFor('u1'),
      users: [{ uid: 'u1', orgId: 'orgA', email: 'r@acme.test', status: 'approved', notificationsEnabled: false }],
    })
    expect(pending).toEqual([])
    expect(muted).toEqual([])
  })
})

describe('sendOnce', () => {
  let db
  let scope
  const message = (over = {}) => ({
    kind: 'actionAssigned',
    key: ['actionAssigned', 'incidents', 'inc1', 'c1', 'u1'],
    to: { uid: 'u1', email: 'r@acme.test', name: 'Ravi' },
    subject: 'Action assigned to you: Fix the guard',
    text: 'body',
    html: '<p>body</p>',
    ...over,
  })

  beforeEach(() => {
    db = makeDb()
    scope = orgScope(db, 'orgA')
  })

  it('sends the first time and refuses the second', async () => {
    const mailer = fakeMailer()
    expect(await sendOnce(scope, mailer, message(), { now: NOW })).toMatchObject({ status: 'sent' })
    expect(await sendOnce(scope, mailer, message(), { now: NOW })).toEqual({ status: 'duplicate' })
    expect(mailer.sent).toHaveLength(1)
  })

  // Two deliveries of the same event racing each other is the ordinary case for
  // a Firestore trigger, not the exotic one.
  it('sends once when two deliveries race', async () => {
    const mailer = fakeMailer()
    const results = await Promise.all([
      sendOnce(scope, mailer, message(), { now: NOW }),
      sendOnce(scope, mailer, message(), { now: NOW }),
    ])
    expect(mailer.sent).toHaveLength(1)
    expect(results.filter((r) => r.status === 'sent')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'duplicate')).toHaveLength(1)
  })

  // The loop guard. This record must not land anywhere a trigger is watching.
  it('records the send under the org, in a collection nothing triggers on', async () => {
    await sendOnce(scope, fakeMailer(), message(), { now: NOW })
    const paths = [...db.store.keys()]
    expect(paths).toHaveLength(1)
    expect(paths[0].startsWith(`organizations/orgA/${LEDGER_COLLECTION}/`)).toBe(true)
    for (const collection of ACTION_COLLECTIONS) {
      expect(paths[0]).not.toContain(`/${collection}/`)
    }
  })

  it('releases its claim and rethrows when the provider is having a moment', async () => {
    const down = fakeMailer(() => {
      throw new MailError('down', { status: 503, retryable: true })
    })
    await expect(sendOnce(scope, down, message(), { now: NOW })).rejects.toThrow(MailError)
    // Nothing left behind, so the retry is free to try again.
    expect([...db.store.keys()]).toHaveLength(0)

    const ok = fakeMailer()
    expect(await sendOnce(scope, ok, message(), { now: NOW })).toMatchObject({ status: 'sent' })
  })

  // A bad address is bad forever. Retrying it is how a sending domain gets
  // blocked, so the claim stays put and the caller is not asked to retry.
  it('keeps its claim and stays quiet when the address is rejected', async () => {
    const log = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
    const bad = fakeMailer(() => {
      throw new MailError('no such recipient', { status: 422, retryable: false })
    })
    expect(await sendOnce(scope, bad, message(), { now: NOW, log })).toEqual({ status: 'refused' })
    const stored = [...db.store.values()][0]
    expect(stored.status).toBe('refused')
    expect(log.error).toHaveBeenCalled()

    // And it is never attempted again.
    const later = fakeMailer()
    expect(await sendOnce(scope, later, message(), { now: NOW, log })).toEqual({ status: 'duplicate' })
    expect(later.sent).toEqual([])
  })

  // The provider has taken the message by this point. Treating a failed
  // bookkeeping write as a failed send released the claim and rethrew, and the
  // retry then delivered a second copy of safety mail already in an inbox.
  it('keeps the claim and reports a send when the ledger write fails afterwards', async () => {
    const log = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
    const mailer = fakeMailer()
    const brokenLedger = {
      ...scope,
      doc: (name, id) => ({ ...scope.doc(name, id), update: async () => { throw new Error('firestore unavailable') } }),
    }

    expect(await sendOnce(brokenLedger, mailer, message(), { now: NOW, log })).toMatchObject({ status: 'sent' })
    expect([...db.store.keys()]).toHaveLength(1)
    expect(log.error).toHaveBeenCalled()

    // And the claim it kept is what stops the retry sending it again.
    const retry = fakeMailer()
    expect(await sendOnce(brokenLedger, retry, message(), { now: NOW, log })).toEqual({ status: 'duplicate' })
    expect(retry.sent).toEqual([])
  })

  it('gives different actions on the same document different keys', () => {
    const a = ledgerId(['actionAssigned', 'incidents', 'inc1', 'c1', 'u1'])
    const b = ledgerId(['actionAssigned', 'incidents', 'inc1', 'c2', 'u1'])
    const c = ledgerId(['actionAssigned', 'incidents', 'inc1', 'c1', 'u2'])
    expect(new Set([a, b, c]).size).toBe(3)
  })

  // Row ids come from five modules and include array indexes and free text; a
  // document id may not contain a slash or look like __foo__.
  it('produces a legal document id from hostile parts', () => {
    const id = ledgerId(['actionAssigned', 'incidents', 'a/b', '__proto__', undefined])
    expect(id).toMatch(/^[0-9a-f]{32}$/)
  })
})

describe('retry policy', () => {
  it('trusts email.js on what is worth retrying', () => {
    expect(isRetryable(new MailError('bad address', { status: 422, retryable: false }))).toBe(false)
    expect(isRetryable(new MailError('down', { status: 503, retryable: true }))).toBe(true)
  })

  it('treats anything else as transient, since the age bound stops it anyway', () => {
    expect(isRetryable(new Error('firestore unavailable'))).toBe(true)
  })

  it('cannot date an event with no usable timestamp, and gives up rather than loop', () => {
    expect(eventAge(undefined, NOW)).toBe(Infinity)
    expect(eventAge('not a date', NOW)).toBe(Infinity)
    expect(eventAge(new Date(NOW.getTime() - 5000).toISOString(), NOW)).toBe(5000)
  })
})

describe('onActionWrite', () => {
  const orgSeed = { 'organizations/orgA': { name: 'Acme' } }

  it('reads nothing when the write assigned nothing', async () => {
    const db = makeDb({ ...orgSeed, ...user('u1') })
    const before = capaFor('u1')
    const after = { capa: [{ ...before.capa[0], dueDate: '2026-09-01' }] }
    await onActionWrite({
      db,
      mailer: fakeMailer(),
      collection: 'incidents',
      event: writeEvent({ before, after }),
      now: NOW,
      log: { info: vi.fn(), error: vi.fn() },
    })
    expect(db.stats.reads).toBe(0)
    expect(db.stats.writes).toBe(0)
  })

  it('does nothing for a deleted document', async () => {
    const db = makeDb({ ...orgSeed, ...user('u1') })
    const mailer = fakeMailer()
    await onActionWrite({
      db,
      mailer,
      collection: 'incidents',
      event: writeEvent({ before: capaFor('u1'), after: null }),
      now: NOW,
      log: { info: vi.fn(), error: vi.fn() },
    })
    expect(mailer.sent).toEqual([])
    expect(db.stats.reads).toBe(0)
  })

  it('mails the assignee once, however many times the event is delivered', async () => {
    const db = makeDb({ ...orgSeed, ...user('u1', { name: 'Ravi' }) })
    const mailer = fakeMailer()
    const event = writeEvent({ after: capaFor('u1') })
    const run = () =>
      onActionWrite({
        db,
        mailer,
        collection: 'incidents',
        event,
        config: { baseUrl: 'https://ohs.acme.test' },
        now: NOW,
        log: { info: vi.fn(), error: vi.fn() },
      })

    expect(await run()).toEqual({ sent: 1, skipped: 0 })
    expect(await run()).toEqual({ sent: 0, skipped: 1 })
    expect(mailer.sent).toHaveLength(1)
    expect(mailer.sent[0].to).toBe('u1@acme.test')
    expect(mailer.sent[0].subject).toContain('Fix the guard')
    expect(mailer.sent[0].text).toContain('https://ohs.acme.test/actions')
  })

  // The cross-tenant case, end to end through the real query path.
  it('never mails a same-named person in another organization', async () => {
    const db = makeDb({
      ...orgSeed,
      'organizations/orgB': { name: 'Rival' },
      ...user('u1', { orgId: 'orgB', name: 'Ravi Kumar', email: 'ravi@rival.test' }),
    })
    const mailer = fakeMailer()
    await onActionWrite({
      db,
      mailer,
      collection: 'incidents',
      event: writeEvent({ after: { capa: [{ id: 'c1', description: 'Fix', owner: 'Ravi Kumar', assignees: [{ uid: 'u1' }] }] } }),
      now: NOW,
      log: { info: vi.fn(), error: vi.fn() },
    })
    expect(mailer.sent).toEqual([])
  })

  it('rethrows a transient failure so the event is retried', async () => {
    const db = makeDb({ ...orgSeed, ...user('u1') })
    const down = fakeMailer(() => {
      throw new MailError('down', { status: 503, retryable: true })
    })
    await expect(
      onActionWrite({
        db,
        mailer: down,
        collection: 'incidents',
        event: writeEvent({ after: capaFor('u1') }),
        now: NOW,
        log: { info: vi.fn(), error: vi.fn() },
      })
    ).rejects.toThrow(MailError)
  })

  // The bound. Past the window the handler returns normally, which acks the
  // event and ends the redelivery — otherwise a provider outage is 24 hours of
  // billed attempts.
  it('stops rethrowing once the event is too old to be worth retrying', async () => {
    const db = makeDb({ ...orgSeed, ...user('u1') })
    const log = { info: vi.fn(), error: vi.fn() }
    const down = fakeMailer(() => {
      throw new MailError('down', { status: 503, retryable: true })
    })
    const old = new Date(NOW.getTime() - RETRY_WINDOW_MS - 1000).toISOString()
    const res = await onActionWrite({
      db,
      mailer: down,
      collection: 'incidents',
      event: writeEvent({ after: capaFor('u1'), time: old }),
      now: NOW,
      log,
    })
    expect(res).toEqual({ sent: 0, skipped: 1 })
    expect(log.error).toHaveBeenCalled()
  })

  it('does not retry an address the provider rejected outright', async () => {
    const db = makeDb({ ...orgSeed, ...user('u1') })
    const log = { info: vi.fn(), error: vi.fn() }
    const bad = fakeMailer(() => {
      throw new MailError('no such recipient', { status: 422, retryable: false })
    })
    const res = await onActionWrite({
      db,
      mailer: bad,
      collection: 'incidents',
      event: writeEvent({ after: capaFor('u1') }),
      now: NOW,
      log,
    })
    expect(res).toEqual({ sent: 0, skipped: 1 })
  })

  // Every field this trigger used to look for is absent from an audit finding,
  // so it resolved nobody and mailed nobody, for every finding ever raised.
  it('mails the auditee an audit finding raised against them', async () => {
    const db = makeDb({ ...orgSeed, ...user('u1', { name: 'Ravi Kumar' }) })
    const mailer = fakeMailer()
    const res = await onActionWrite({
      db,
      mailer,
      collection: 'auditFindings',
      event: writeEvent({ docId: 'af1', after: auditDoc() }),
      now: NOW,
      log: { info: vi.fn(), error: vi.fn() },
    })
    expect(res).toEqual({ sent: 1, skipped: 0 })
    expect(mailer.sent[0].to).toBe('u1@acme.test')
    expect(mailer.sent[0].subject).toContain('Machine guard missing')
  })

  it('logs the assignment it could not address to anyone', async () => {
    const db = makeDb({ ...orgSeed, ...user('u1', { name: 'Ravi' }), ...user('u2', { name: 'Ravi' }) })
    const log = { info: vi.fn(), error: vi.fn() }
    const mailer = fakeMailer()
    await onActionWrite({
      db,
      mailer,
      collection: 'incidents',
      event: writeEvent({ after: { capa: [{ id: 'c1', description: 'Fix', owner: 'Ravi' }] } }),
      now: NOW,
      log,
    })
    expect(mailer.sent).toEqual([])
    expect(log.info).toHaveBeenCalledWith(expect.stringMatching(/no recipient/), expect.objectContaining({ orgId: 'orgA' }))
  })
})

describe('digestItems', () => {
  const at = { today: '2026-08-11', nowIso: '2026-08-11T09:00:00.000Z' }

  it('reports a permit that lapsed without being closed', () => {
    const items = digestItems(
      { permits: [{ docId: 'PTW-1', validTo: '2026-08-10T12:00:00.000Z', storedStatus: 'in_progress' }] },
      at
    )
    expect(items.permits).toHaveLength(1)
  })

  it('ignores a closed permit, and a draft that was never approved', () => {
    const permits = [
      { docId: 'A', validTo: '2026-08-01T00:00:00.000Z', storedStatus: 'closed' },
      { docId: 'B', validTo: '2026-08-01T00:00:00.000Z', storedStatus: 'closed_noncompliance' },
      { docId: 'C', validTo: '2026-08-01T00:00:00.000Z', storedStatus: 'draft' },
      { docId: 'D', validTo: '2026-08-30T00:00:00.000Z', storedStatus: 'in_progress' },
    ]
    expect(digestItems({ permits }, at).permits).toEqual([])
  })

  it('reports training expiring inside the month and renames the fields the template wants', () => {
    const items = digestItems(
      {
        training: [
          { employeeName: 'Ravi', courseName: 'Work at Height', expiresOn: '2026-08-20' },
          { employeeName: 'Priya', courseName: 'LOTO', expiresOn: '2026-12-01' },
          { employeeName: 'Sam', courseName: 'Induction', expiresOn: '' },
        ],
      },
      at
    )
    expect(items.training).toEqual([{ employee: 'Ravi', title: 'Work at Height', expiryDate: '2026-08-20' }])
  })

  it('reports only actions that are past due and still open', () => {
    const items = digestItems(
      {
        actionDocs: [
          { collection: 'incidents', data: { refNo: 'INC-1', capa: [{ id: 'a', description: 'Late', dueDate: '2026-08-01' }] } },
          { collection: 'incidents', data: { refNo: 'INC-2', capa: [{ id: 'b', description: 'Soon', dueDate: '2026-09-01' }] } },
          { collection: 'incidents', data: { refNo: 'INC-3', capa: [{ id: 'c', description: 'Done', dueDate: '2026-08-01', status: 'closed' }] } },
          { collection: 'incidents', data: { refNo: 'INC-4', capa: [{ id: 'd', description: 'Undated' }] } },
        ],
      },
      at
    )
    expect(items.actions.map((a) => a.title)).toEqual(['Late'])
  })

  // Findings date themselves with `auditeeDueDate`. Read as `dueDate` they came
  // out undated, and the past-due filter below then dropped every one of them.
  it('reports an overdue audit finding, which spells both of its fields differently', () => {
    const items = digestItems({ actionDocs: [{ collection: 'auditFindings', data: auditDoc() }] }, at)
    expect(items.actions).toEqual([
      {
        title: 'Major NC: Machine guard missing (clause 8.1)',
        dueDate: '2026-08-01',
        source: 'Audit finding',
        context: 'IAF-14023 · Maintenance',
      },
    ])
  })

  it('leaves the findings of a verified and closed audit out of it', () => {
    const items = digestItems({ actionDocs: [{ collection: 'auditFindings', data: auditDoc({ status: 'Closed' }) }] }, at)
    expect(items.actions).toEqual([])
  })

  // The digest lists work nobody was ever assigned. Those are the rows most
  // worth an admin's morning, so the diff in actionSources.js cannot be reused.
  it('includes an overdue action with no owner at all', () => {
    const items = digestItems(
      { actionDocs: [{ collection: 'incidents', data: { capa: [{ id: 'a', description: 'Orphan', dueDate: '2026-08-01' }] } }] },
      at
    )
    expect(items.actions).toHaveLength(1)
  })
})

describe('openActionsOf', () => {
  it('reads the title from wherever the module happened to put it', () => {
    expect(openActionsOf('mockDrills', { capa: [{ action: 'Clear the exit', due: '2026-08-01' }] })[0]).toMatchObject({
      title: 'Clear the exit',
      dueDate: '2026-08-01',
    })
  })

  it('survives a collection it does not know and a malformed field', () => {
    expect(openActionsOf('permits', { capa: [{ id: 'a' }] })).toEqual([])
    expect(openActionsOf('incidents', { capa: 'nope' })).toEqual([])
    expect(openActionsOf('incidents', null)).toEqual([])
  })
})

describe('dates', () => {
  // Functions run in UTC and the readers do not. Without the timezone the
  // digest's idea of "today" flips at 05:30 local and disagrees with the app.
  it('takes the day from the timezone the digest is written for', () => {
    expect(dayIn('Asia/Kolkata', new Date('2026-08-11T20:00:00Z'))).toBe('2026-08-12')
    expect(dayIn('UTC', new Date('2026-08-11T20:00:00Z'))).toBe('2026-08-11')
  })

  it('shifts days across a month boundary', () => {
    expect(addDays('2026-08-11', 30)).toBe('2026-09-10')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
})

describe('runDailyDigest', () => {
  const twoOrgs = () =>
    makeDb({
      'organizations/orgA': { name: 'Acme' },
      'organizations/orgB': { name: 'Rival' },
      'users/a1': { name: 'A Admin', email: 'a1@acme.test', orgId: 'orgA', role: 'admin', status: 'approved' },
      'users/a2': { name: 'A Member', email: 'a2@acme.test', orgId: 'orgA', role: 'member', status: 'approved' },
      'users/b1': { name: 'B Admin', email: 'b1@rival.test', orgId: 'orgB', role: 'admin', status: 'approved' },
      'organizations/orgA/incidents/i1': { refNo: 'INC-1', capa: [{ id: 'c1', description: 'Acme overdue', dueDate: '2026-08-01' }] },
      'organizations/orgB/incidents/i9': { refNo: 'RIV-9', capa: [{ id: 'c9', description: 'Rival overdue', dueDate: '2026-08-01' }] },
    })

  it('sends each org its own digest, to its own admins', async () => {
    const db = twoOrgs()
    const mailer = fakeMailer()
    await runDailyDigest({ db, mailer, now: NOW, log: { info: vi.fn(), error: vi.fn() } })

    expect(mailer.sent.map((m) => m.to).sort()).toEqual(['a1@acme.test', 'b1@rival.test'])
    const acme = mailer.sent.find((m) => m.to === 'a1@acme.test')
    expect(acme.text).toContain('Acme overdue')
    // The line that would be a cross-tenant leak.
    expect(acme.text).not.toContain('Rival overdue')
  })

  it('says nothing to an organization with nothing outstanding', async () => {
    const db = makeDb({
      'organizations/orgA': { name: 'Acme' },
      'users/a1': { name: 'A', email: 'a1@acme.test', orgId: 'orgA', role: 'admin', status: 'approved' },
      'organizations/orgA/incidents/i1': { refNo: 'INC-1', capa: [{ id: 'c1', description: 'Not due yet', dueDate: '2026-12-01' }] },
    })
    const mailer = fakeMailer()
    await runDailyDigest({ db, mailer, now: NOW, log: { info: vi.fn(), error: vi.fn() } })
    expect(mailer.sent).toEqual([])
  })

  it('sends one digest per day however often the schedule fires', async () => {
    const db = twoOrgs()
    const mailer = fakeMailer()
    const run = () => runDailyDigest({ db, mailer, now: NOW, log: { info: vi.fn(), error: vi.fn() } })
    await run()
    await run()
    expect(mailer.sent).toHaveLength(2)

    // Tomorrow is a new digest.
    await runDailyDigest({ db, mailer, now: new Date('2026-08-12T09:00:00Z'), log: { info: vi.fn(), error: vi.fn() } })
    expect(mailer.sent).toHaveLength(4)
  })

  // The org-level catch is for a whole tenant being unreadable. One address
  // failing is a smaller thing and is handled per recipient, below.
  it('carries on to the next tenant when one fails', async () => {
    const db = twoOrgs()
    const log = { info: vi.fn(), error: vi.fn() }
    const mailer = fakeMailer()
    const res = await runDailyDigest({ db: usersUnreadableIn(db, 'orgA'), mailer, now: NOW, log })
    expect(mailer.sent.map((m) => m.to)).toEqual(['b1@rival.test'])
    expect(res.mailed).toBe(1)
    expect(res.failed).toEqual(['orgA'])
    expect(log.error).toHaveBeenCalled()
  })

  // The schedule runs with no retries, so an admin skipped here loses that
  // day's digest entirely — and before this, so did every admin listed after
  // them in the same organisation.
  it('still mails the second admin when the first one fails', async () => {
    const db = makeDb({
      'organizations/orgA': { name: 'Acme' },
      'users/a1': { name: 'A One', email: 'a1@acme.test', orgId: 'orgA', role: 'admin', status: 'approved' },
      'users/a2': { name: 'A Two', email: 'a2@acme.test', orgId: 'orgA', role: 'admin', status: 'approved' },
      'organizations/orgA/incidents/i1': { refNo: 'INC-1', capa: [{ id: 'c1', description: 'Acme overdue', dueDate: '2026-08-01' }] },
    })
    const log = { info: vi.fn(), error: vi.fn() }
    const flaky = fakeMailer((m) => {
      if (m.to === 'a1@acme.test') throw new MailError('down', { status: 503, retryable: true })
      return 'ok'
    })
    const res = await runDailyDigest({ db, mailer: flaky, now: NOW, log })
    expect(flaky.sent.map((m) => m.to)).toEqual(['a1@acme.test', 'a2@acme.test'])
    expect(res).toMatchObject({ mailed: 1, skipped: 1, failed: [] })
    expect(log.error).toHaveBeenCalledWith(expect.stringMatching(/one recipient/), expect.objectContaining({ uid: 'a1' }))
  })

  it('mails an audit finding the digest could not previously see', async () => {
    const db = makeDb({
      'organizations/orgA': { name: 'Acme' },
      'users/a1': { name: 'A', email: 'a1@acme.test', orgId: 'orgA', role: 'admin', status: 'approved' },
      'organizations/orgA/auditFindings/af1': auditDoc(),
    })
    const mailer = fakeMailer()
    await runDailyDigest({ db, mailer, now: NOW, log: { info: vi.fn(), error: vi.fn() } })
    expect(mailer.sent).toHaveLength(1)
    expect(mailer.sent[0].text).toContain('Major NC: Machine guard missing (clause 8.1)')
  })

  it('skips an org with no reachable admin without paying for the scan', async () => {
    const db = makeDb({
      'organizations/orgA': { name: 'Acme' },
      'users/a1': { name: 'A', email: 'a1@acme.test', orgId: 'orgA', role: 'admin', status: 'pending' },
    })
    const mailer = fakeMailer()
    await runDailyDigest({ db, mailer, now: NOW, log: { info: vi.fn(), error: vi.fn() } })
    expect(mailer.sent).toEqual([])
    // The org list and the user query, and nothing else.
    expect(db.stats.reads).toBe(2)
  })
})

describe('quiet by default', () => {
  // The non-negotiable: deploying this must not start mailing anyone.
  it('selects the console provider when nothing is configured', () => {
    expect(mailConfigFromEnv({}).provider).toBe('console')
    expect(createMailer(mailConfigFromEnv({})).provider).toBe('console')
  })

  it('sends nothing over the network when unconfigured', async () => {
    const fetchSpy = vi.fn()
    global.fetch = fetchSpy
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const mailer = createMailer(mailConfigFromEnv({}))
    await mailer.send({ to: 'x@y.test', subject: 'Hello', text: 'body' })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(info).toHaveBeenCalled()
    info.mockRestore()
  })

  it('still sends nothing when a provider is named but has no key', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(createMailer(mailConfigFromEnv({ MAIL_PROVIDER: 'resend' })).provider).toBe('console')
    vi.restoreAllMocks()
  })

  it('only goes live once both the provider and the key are set', () => {
    expect(createMailer(mailConfigFromEnv({ MAIL_PROVIDER: 'resend', MAIL_API_KEY: 'k' })).provider).toBe('resend')
  })

  it('omits the link button until a base URL is configured', () => {
    expect(appConfigFromEnv({}).baseUrl).toBe('')
    expect(appConfigFromEnv({ APP_BASE_URL: 'https://ohs.acme.test' }).baseUrl).toBe('https://ohs.acme.test')
  })
})

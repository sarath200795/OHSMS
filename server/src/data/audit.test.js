import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FieldValue } from 'firebase-admin/firestore'
import { actorNameOf, writeAuditEntry, AUDIT_COLLECTION } from './audit.js'

// A store that records what was asked of it. The point of these assertions is
// the SHAPE of the write — which method, which path, which fields — because the
// three pinned fields are the whole value of the trail and every one of them is
// a field a route could have been allowed to pass in.
function fakeStore({ fail = null } = {}) {
  const created = []
  const other = []
  let minted = 0

  const docRef = (path) => ({
    path,
    id: path.split('/').pop(),
    collection: (name) => ({
      doc: (id) => docRef(`${path}/${name}/${id ?? `auto${(minted += 1)}`}`),
    }),
    create: async (data) => {
      if (fail) throw fail
      created.push({ path, data })
    },
    set: async (data) => other.push({ op: 'set', path, data }),
    update: async (data) => other.push({ op: 'update', path, data }),
    delete: async () => other.push({ op: 'delete', path }),
  })

  return {
    created,
    other,
    db: { collection: (name) => ({ doc: (id) => docRef(`${name}/${id}`) }) },
  }
}

const caller = (profile) => ({ uid: 'u1', profile, staleClaims: {} })
const ENTRY = { module: 'inspections', action: 'template.create', target: 'template', targetId: 't1' }

let lines
beforeEach(() => {
  lines = []
  vi.spyOn(console, 'log').mockImplementation((l) => lines.push(JSON.parse(l)))
  vi.spyOn(console, 'error').mockImplementation((l) => lines.push(JSON.parse(l)))
})
afterEach(() => vi.restoreAllMocks())

describe('what the server pins', () => {
  it('writes the entry under the org that was written to', async () => {
    const { db, created } = fakeStore()
    await writeAuditEntry(db, { orgId: 'orgA', caller: caller({ name: 'Priya' }), entry: ENTRY })

    expect(created).toHaveLength(1)
    expect(created[0].path).toMatch(new RegExp(`^organizations/orgA/${AUDIT_COLLECTION}/`))
  })

  // actorUid pins WHO and the server clock pins WHEN. Without the timestamp pin
  // a member could file a real entry under their own uid, dated last Tuesday,
  // describing somebody else's action (firestore.rules:664-669).
  it('takes the actor from the verified caller and the time from the server', async () => {
    const { db, created } = fakeStore()
    await writeAuditEntry(db, { orgId: 'orgA', caller: caller({ name: 'Priya' }), entry: ENTRY })

    expect(created[0].data.actorUid).toBe('u1')
    expect(created[0].data.actorName).toBe('Priya')
    expect(created[0].data.at).toEqual(FieldValue.serverTimestamp())
  })

  // The pin cannot be defeated by sending the fields, because there are no such
  // parameters — the moment they become arguments, some later route forwards
  // the caller's own values into them.
  it('has no way for a route to pass an actor or a time at all', async () => {
    const { db, created } = fakeStore()
    await writeAuditEntry(db, {
      orgId: 'orgA',
      caller: caller({ name: 'Priya' }),
      entry: { ...ENTRY, actorUid: 'somebody-else', actorName: 'Priya (Safety Manager)', at: '2020-01-01' },
    })

    expect(created[0].data.actorUid).toBe('u1')
    expect(created[0].data.actorName).toBe('Priya')
    expect(created[0].data.at).toEqual(FieldValue.serverTimestamp())
  })

  // .create(), not .set(). The rule allows create and nothing else, and set()
  // would overwrite an existing entry — an audit trail you can rewrite is a
  // document that says whatever the last person to touch it wanted.
  it('appends with create, and never touches an existing entry', async () => {
    const { db, created, other } = fakeStore()
    await writeAuditEntry(db, { orgId: 'orgA', caller: caller({ name: 'P' }), entry: ENTRY })

    expect(created).toHaveLength(1)
    expect(other).toEqual([])
  })
})

describe('the actor name', () => {
  // A three-way pin, not a strict profile match (firestore.rules:683-689). The
  // looseness is the point: a strict pin would stop recording users with no
  // name SILENTLY, and losing the trail is worse than a soft name.
  const NAMES = [
    ['a name', { name: 'Priya' }, 'Priya'],
    ['no name at all', {}, 'Unknown'],
    ['a blank name', { name: '   ' }, 'Unknown'],
    ['a name that is not a string', { name: 42 }, 'Unknown'],
    ['no profile', null, 'Unknown'],
  ]

  NAMES.forEach(([label, profile, expected]) => {
    it(`records ${label} as ${expected}`, () => {
      expect(actorNameOf(caller(profile))).toBe(expected)
    })
  })

  it('accepts a caller object that is not there at all rather than throwing', () => {
    expect(actorNameOf(undefined)).toBe('Unknown')
  })
})

describe('when the audit write fails', () => {
  // The client's logAudit swallows its own failures so an audit write can never
  // break the action it describes. An inspector on a factory floor must not
  // lose a completed checklist because a log entry would not write.
  it('resolves rather than failing the action it describes', async () => {
    const { db } = fakeStore({ fail: Object.assign(new Error('permission denied'), { code: 7 }) })
    await expect(
      writeAuditEntry(db, { orgId: 'orgA', caller: caller({ name: 'P' }), entry: ENTRY })
    ).resolves.toBeNull()
  })

  it('says so in the log, where it is somebody\'s alert', async () => {
    const { db } = fakeStore({ fail: new Error('backend unavailable') })
    await writeAuditEntry(db, { orgId: 'orgA', caller: caller({ name: 'P' }), entry: ENTRY })

    expect(lines.at(-1)).toMatchObject({
      severity: 'WARNING',
      message: 'audit entry failed',
      action: 'template.create',
      detail: 'backend unavailable',
    })
  })

  // A summary on this system names a person and what happened to them, and a
  // log line outlives the request.
  it('logs nothing of the entry itself', async () => {
    const { db } = fakeStore({ fail: new Error('nope') })
    await writeAuditEntry(db, {
      orgId: 'orgA',
      caller: caller({ name: 'P' }),
      entry: { ...ENTRY, summary: 'Recorded a crush injury to R. Menon', targetLabel: 'R. Menon' },
    })

    expect(JSON.stringify(lines)).not.toContain('Menon')
    expect(JSON.stringify(lines)).not.toContain('crush injury')
  })
})

describe('what it will not write', () => {
  it('does nothing without an org or a verified caller', async () => {
    const { db, created } = fakeStore()
    expect(await writeAuditEntry(db, { orgId: '', caller: caller({}), entry: ENTRY })).toBeNull()
    expect(await writeAuditEntry(db, { orgId: 'orgA', caller: { profile: {} }, entry: ENTRY })).toBeNull()
    expect(created).toEqual([])
  })

  // The rest of the payload is free-form, as the rules leave it — the trail
  // records many shapes (firestore.rules:659-661) — but the defaults keep a
  // half-filled entry from storing undefined, which Firestore refuses outright.
  it('defaults the free-form half rather than storing undefined', async () => {
    const { db, created } = fakeStore()
    await writeAuditEntry(db, {
      orgId: 'orgA',
      caller: caller({ name: 'P' }),
      entry: { module: 'inspections', action: 'record.delete', target: 'record' },
    })

    expect(created[0].data).toMatchObject({ targetId: null, targetLabel: '', summary: '', source: 'api' })
    expect(Object.values(created[0].data)).not.toContain(undefined)
  })

  // During the migration this is how an operator tells whether a module's
  // writes have actually moved: an entry the browser wrote carries no source or
  // 'portal', and one this server wrote carries 'api'.
  it('marks the entry as written by the API', async () => {
    const { db, created } = fakeStore()
    await writeAuditEntry(db, { orgId: 'orgA', caller: caller({ name: 'P' }), entry: ENTRY })
    expect(created[0].data.source).toBe('api')
  })
})

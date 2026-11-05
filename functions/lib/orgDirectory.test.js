import { describe, it, expect } from 'vitest'
import {
  activityTypeOf,
  adminUidsMissingEmail,
  fillAdminEmailsFromAuth,
  listPlatformOrganizationsFor,
  loadPlatformDirectory,
  membershipStatus,
  projectAdmins,
  safeDocId,
  summariseActivity,
  summariseMembers,
  toIso,
  toMillis,
} from './orgDirectory.js'

const NOW = Date.parse('2026-11-04T00:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

function fakeDb(seed = {}, { fail = () => false } = {}) {
  const store = new Map(Object.entries(seed))
  const collections = []
  const docs = []

  function rowsUnder(prefix) {
    const needle = `${prefix}/`
    return [...store.entries()]
      .filter(([path]) => path.startsWith(needle) && !path.slice(needle.length).includes('/'))
      .map(([path, data]) => ({
        id: path.split('/').pop(),
        data: () => data,
      }))
  }

  function apply(prefix, state) {
    let docs = rowsUnder(prefix)
    for (const filter of state.filters) {
      docs = docs.filter((doc) => {
        const left = toMillis(doc.data()?.[filter.field])
        const right = toMillis(filter.value)
        if (filter.op === '>=') return left != null && right != null && left >= right
        return false
      })
    }
    if (state.order) {
      const dir = state.order.dir === 'desc' ? -1 : 1
      docs.sort((a, b) => {
        const av = toMillis(a.data()?.[state.order.field]) ?? -Infinity
        const bv = toMillis(b.data()?.[state.order.field]) ?? -Infinity
        return (av - bv) * dir
      })
    }
    return docs.slice(0, state.limit)
  }

  function query(prefix) {
    const state = { limit: Infinity, filters: [], order: null }
    const q = {
      select() {
        return q
      },
      limit(n) {
        state.limit = n
        return q
      },
      where(field, op, value) {
        state.filters.push({ field, op, value })
        return q
      },
      orderBy(field, dir = 'asc') {
        state.order = { field, dir }
        return q
      },
      count() {
        return {
          async get() {
            if (fail(prefix)) throw new Error(`unavailable:${prefix}`)
            const found = apply(prefix, state)
            return { data: () => ({ count: found.length }) }
          },
        }
      },
      async get() {
        if (fail(prefix)) throw new Error(`unavailable:${prefix}`)
        const found = apply(prefix, state)
        return { docs: found, size: found.length, empty: found.length === 0 }
      },
    }
    return q
  }

  return {
    collections,
    docs,
    collection(name) {
      collections.push(name)
      return query(name)
    },
    doc(path) {
      docs.push(path)
      return {
        async get() {
          if (!store.has(path)) return { exists: false, data: () => undefined }
          return { exists: true, id: path.split('/').pop(), data: () => store.get(path) }
        },
      }
    },
  }
}

const OPERATOR = 'operator-1'

function granted(extra = {}, opts) {
  return fakeDb(
    {
      [`platformAdmins/${OPERATOR}`]: { note: 'platform owner' },
      ...extra,
    },
    opts
  )
}

describe('safeDocId', () => {
  it('accepts a Firestore id and refuses anything that would walk the path', () => {
    expect(safeDocId('orgA')).toBe(true)
    expect(safeDocId('a/b')).toBe(false)
    expect(safeDocId('..')).toBe(false)
    expect(safeDocId('')).toBe(false)
    expect(safeDocId(null)).toBe(false)
  })
})

describe('membership', () => {
  it('counts a missing status as approved — those profiles predate the field', () => {
    const counts = summariseMembers([
      { status: 'approved' },
      { status: '' },
      { status: 'pending' },
      { status: 'suspended' },
      { status: 'rejected' },
    ])
    expect(counts).toEqual({ users: 5, approved: 2, pending: 1, suspended: 1, other: 1 })
    expect(membershipStatus(counts)).toBe('active')
  })

  it('is suspended only when every profile is suspended', () => {
    expect(
      membershipStatus(summariseMembers([{ status: 'suspended' }, { status: 'suspended' }]))
    ).toBe('suspended')
    expect(
      membershipStatus(summariseMembers([{ status: 'suspended' }, { status: 'pending' }]))
    ).toBe('pending')
    expect(membershipStatus(summariseMembers([]))).toBe('none')
    expect(membershipStatus(summariseMembers([{ status: 'rejected' }]))).toBe('inactive')
  })

  it('returns every admin and no other role, without the rest of the profile', () => {
    const admins = projectAdmins([
      {
        uid: 'b',
        role: 'admin',
        name: 'Bea',
        email: 'bea@acme.test',
        status: 'suspended',
        access: { sites: ['s1'] },
        phone: '+910000000000',
      },
      { uid: 'm', role: 'member', name: 'Mo', email: 'mo@acme.test', status: 'approved' },
      { uid: 'a', role: 'admin', name: 'Ada', email: 'ada@acme.test', status: 'approved' },
      { id: 'c', role: 'manager', name: 'Cy', email: 'cy@acme.test', status: 'approved' },
    ])
    expect(admins).toEqual([
      { uid: 'a', name: 'Ada', email: 'ada@acme.test', status: 'approved' },
      { uid: 'b', name: 'Bea', email: 'bea@acme.test', status: 'suspended' },
    ])
  })

  it('keeps a profile email and returns an empty one when the profile has none', () => {
    expect(
      projectAdmins([
        { uid: 'a', role: 'admin', name: 'Ada', email: 'ada@acme.test', status: 'approved' },
        { uid: 'b', role: 'admin', name: 'Bea', status: 'approved' },
        { uid: 'c', role: 'admin', name: 'Cy', email: '   ', status: 'pending' },
        { uid: 'm', role: 'member', name: 'Mo', email: 'mo@acme.test', status: 'approved' },
      ])
    ).toEqual([
      { uid: 'a', name: 'Ada', email: 'ada@acme.test', status: 'approved' },
      { uid: 'b', name: 'Bea', email: '', status: 'approved' },
      { uid: 'c', name: 'Cy', email: '', status: 'pending' },
    ])
  })
})

describe('admin email fallback', () => {
  it('names only admins whose profile email is missing, and never a path-shaped id', () => {
    const members = new Map([
      [
        'orgA',
        [
          { uid: 'ada', role: 'admin', email: 'ada@acme.test' },
          { uid: 'bea', role: 'admin', email: '' },
          { uid: 'mo', role: 'member', email: '' },
          { uid: 'a/b', role: 'admin', email: '' },
        ],
      ],
    ])
    expect(adminUidsMissingEmail(members)).toEqual(['bea'])
  })

  it('leaves the profile untouched when no Auth client is passed', async () => {
    const members = new Map([['orgA', [{ uid: 'bea', role: 'admin', email: '' }]]])
    await fillAdminEmailsFromAuth(members, null)
    expect(members.get('orgA')[0].email).toBe('')
  })
})

describe('activity types', () => {
  it('uses the module the entry was written with, and user changes even under core', () => {
    expect(activityTypeOf({ module: 'incidents', action: 'record.create' })).toBe('incidents')
    expect(activityTypeOf({ module: 'ptw', action: 'permit.approve' })).toBe('ptw')
    expect(activityTypeOf({ module: 'loto', action: 'loto.apply' })).toBe('loto')
    expect(activityTypeOf({ module: 'inspections', action: 'inspection.create' })).toBe(
      'inspections'
    )
    expect(activityTypeOf({ module: 'core', action: 'user.status.update' })).toBe('users')
    expect(activityTypeOf({ action: 'incident.create' })).toBe('incidents')
    expect(activityTypeOf({ module: 'core', action: 'record.create', target: 'permit' })).toBe(
      'ptw'
    )
    expect(activityTypeOf({ module: 'core', action: 'record.create', target: 'observation' })).toBe(
      'observations'
    )
    expect(activityTypeOf({ module: 'not a type!' })).toBe('other')
  })

  it('counts the window it was given, keeps the newest ten, and drops every other field', () => {
    const summary = summariseActivity(
      [
        {
          at: new Date('2026-11-01T00:00:00.000Z'),
          module: 'incidents',
          action: 'incident.create',
          summary: 'Filed a near miss',
          actorName: 'Ada Admin',
          actorUid: 'ada',
          narrative: 'left knee, do not return this',
        },
        {
          at: new Date('2026-11-03T00:00:00.000Z'),
          module: 'core',
          action: 'user.role.update',
          summary: 'Set role → manager',
          actorName: 'Bea',
        },
        {
          at: new Date('2026-11-02T00:00:00.000Z'),
          module: 'loto',
          action: 'loto.apply',
          targetLabel: 'Pump P-2',
          actorName: 'Sam',
        },
        {
          at: new Date('2026-10-01T00:00:00.000Z'),
          module: 'ptw',
          action: 'permit.create',
          summary: 'Hot work',
          actorName: 'Ada',
        },
      ],
      { listLimit: 2 }
    )
    expect(summary.activityTypes).toEqual([
      { type: 'incidents', label: 'Incidents', count: 1 },
      { type: 'loto', label: 'LOTO', count: 1 },
      { type: 'ptw', label: 'Permits', count: 1 },
      { type: 'users', label: 'User changes', count: 1 },
    ])
    expect(summary.recentActivity).toEqual([
      {
        type: 'users',
        label: 'User changes',
        description: 'Set role → manager',
        actor: 'Bea',
        at: '2026-11-03T00:00:00.000Z',
      },
      {
        type: 'loto',
        label: 'LOTO',
        description: 'Loto Apply — Pump P-2',
        actor: 'Sam',
        at: '2026-11-02T00:00:00.000Z',
      },
    ])
    expect(JSON.stringify(summary)).not.toContain('left knee')
    expect(JSON.stringify(summary)).not.toContain('ada')
    expect(summary.activityTruncated).toBe(false)
  })
})

describe('toMillis', () => {
  it('reads a Timestamp-shaped value and refuses a non-date', () => {
    const ms = Date.parse('2024-03-04T05:06:07.000Z')
    expect(toMillis({ toDate: () => new Date(ms) })).toBe(ms)
    expect(toMillis({ seconds: 10 })).toBe(10000)
    expect(toIso(ms)).toBe('2024-03-04T05:06:07.000Z')
    expect(toMillis('not-a-date')).toBe(null)
    expect(toIso(null)).toBe(null)
  })
})

describe('listPlatformOrganizationsFor', () => {
  it('refuses a signed-out caller before reading any collection', async () => {
    const db = fakeDb({ 'organizations/orgA': { name: 'Acme' } })
    await expect(listPlatformOrganizationsFor(db, '')).rejects.toMatchObject({
      code: 'unauthenticated',
    })
    expect(db.collections).toEqual([])
    expect(db.docs).toEqual([])
  })

  it('refuses an account that is not an operator, and does not read tenants', async () => {
    const db = fakeDb({
      'organizations/orgA': { name: 'Acme', address: '1 High Street' },
      'users/member': {
        orgId: 'orgA',
        role: 'admin',
        status: 'approved',
        name: 'Ada Admin',
        email: 'ada@acme.test',
        access: { sites: ['all'] },
      },
    })
    await expect(listPlatformOrganizationsFor(db, 'member')).rejects.toMatchObject({
      code: 'permission-denied',
    })
    expect(db.docs).toEqual(['platformAdmins/member'])
    expect(db.collections).toEqual([])
  })

  it('refuses a uid that is not a single document id, without building a path from it', async () => {
    const db = fakeDb({ 'platformAdmins/a': { note: 'no' } })
    await expect(listPlatformOrganizationsFor(db, 'a/b')).rejects.toMatchObject({
      code: 'permission-denied',
    })
    expect(db.docs).toEqual([])
  })

  it('returns one row per organization, every admin, and the activity already stored', async () => {
    const created = { toDate: () => new Date('2024-01-15T00:00:00.000Z') }
    const db = granted({
      'organizations/orgB': {
        name: 'Beacon Health',
        createdAt: created,
        notificationEmail: 'ops@beacon.test',
      },
      'organizations/orgA': { name: 'acme fitness', createdAt: created, address: 'secret yard' },
      'users/ada': {
        orgId: 'orgA',
        role: 'admin',
        status: 'approved',
        name: 'Ada Admin',
        email: 'Ada@acme.test',
        access: { sites: ['s1'] },
        phone: '+910000000001',
      },
      'users/bea': {
        orgId: 'orgA',
        role: 'admin',
        status: 'suspended',
        name: 'Bea Admin',
        email: 'bea@acme.test',
      },
      'users/mo': {
        orgId: 'orgA',
        role: 'member',
        status: 'pending',
        name: 'Mo Member',
        email: 'mo@acme.test',
      },
      'users/cy': {
        orgId: 'orgA',
        role: 'member',
        status: 'suspended',
        name: 'Cy',
        email: 'cy@acme.test',
      },
      'users/legacy': {
        orgId: 'orgB',
        role: 'admin',
        name: 'Legacy Admin',
        email: 'legacy@beacon.test',
      },
      'users/outsider': {
        role: 'admin',
        name: 'No Org',
        email: 'nope@example.com',
        status: 'approved',
      },
      'organizations/orgA/sites/s1': { name: 'Pitampura' },
      'organizations/orgA/sites/s2': { name: 'Dwarka' },
      'organizations/orgA/sites/s1/notes/n1': { body: 'not a site' },
      'organizations/orgA/auditLogs/old': { at: new Date(NOW - 40 * DAY), action: 'old' },
      'organizations/orgA/auditLogs/mid': { at: new Date(NOW - 10 * DAY), action: 'mid' },
      'organizations/orgA/auditLogs/new': { at: new Date(NOW - 2 * DAY), action: 'new' },
      'organizations/orgB/sites/s1': { name: 'Harbour' },
    })

    const out = await listPlatformOrganizationsFor(db, OPERATOR, { now: NOW, concurrency: 2 })

    expect(Object.keys(out).sort()).toEqual([
      'orgTruncated',
      'partial',
      'recentWindowDays',
      'rows',
      'truncated',
      'userTruncated',
    ])
    expect(out.recentWindowDays).toBe(30)
    expect(out.truncated).toBe(false)
    expect(out.partial).toBe(false)
    expect(out.rows.map((row) => row.name)).toEqual(['acme fitness', 'Beacon Health'])

    const acme = out.rows[0]
    expect(acme).toEqual({
      id: 'orgA',
      name: 'acme fitness',
      status: 'active',
      createdAt: '2024-01-15T00:00:00.000Z',
      lastActivityAt: new Date(NOW - 2 * DAY).toISOString(),
      counts: {
        users: 4,
        approved: 1,
        pending: 1,
        suspended: 2,
        other: 0,
        sites: 2,
        recentRecords: 2,
      },
      activityTypes: [{ type: 'other', label: 'Other', count: 2 }],
      recentActivity: [
        {
          type: 'other',
          label: 'Other',
          description: 'New',
          actor: 'Unknown',
          at: new Date(NOW - 2 * DAY).toISOString(),
        },
        {
          type: 'other',
          label: 'Other',
          description: 'Mid',
          actor: 'Unknown',
          at: new Date(NOW - 10 * DAY).toISOString(),
        },
      ],
      activityTruncated: false,
      admins: [
        { uid: 'ada', name: 'Ada Admin', email: 'Ada@acme.test', status: 'approved' },
        { uid: 'bea', name: 'Bea Admin', email: 'bea@acme.test', status: 'suspended' },
      ],
    })
    expect(JSON.stringify(acme)).not.toContain('secret yard')
    expect(JSON.stringify(acme)).not.toContain('mo@acme.test')
    expect(JSON.stringify(acme)).not.toContain('+910000000001')
    expect(JSON.stringify(acme)).not.toContain('ops@beacon.test')

    const beacon = out.rows[1]
    expect(beacon.status).toBe('active')
    expect(beacon.counts.users).toBe(1)
    expect(beacon.counts.approved).toBe(1)
    expect(beacon.counts.sites).toBe(1)
    expect(beacon.counts.recentRecords).toBe(0)
    expect(beacon.activityTypes).toEqual([])
    expect(beacon.recentActivity).toEqual([])
    expect(beacon.lastActivityAt).toBe(null)
    expect(beacon.admins).toEqual([
      { uid: 'legacy', name: 'Legacy Admin', email: 'legacy@beacon.test', status: null },
    ])
  })

  it('keeps the profile email and does not ask Auth when every admin already has one', async () => {
    const seen = []
    const auth = {
      async getUsers(ids) {
        seen.push(ids)
        return { users: ids.map(({ uid }) => ({ uid, email: 'from-auth@example.com' })) }
      },
    }
    const db = granted({
      'organizations/orgA': { name: 'Acme' },
      'users/ada': {
        orgId: 'orgA',
        role: 'admin',
        status: 'approved',
        name: 'Ada',
        email: 'ada@acme.test',
      },
    })
    const out = await listPlatformOrganizationsFor(db, OPERATOR, { now: NOW, auth })
    expect(out.rows[0].admins).toEqual([
      { uid: 'ada', name: 'Ada', email: 'ada@acme.test', status: 'approved' },
    ])
    expect(seen).toEqual([])
  })

  it('uses the Auth email when the profile has none, and does not look up other roles', async () => {
    const seen = []
    const auth = {
      async getUsers(ids) {
        seen.push(ids.map((id) => id.uid))
        return {
          users: [
            { uid: 'ada', email: '  ada@acme.test  ', phoneNumber: '+910000000099' },
            { uid: 'bea', email: '   ' },
            { uid: 'dee', email: 'dee@acme.test' },
          ],
          notFound: [{ uid: 'cy' }],
        }
      },
    }
    const db = granted({
      'organizations/orgA': { name: 'Acme' },
      'users/ada': { orgId: 'orgA', role: 'admin', status: 'approved', name: 'Ada' },
      'users/bea': { orgId: 'orgA', role: 'admin', status: 'approved', name: 'Bea', email: '' },
      'users/cy': { orgId: 'orgA', role: 'admin', name: 'Cy', email: '   ' },
      'users/dee': {
        orgId: 'orgA',
        role: 'admin',
        status: 'suspended',
        name: 'Dee',
        email: { address: 'not-a-string@acme.test' },
      },
      'users/mo': { orgId: 'orgA', role: 'member', status: 'approved', name: 'Mo' },
    })
    const out = await listPlatformOrganizationsFor(db, OPERATOR, {
      now: NOW,
      auth,
      authEmailBatch: 2,
    })
    expect(seen).toEqual([
      ['ada', 'bea'],
      ['cy', 'dee'],
    ])
    expect(out.rows[0].admins).toEqual([
      { uid: 'ada', name: 'Ada', email: 'ada@acme.test', status: 'approved' },
      { uid: 'bea', name: 'Bea', email: '', status: 'approved' },
      { uid: 'cy', name: 'Cy', email: '', status: null },
      { uid: 'dee', name: 'Dee', email: 'dee@acme.test', status: 'suspended' },
    ])
    const body = JSON.stringify(out)
    expect(body).not.toContain('mo')
    expect(body).not.toContain('+910000000099')
    expect(body).not.toContain('not-a-string')
  })

  it('still returns the directory when an Auth batch fails, and keeps a later batch', async () => {
    let calls = 0
    const auth = {
      async getUsers(ids) {
        calls += 1
        if (calls === 1) throw new Error('auth unavailable')
        return { users: ids.map(({ uid }) => ({ uid, email: `${uid}@acme.test` })) }
      },
    }
    const db = granted({
      'organizations/orgA': { name: 'Acme' },
      'users/ada': {
        orgId: 'orgA',
        role: 'admin',
        status: 'approved',
        name: 'Ada',
        email: 'ada@acme.test',
      },
      'users/bea': { orgId: 'orgA', role: 'admin', status: 'approved', name: 'Bea' },
      'users/cy': { orgId: 'orgA', role: 'admin', status: 'approved', name: 'Cy' },
    })
    const out = await listPlatformOrganizationsFor(db, OPERATOR, {
      now: NOW,
      auth,
      authEmailBatch: 1,
    })
    expect(out.rows[0].status).toBe('active')
    expect(out.rows[0].admins).toEqual([
      { uid: 'ada', name: 'Ada', email: 'ada@acme.test', status: 'approved' },
      { uid: 'bea', name: 'Bea', email: '', status: 'approved' },
      { uid: 'cy', name: 'Cy', email: 'cy@acme.test', status: 'approved' },
    ])
  })

  it('marks an organization suspended only from its user statuses', async () => {
    const db = granted({
      'organizations/quiet': { name: 'Quiet Ltd', createdAt: new Date('2023-05-01T00:00:00.000Z') },
      'users/s1': {
        orgId: 'quiet',
        role: 'admin',
        status: 'suspended',
        name: 'Sam',
        email: 'sam@quiet.test',
      },
      'users/s2': {
        orgId: 'quiet',
        role: 'member',
        status: 'suspended',
        name: 'Jo',
        email: 'jo@quiet.test',
      },
    })
    const out = await listPlatformOrganizationsFor(db, OPERATOR, { now: NOW })
    expect(out.rows[0].status).toBe('suspended')
    expect(out.rows[0].counts.sites).toBe(0)
    expect(out.rows[0].lastActivityAt).toBe(null)
  })

  it('says the list is short when the read hits the cap, and complete when it does not', async () => {
    const db = granted({
      'organizations/a': { name: 'A' },
      'organizations/b': { name: 'B' },
      'users/u1': { orgId: 'a', role: 'admin', status: 'approved', name: 'A', email: 'a@a.test' },
      'users/u2': { orgId: 'b', role: 'admin', status: 'approved', name: 'B', email: 'b@b.test' },
      'users/u3': { orgId: 'a', role: 'member', status: 'approved', name: 'C', email: 'c@a.test' },
    })
    const capped = await loadPlatformDirectory(db, { now: NOW, orgCap: 1, userCap: 2 })
    expect(capped.orgTruncated).toBe(true)
    expect(capped.userTruncated).toBe(true)
    expect(capped.truncated).toBe(true)
    expect(capped.rows).toHaveLength(1)

    const exact = await loadPlatformDirectory(db, { now: NOW, orgCap: 2, userCap: 3 })
    expect(exact.orgTruncated).toBe(false)
    expect(exact.userTruncated).toBe(false)
    expect(exact.rows).toHaveLength(2)
  })

  it('reports a failed activity read as unknown, not as zero', async () => {
    const db = granted(
      {
        'organizations/orgA': { name: 'Acme' },
        'users/ada': {
          orgId: 'orgA',
          role: 'admin',
          status: 'approved',
          name: 'Ada',
          email: 'ada@acme.test',
        },
        'organizations/orgA/sites/s1': { name: 'Yard' },
        'organizations/orgA/auditLogs/l1': { at: new Date(NOW - DAY) },
      },
      { fail: (path) => path.endsWith('/sites') || path.endsWith('/auditLogs') }
    )
    const out = await listPlatformOrganizationsFor(db, OPERATOR, { now: NOW })
    expect(out.partial).toBe(true)
    expect(out.rows[0].counts.sites).toBe(null)
    expect(out.rows[0].counts.recentRecords).toBe(null)
    expect(out.rows[0].activityTypes).toBe(null)
    expect(out.rows[0].recentActivity).toBe(null)
    expect(out.rows[0].lastActivityAt).toBe(null)
    expect(out.rows[0].counts.users).toBe(1)
    expect(out.failures).toBeUndefined()
  })

  it('skips an organization id that is not a single path segment and says the scan was partial', async () => {
    const db = granted({
      'organizations/ok': { name: 'Ok' },
      'organizations/a/b': { name: 'Walked' },
    })
    // The fake stores `organizations/a/b` as a nested path, so it never appears
    // as a document of `organizations`. Inject the bad id the way a hostile
    // document id would arrive from the query itself.
    const realCollection = db.collection.bind(db)
    db.collection = (name) => {
      const q = realCollection(name)
      if (name !== 'organizations') return q
      const originalGet = q.get.bind(q)
      q.get = async () => {
        const snap = await originalGet()
        snap.docs.push({ id: 'a/b', data: () => ({ name: 'Walked' }) })
        return snap
      }
      return q
    }
    const out = await loadPlatformDirectory(db, { now: NOW })
    expect(out.partial).toBe(true)
    expect(out.rows.map((row) => row.id)).toEqual(['ok'])
    expect(db.collections.some((name) => name.includes('a/b'))).toBe(false)
  })

  it('groups the last 30 days by type and does not let an older event into the breakdown', async () => {
    const db = granted({
      'organizations/orgA': { name: 'Acme' },
      'organizations/orgA/auditLogs/old': {
        at: new Date(NOW - 40 * DAY),
        module: 'inspections',
        action: 'inspection.create',
        summary: 'Outside the window',
        actorName: 'Ada',
      },
      'organizations/orgA/auditLogs/inc': {
        at: new Date(NOW - DAY),
        module: 'incidents',
        action: 'incident.create',
        summary: 'Filed a near miss',
        actorName: 'Ada Admin',
        narrative: 'do not return this',
      },
      'organizations/orgA/auditLogs/user': {
        at: new Date(NOW - 3 * DAY),
        module: 'core',
        action: 'user.status.update',
        summary: 'Set status → suspended',
        actorName: 'Bea',
      },
      'organizations/orgA/auditLogs/loto': {
        at: new Date(NOW - 2 * DAY),
        module: 'loto',
        action: 'loto.apply',
        targetLabel: 'Pump P-2',
        actorName: 'Sam',
      },
    })
    const out = await listPlatformOrganizationsFor(db, OPERATOR, { now: NOW, eventCap: 2 })
    const row = out.rows[0]
    expect(row.counts.recentRecords).toBe(3)
    expect(row.lastActivityAt).toBe(new Date(NOW - DAY).toISOString())
    expect(row.activityTruncated).toBe(true)
    expect(row.activityTypes.map((type) => type.type).sort()).toEqual(['incidents', 'loto'])
    expect(row.recentActivity).toHaveLength(2)
    expect(row.recentActivity[0].description).toBe('Filed a near miss')
    expect(JSON.stringify(row)).not.toContain('do not return this')
    expect(JSON.stringify(row)).not.toContain('Outside the window')
  })
})

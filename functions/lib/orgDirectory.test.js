import { describe, it, expect } from 'vitest'
import {
  listPlatformOrganizationsFor,
  loadPlatformDirectory,
  membershipStatus,
  projectAdmins,
  safeDocId,
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
    expect(beacon.lastActivityAt).toBe(null)
    expect(beacon.admins).toEqual([
      { uid: 'legacy', name: 'Legacy Admin', email: 'legacy@beacon.test', status: null },
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
})

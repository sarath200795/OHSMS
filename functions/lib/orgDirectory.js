// ─────────────────────────────────────────────────────────────────────────────
// Platform operator directory — one row per organization.
//
// The console cannot read this from the browser. A platform operator belongs
// to no organization on purpose, and /users is readable only by an approved
// member of the SAME org (firestore.rules). /organizations is the same shape.
// Listing every admin's name and email is therefore something the client is
// structurally unable to do, and that is not a gap to close in the rules.
//
// Widening isPlatformAdmin() onto /users would hand the operator's browser
// every other field on every profile — access grants, departments, whatever a
// tenant has typed into a free-text field — for a screen that needs four
// columns. The callable checks platformAdmins/{uid} with the Admin SDK and
// returns the projection below and nothing else. The request carries no
// organization id: an operator may see every customer, or none.
//
// There is no organization-level active/suspended flag. Membership status is
// derived from the status already stored on /users (pending | approved |
// suspended). A profile written before that field existed has no status and
// is counted as approved, the same way audience mail treats it. "Suspended"
// means every profile in the org is suspended — not a switch somebody flipped
// on the org document, because no such switch exists.
//
// Last activity is the newest auditLogs `at`. Sites are the centre registry
// (organizations/{orgId}/sites). Recent records are audit events inside the
// window. A count that could not be read comes back null, never 0: a zero
// here would read as "this customer has no sites" when the truth is that the
// read failed.
// ─────────────────────────────────────────────────────────────────────────────
import { logger } from 'firebase-functions'
import { HttpsError } from 'firebase-functions/v2/https'

export const ORG_READ_CAP = 1000
export const USER_READ_CAP = 20000
export const RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
export const RECENT_WINDOW_DAYS = 30

const ACTIVITY_CONCURRENCY = 8

/**
 * A Firestore document id, and nothing that would address a different
 * document if it were interpolated into a path. The Admin SDK accepts a
 * slash inside an id and silently walks into another collection.
 */
export function safeDocId(id) {
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= 1500 &&
    id !== '.' &&
    id !== '..' &&
    !id.includes('/') &&
    !id.includes('\\') &&
    !id.includes('\0')
  )
}

/** Firestore Timestamp | Date | epoch millis | ISO string → epoch millis. */
export function toMillis(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (value instanceof Date) {
    const t = value.getTime()
    return Number.isNaN(t) ? null : t
  }
  if (typeof value.toMillis === 'function') {
    const t = value.toMillis()
    return Number.isFinite(t) ? t : null
  }
  if (typeof value.toDate === 'function') {
    const d = value.toDate()
    const t = d instanceof Date ? d.getTime() : NaN
    return Number.isNaN(t) ? null : t
  }
  if (typeof value === 'string') {
    const t = Date.parse(value)
    return Number.isNaN(t) ? null : t
  }
  if (typeof value === 'object') {
    const seconds = typeof value.seconds === 'number' ? value.seconds : value._seconds
    if (typeof seconds === 'number' && Number.isFinite(seconds)) return seconds * 1000
  }
  return null
}

export function toIso(value) {
  const ms = typeof value === 'number' ? value : toMillis(value)
  if (ms == null) return null
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Headcount from the profiles already stored. `approved` includes a missing
 * status: those profiles predate the field and can already sign in.
 */
export function summariseMembers(users) {
  const counts = { users: 0, approved: 0, pending: 0, suspended: 0, other: 0 }
  for (const user of users || []) {
    counts.users += 1
    const status = text(user?.status)
    if (status === '' || status === 'approved') counts.approved += 1
    else if (status === 'pending') counts.pending += 1
    else if (status === 'suspended') counts.suspended += 1
    else counts.other += 1
  }
  return counts
}

/**
 * The headline status. Active wins over everything else, because one approved
 * member means the tenant can be used. Suspended is only the case where
 * every profile is suspended — a pending joiner next to a suspended admin is
 * not a suspended organization, and the counts still show the suspension.
 */
export function membershipStatus(counts) {
  const total = counts?.users || 0
  if (total === 0) return 'none'
  if (counts.approved > 0) return 'active'
  if (counts.pending > 0) return 'pending'
  if (counts.suspended === total) return 'suspended'
  return 'inactive'
}

/** Admins only, and only the fields the console prints. */
export function projectAdmins(users) {
  return (users || [])
    .filter((user) => user?.role === 'admin')
    .map((user) => ({
      uid: text(user.uid || user.id),
      name: text(user.name),
      email: text(user.email),
      status: text(user.status) || null,
    }))
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
        a.email.localeCompare(b.email) ||
        a.uid.localeCompare(b.uid)
    )
}

function asCount(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

async function readDocs(db, path, { limit, fields }) {
  let q = db.collection(path)
  if (fields?.length && typeof q.select === 'function') q = q.select(...fields)
  if (limit && typeof q.limit === 'function') q = q.limit(limit)
  const snap = await q.get()
  return (snap.docs || []).map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
}

async function countPath(db, path) {
  const col = db.collection(path)
  if (typeof col.count === 'function') {
    const snap = await col.count().get()
    return asCount(snap.data()?.count)
  }
  const snap = await col.get()
  return snap.size
}

async function countRecentAudits(db, orgId, cutoff) {
  const q = db.collection(`organizations/${orgId}/auditLogs`).where('at', '>=', cutoff)
  if (typeof q.count === 'function') {
    const snap = await q.count().get()
    return asCount(snap.data()?.count)
  }
  const snap = await q.get()
  return snap.size
}

async function latestAuditAt(db, orgId) {
  const snap = await db
    .collection(`organizations/${orgId}/auditLogs`)
    .orderBy('at', 'desc')
    .limit(1)
    .get()
  const doc = snap.docs?.[0]
  if (!doc) return null
  return toMillis(doc.data()?.at)
}

async function mapPool(items, concurrency, fn) {
  const out = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next
      next += 1
      out[index] = await fn(items[index], index)
    }
  })
  await Promise.all(workers)
  return out
}

/**
 * Every organization, with the activity and the admins the console shows.
 *
 * Reads one more document than the cap. A limit query cannot tell "exactly
 * this many" from "more than this many", and reporting a complete customer
 * list when it is short is worse than a banner on a list that happened to
 * land on the cap.
 */
export async function loadPlatformDirectory(db, opts = {}) {
  const now = typeof opts.now === 'number' ? opts.now : Date.now()
  const orgCap = opts.orgCap || ORG_READ_CAP
  const userCap = opts.userCap || USER_READ_CAP
  const recentWindowMs = opts.recentWindowMs || RECENT_WINDOW_MS
  const concurrency = opts.concurrency || ACTIVITY_CONCURRENCY
  const cutoff = new Date(now - recentWindowMs)

  const [orgDocs, userDocs] = await Promise.all([
    readDocs(db, 'organizations', {
      limit: orgCap + 1,
      fields: ['name', 'createdAt'],
    }),
    readDocs(db, 'users', {
      limit: userCap + 1,
      fields: ['name', 'email', 'role', 'status', 'orgId'],
    }),
  ])

  const orgTruncated = orgDocs.length > orgCap
  const userTruncated = userDocs.length > userCap
  const orgPage = orgDocs.slice(0, orgCap)
  const userPage = userDocs.slice(0, userCap)

  const membersByOrg = new Map()
  for (const user of userPage) {
    const orgId = text(user.orgId)
    if (!orgId) continue
    const row = {
      uid: user.id,
      orgId,
      name: text(user.name),
      email: text(user.email),
      role: user.role,
      status: text(user.status),
    }
    const list = membersByOrg.get(orgId)
    if (list) list.push(row)
    else membersByOrg.set(orgId, [row])
  }

  const failures = []
  let skipped = false
  const safeOrgs = []
  for (const org of orgPage) {
    if (!safeDocId(org.id)) {
      skipped = true
      continue
    }
    safeOrgs.push({
      id: org.id,
      name: text(org.name),
      createdAt: org.createdAt ?? null,
    })
  }

  const activity = await mapPool(safeOrgs, concurrency, async (org) => {
    const result = { sites: null, recentRecords: null, lastActivityAt: null }
    try {
      result.sites = await countPath(db, `organizations/${org.id}/sites`)
    } catch (err) {
      failures.push({ orgId: org.id, what: 'sites', error: err?.message || String(err) })
    }
    try {
      result.recentRecords = await countRecentAudits(db, org.id, cutoff)
    } catch (err) {
      failures.push({ orgId: org.id, what: 'recentRecords', error: err?.message || String(err) })
    }
    try {
      result.lastActivityAt = await latestAuditAt(db, org.id)
    } catch (err) {
      failures.push({ orgId: org.id, what: 'lastActivity', error: err?.message || String(err) })
    }
    return result
  })

  const rows = safeOrgs.map((org, index) => {
    const members = membersByOrg.get(org.id) || []
    const headcount = summariseMembers(members)
    const act = activity[index] || { sites: null, recentRecords: null, lastActivityAt: null }
    return {
      id: org.id,
      name: org.name,
      status: membershipStatus(headcount),
      createdAt: toIso(org.createdAt),
      lastActivityAt: toIso(act.lastActivityAt),
      counts: {
        ...headcount,
        sites: act.sites,
        recentRecords: act.recentRecords,
      },
      admins: projectAdmins(members),
    }
  })

  rows.sort(
    (a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id)
  )

  return {
    rows,
    recentWindowDays: Math.round(recentWindowMs / (24 * 60 * 60 * 1000)),
    truncated: orgTruncated || userTruncated,
    orgTruncated,
    userTruncated,
    partial: skipped || failures.length > 0,
    failures,
  }
}

/**
 * The callable body. Checks the operator grant BEFORE any tenant read.
 * `uid` is the authenticated caller; nothing in the request body is consulted,
 * so there is no organization id a caller can aim at.
 */
export async function listPlatformOrganizationsFor(db, uid, opts = {}) {
  if (!uid || typeof uid !== 'string') {
    throw new HttpsError('unauthenticated', 'Sign in first.')
  }
  // A uid with a slash would make the grant lookup address some other
  // document, and a missing grant must be the only reason this fails closed.
  if (!safeDocId(uid)) {
    throw new HttpsError('permission-denied', 'Platform operators only.')
  }
  const grant = await db.doc(`platformAdmins/${uid}`).get()
  if (grant?.exists !== true) {
    throw new HttpsError('permission-denied', 'Platform operators only.')
  }
  const directory = await loadPlatformDirectory(db, opts)
  for (const failure of directory.failures) {
    logger.warn('listPlatformOrganizations: activity read failed', {
      orgId: failure.orgId,
      what: failure.what,
      error: failure.error,
    })
  }
  return {
    rows: directory.rows,
    recentWindowDays: directory.recentWindowDays,
    truncated: directory.truncated,
    orgTruncated: directory.orgTruncated,
    userTruncated: directory.userTruncated,
    partial: directory.partial,
  }
}

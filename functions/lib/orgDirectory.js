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
// The email in that projection is the profile's `email` when it is a
// non-empty string. Signup and provisioning write it. A profile created by
// hand, or any account whose sign-in address was never copied onto /users,
// still has a name and a role, so the admin shows and the email column is
// blank — which is what the console was doing. Auth is where that address
// lives. The callable asks Auth only for admins whose profile email is
// empty, and copies only the address. A profile that already has one is
// left as stored: that is the address the rest of the product mails, and an
// Auth lookup must not overwrite it or fan out to every member.
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
// window, and those events are grouped by the module (or action) already
// stored on them. A count that could not be read comes back null, never 0:
// a zero here would read as "this customer has no sites" when the truth is
// that the read failed. An empty type list is a successful read of nothing.
// ─────────────────────────────────────────────────────────────────────────────
import { logger } from 'firebase-functions'
import { HttpsError } from 'firebase-functions/v2/https'

export const ORG_READ_CAP = 1000
export const USER_READ_CAP = 20000
export const RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
export const RECENT_WINDOW_DAYS = 30
// One query per organization. Past this, the type breakdown is the newest
// events only and the row says so; the record count stays the exact aggregate.
export const RECENT_EVENT_CAP = 400
export const RECENT_LIST_LIMIT = 10
// Identity Toolkit refuses getUsers above 100 identifiers. Only admins with
// no profile email are looked up, in batches of this size. A failed batch
// leaves those addresses blank; it does not fail the directory.
export const AUTH_EMAIL_BATCH = 100
const DESCRIPTION_MAX = 240

// Labels for the module keys the audit log already writes. A key that is not
// here is still counted — a new module must not vanish from the directory —
// and titled from the key itself.
export const ACTIVITY_TYPE_LABEL = {
  incidents: 'Incidents',
  inspections: 'Inspections',
  ptw: 'Permits',
  loto: 'LOTO',
  hira: 'Risk assessment',
  audit: 'Internal audit',
  equipment: 'Equipment',
  drills: 'Drills',
  training: 'Training',
  committee: 'Committee',
  documents: 'Documents',
  actions: 'Actions',
  emergency: 'Emergency response',
  objectives: 'Objectives',
  weather: 'Weather',
  cctv: 'CCTV',
  stakeholder: 'Stakeholders',
  users: 'User changes',
  sites: 'Sites',
  observations: 'Observations',
  organization: 'Organization',
  other: 'Other',
}

// When `module` was left as the default `core`, the type lives in the action
// prefix the module wrote (`incident.create`, `user.status.update`).
const ACTION_TYPE = [
  [/^user(\.|$)/, 'users'],
  [/^(incident|illness|injury)(\.|$)/, 'incidents'],
  [/^inspection(\.|$)/, 'inspections'],
  [/^(permit|ptw)(\.|$)/, 'ptw'],
  [/^loto(\.|$)/, 'loto'],
  [/^observation(\.|$)/, 'observations'],
  [/^training(\.|$)/, 'training'],
  [/^site(\.|$)/, 'sites'],
  [/^org(\.|$)/, 'organization'],
  [/^action(\.|$)/, 'actions'],
  [/^stakeholder(\.|$)/, 'stakeholder'],
  [/^(mockdrill|drill)(\.|$)/, 'drills'],
  [/^(extinguisher|aed|fas|signage)(\.|$)/, 'equipment'],
  [/^(hira|assessment)(\.|$)/, 'hira'],
]

const TARGET_TYPE = {
  incident: 'incidents',
  illness: 'incidents',
  injury: 'incidents',
  inspection: 'inspections',
  permit: 'ptw',
  loto: 'loto',
  observation: 'observations',
  user: 'users',
  site: 'sites',
}

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

function typeKey(value) {
  const key = text(value).toLowerCase()
  if (!key || key.length > 40 || /[^a-z0-9_-]/.test(key)) return ''
  return key
}

function humanizeKey(value) {
  const raw = String(value || '')
    .replace(/[._-]+/g, ' ')
    .trim()
  if (!raw) return 'Other'
  return raw.replace(/\b\w/g, (c) => c.toUpperCase())
}

export function activityTypeLabel(type) {
  return ACTIVITY_TYPE_LABEL[type] || humanizeKey(type)
}

/**
 * Which product the audit entry belongs to.
 *
 * `module` is the field modules write on purpose. `core` is the default when
 * a writer forgot it, so it is not a type — the action prefix is, and failing
 * that the target. User changes stay "user changes" even when filed under
 * core, because that is the question the directory is answering.
 */
export function activityTypeOf(entry) {
  const action = text(entry?.action).toLowerCase()
  if (/^user(\.|$)/.test(action)) return 'users'
  const module = typeKey(entry?.module)
  if (module && module !== 'core') return module
  for (const [pattern, type] of ACTION_TYPE) {
    if (pattern.test(action)) return type
  }
  const target = typeKey(entry?.target)
  if (TARGET_TYPE[target]) return TARGET_TYPE[target]
  return 'other'
}

function clip(value, max) {
  const clean = value.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  return `${clean.slice(0, max - 1)}…`
}

function activityDescription(entry) {
  const summary = text(entry?.summary)
  if (summary) return clip(summary, DESCRIPTION_MAX)
  const action = humanizeKey(entry?.action)
  const label = text(entry?.targetLabel)
  if (label && action && action !== 'Other') return clip(`${action} — ${label}`, DESCRIPTION_MAX)
  if (label) return clip(label, DESCRIPTION_MAX)
  if (action && action !== 'Other') return action
  return 'Activity'
}

/**
 * Counts and the newest events, from audit documents already limited to the
 * window. Sorting is done here so a query that came back unsorted cannot put
 * an older event in the "recent" list.
 */
export function summariseActivity(
  events,
  { truncated = false, listLimit = RECENT_LIST_LIMIT } = {}
) {
  const sorted = [...(events || [])].sort((a, b) => (toMillis(b?.at) ?? 0) - (toMillis(a?.at) ?? 0))
  const counts = new Map()
  for (const event of sorted) {
    const type = activityTypeOf(event)
    counts.set(type, (counts.get(type) || 0) + 1)
  }
  const activityTypes = [...counts.entries()]
    .map(([type, count]) => ({ type, label: activityTypeLabel(type), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  const recentActivity = sorted.slice(0, listLimit).map((event) => {
    const type = activityTypeOf(event)
    return {
      type,
      label: activityTypeLabel(type),
      description: activityDescription(event),
      actor: text(event?.actorName) || 'Unknown',
      at: toIso(event?.at),
    }
  })
  return { activityTypes, recentActivity, activityTruncated: Boolean(truncated) }
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

/**
 * Uids of admins whose profile has no email string. Members are not included:
 * the directory never returns their address, so looking them up would pull
 * every tenant's sign-in email for a column that does not show it.
 */
export function adminUidsMissingEmail(membersByOrg) {
  const uids = []
  for (const members of membersByOrg.values()) {
    for (const user of members) {
      if (user?.role !== 'admin') continue
      if (text(user.email)) continue
      if (!safeDocId(user.uid)) continue
      uids.push(user.uid)
    }
  }
  return uids
}

/**
 * Fill blank admin emails from Auth. `auth` is the Admin Auth client
 * (`getUsers`). Absent, the profile email stands — unit tests that never
 * pass one keep exercising the Firestore projection alone.
 *
 * A profile email is never replaced. Auth is the fallback for the blank,
 * not a second source of truth that can disagree with the address mail
 * already uses.
 */
export async function fillAdminEmailsFromAuth(membersByOrg, auth, batchSize) {
  if (!auth || typeof auth.getUsers !== 'function') return
  const uids = adminUidsMissingEmail(membersByOrg)
  if (!uids.length) return
  const size = Math.min(
    AUTH_EMAIL_BATCH,
    Math.max(1, Number.isFinite(batchSize) && batchSize > 0 ? batchSize : AUTH_EMAIL_BATCH)
  )
  const found = new Map()
  for (let i = 0; i < uids.length; i += size) {
    const batch = uids.slice(i, i + size)
    let result
    try {
      result = await auth.getUsers(batch.map((uid) => ({ uid })))
    } catch (err) {
      // One bad batch must not blank the batches that already succeeded,
      // and must not take the directory down with it. The names and the
      // activity are still the answer; these addresses stay empty.
      logger.warn('listPlatformOrganizations: auth email lookup failed', {
        error: err?.message || String(err),
      })
      continue
    }
    for (const record of result?.users || []) {
      const email = text(record?.email)
      const uid = text(record?.uid)
      if (!email || !uid) continue
      found.set(uid, email)
    }
  }
  if (!found.size) return
  for (const members of membersByOrg.values()) {
    for (const user of members) {
      if (text(user.email)) continue
      const email = found.get(user.uid)
      if (email) user.email = email
    }
  }
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

async function readRecentAudits(db, orgId, cutoff, cap) {
  let q = db
    .collection(`organizations/${orgId}/auditLogs`)
    .where('at', '>=', cutoff)
    .orderBy('at', 'desc')
  if (typeof q.select === 'function') {
    q = q.select('action', 'module', 'target', 'targetLabel', 'summary', 'actorName', 'at')
  }
  if (typeof q.limit === 'function') q = q.limit(cap + 1)
  const snap = await q.get()
  const docs = snap.docs || []
  const truncated = docs.length > cap
  return {
    events: docs.slice(0, cap).map((doc) => ({ id: doc.id, ...(doc.data() || {}) })),
    truncated,
  }
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
  const eventCap = opts.eventCap || RECENT_EVENT_CAP
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

  // Overlaps the per-org activity reads. Those do not touch the member
  // rows, and projectAdmins runs only after both have finished. The catch is
  // attached immediately so a rejection during those reads is not unhandled,
  // and so a lookup failure cannot fail the directory.
  const emailFill = fillAdminEmailsFromAuth(membersByOrg, opts.auth, opts.authEmailBatch).catch(
    (err) => {
      logger.warn('listPlatformOrganizations: auth email lookup failed', {
        error: err?.message || String(err),
      })
    }
  )

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
    const result = {
      sites: null,
      recentRecords: null,
      lastActivityAt: null,
      activityTypes: null,
      recentActivity: null,
      activityTruncated: false,
    }
    try {
      result.sites = await countPath(db, `organizations/${org.id}/sites`)
    } catch (err) {
      failures.push({ orgId: org.id, what: 'sites', error: err?.message || String(err) })
    }
    let readCount = null
    try {
      const read = await readRecentAudits(db, org.id, cutoff, eventCap)
      const summary = summariseActivity(read.events, { truncated: read.truncated })
      result.activityTypes = summary.activityTypes
      result.recentActivity = summary.recentActivity
      result.activityTruncated = summary.activityTruncated
      // A full page is not a total. Only an under-cap read can stand in for
      // the aggregate when that aggregate itself failed.
      readCount = read.truncated ? null : read.events.length
    } catch (err) {
      failures.push({ orgId: org.id, what: 'activityTypes', error: err?.message || String(err) })
    }
    try {
      result.recentRecords = await countRecentAudits(db, org.id, cutoff)
    } catch (err) {
      result.recentRecords = readCount
      if (readCount == null) {
        failures.push({ orgId: org.id, what: 'recentRecords', error: err?.message || String(err) })
      }
    }
    try {
      result.lastActivityAt = await latestAuditAt(db, org.id)
    } catch (err) {
      failures.push({ orgId: org.id, what: 'lastActivity', error: err?.message || String(err) })
    }
    return result
  })
  await emailFill

  const rows = safeOrgs.map((org, index) => {
    const members = membersByOrg.get(org.id) || []
    const headcount = summariseMembers(members)
    const act = activity[index] || {
      sites: null,
      recentRecords: null,
      lastActivityAt: null,
      activityTypes: null,
      recentActivity: null,
      activityTruncated: false,
    }
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
      activityTypes: act.activityTypes,
      recentActivity: act.recentActivity,
      activityTruncated: act.activityTruncated,
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

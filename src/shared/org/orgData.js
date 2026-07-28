// ─────────────────────────────────────────────────────────────────────────────
// Shared data-access base: organizations, users, the public org-name index, the
// append-only audit log, and sites. Every module builds on top of these helpers
// and the org-scoped collection factory (moduleCol) so tenant scoping is
// automatic and consistent.
// ─────────────────────────────────────────────────────────────────────────────
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  limit,
} from 'firebase/firestore'
import { db } from '../firebase'
import { AUDIT } from '../audit/audit'
import { createSharedSubscription } from './sharedSubscription'

// ── Path helpers ──────────────────────────────────────────────────────────────
export const orgRef = (orgId) => doc(db, 'organizations', orgId)
export const userRef = (uid) => doc(db, 'users', uid)
export const auditCol = (orgId) => collection(db, 'organizations', orgId, 'auditLogs')

/**
 * Org-scoped collection factory — THE way modules reach their data. Guarantees
 * every read/write is namespaced under /organizations/{orgId}/<name>, which is
 * what the security rules enforce for tenant isolation.
 */
export const moduleCol = (orgId, name) => collection(db, 'organizations', orgId, name)
export const moduleDoc = (orgId, name, id) => doc(db, 'organizations', orgId, name, id)

// Public, minimal name→org index so signup can resolve an org by name WITHOUT
// read access to the member-only organizations collection.
const orgIndexKey = (name) => (name || '').trim().toLowerCase()
const orgIndexRef = (name) => doc(db, 'orgIndex', orgIndexKey(name))

// ── Audit log ───────────────────────────────────────────────────────────────
// Append-only trail. Never let an audit failure break the primary write.
export async function logAudit(orgId, actor, action, details = {}) {
  if (!orgId) return
  try {
    await addDoc(auditCol(orgId), {
      at: serverTimestamp(),
      actorUid: actor?.uid || null,
      actorName: actor?.name || actor?.displayName || 'Unknown',
      action,
      module: details.module || 'core',
      target: details.target || 'record',
      targetId: details.targetId || null,
      targetLabel: details.targetLabel || '',
      summary: details.summary || '',
      source: details.source || 'portal',
    })
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[OHS MS] audit log failed:', e?.message || e)
  }
}

export function subscribeAuditLogs(orgId, cb, max = 300) {
  const q = query(auditCol(orgId), orderBy('at', 'desc'), limit(max))
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
}

// ── Organizations & users ─────────────────────────────────────────────────────

/** Create an org + its first admin user + public name index, atomically. */
export async function createOrganization({ orgName, address, uid, name, email }) {
  const org = doc(collection(db, 'organizations'))
  const batch = writeBatch(db)
  batch.set(org, {
    name: orgName,
    nameLower: orgName.trim().toLowerCase(),
    address: address || '',
    createdBy: uid,
    notificationEmail: email,
    createdAt: serverTimestamp(),
  })
  batch.set(userRef(uid), {
    name,
    email,
    orgId: org.id,
    orgName,
    role: 'admin',
    status: 'approved',
    dept: '',
    createdAt: serverTimestamp(),
  })
  // Public lookup index (no sensitive fields).
  batch.set(orgIndexRef(orgName), { orgId: org.id, name: orgName })
  await batch.commit()
  return org.id
}

/** Find an organization by exact (case-insensitive) name via the public orgIndex. */
export async function findOrgByName(orgName) {
  const snap = await getDoc(orgIndexRef(orgName))
  if (!snap.exists()) return null
  const d = snap.data()
  return { id: d.orgId, name: d.name }
}

/** List every organization (public orgIndex) as [{ id, name }] sorted by name. */
export async function listOrganizations() {
  const snap = await getDocs(collection(db, 'orgIndex'))
  return snap.docs
    .map((d) => ({ id: d.data().orgId, name: d.data().name }))
    .filter((o) => o.id && o.name)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Create a pending member joining an existing org (defaults to a standard member). */
export async function createPendingMember({ uid, name, email, orgId, orgName, department }) {
  await setDoc(userRef(uid), {
    name,
    email,
    orgId,
    orgName,
    role: 'member',
    status: 'pending',
    dept: '',
    department: department || '',
    access: { sites: [], regions: [], entities: [] },
    accessRequest: null,
    createdAt: serverTimestamp(),
  })
}

export async function getUserProfile(uid) {
  const snap = await getDoc(userRef(uid))
  return snap.exists() ? { uid, ...snap.data() } : null
}

// ── Shared org-collection listeners ─────────────────────────────────────────
// The same collections are read by several modules at once (incidents, fas,
// extinguishers, auditFindings…). Multiplexing them over ONE listener per
// collection keeps document reads and open sockets flat as concurrency grows,
// instead of scaling with (users × modules mounted).
const sharedOrgCollection = createSharedSubscription((key, emit) => {
  const [orgId, name] = key.split('/')
  return onSnapshot(
    collection(db, 'organizations', orgId, name),
    (snap) => emit(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => emit([])
  )
})

/** Live rows of any org sub-collection, shared app-wide. */
export function subscribeOrgCollection(orgId, name, cb) {
  return sharedOrgCollection(`${orgId}/${name}`, cb)
}

// ONE org-users listener shared by every module context.
const sharedOrgUsers = createSharedSubscription((orgId, emit) =>
  onSnapshot(
    query(collection(db, 'users'), where('orgId', '==', orgId)),
    (snap) => emit(snap.docs.map((d) => ({ uid: d.id, ...d.data() }))),
    () => emit([])
  )
)
export function subscribeOrgUsers(orgId, cb) {
  return sharedOrgUsers(orgId, cb)
}

/** Live org document. */
export function subscribeOrg(orgId, cb) {
  return onSnapshot(orgRef(orgId), (snap) =>
    cb(snap.exists() ? { id: snap.id, ...snap.data() } : null)
  )
}

/** Admin updates org-level settings. */
export async function updateOrgSettings(orgId, updates, actor) {
  await updateDoc(orgRef(orgId), updates)
  await logAudit(orgId, actor, AUDIT.ORG_SETTINGS, {
    target: 'org',
    summary: `Updated org settings: ${Object.keys(updates).join(', ')}`,
  })
}

export async function setUserStatus(uid, status, orgId, actor, userLabel) {
  await updateDoc(userRef(uid), { status })
  await logAudit(orgId, actor, AUDIT.USER_STATUS, {
    target: 'user',
    targetId: uid,
    targetLabel: userLabel || uid,
    summary: `Set status → ${status}`,
  })
}

export async function setUserRole(uid, role, orgId, actor, userLabel) {
  await updateDoc(userRef(uid), { role })
  await logAudit(orgId, actor, AUDIT.USER_ROLE, {
    target: 'user',
    targetId: uid,
    targetLabel: userLabel || uid,
    summary: `Set role → ${role}`,
  })
}

export async function setUserDept(uid, dept) {
  await updateDoc(userRef(uid), { dept: dept || '' })
}

// ── Sites (shared across modules) ───────────────────────────────────────────
// Same multiplexing as users — the site registry is read by nearly every module.
const sharedSites = createSharedSubscription((orgId, emit) => {
  const q = query(moduleCol(orgId, 'sites'), orderBy('name'))
  return onSnapshot(
    q,
    (snap) => emit(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => emit([])
  )
})
export function subscribeSites(orgId, cb) {
  return sharedSites(orgId, cb)
}

// Keep only non-empty string custom attributes (Building, Floor, …).
export function cleanAttributes(attributes) {
  const out = {}
  if (attributes && typeof attributes === 'object') {
    for (const [k, v] of Object.entries(attributes)) {
      const val = (v ?? '').toString().trim()
      if (k && val) out[k] = val
    }
  }
  return out
}

// Normalize a site payload (shared by create + update).
function siteFields(data) {
  const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v))
  return {
    name: data.name || '',
    region: data.region || '',
    entity: data.entity || '',
    address: data.address || '',
    lat: num(data.lat),
    lng: num(data.lng),
    firstAidBoxes: num(data.firstAidBoxes) || 0,
    attributes: cleanAttributes(data.attributes),
  }
}

export async function createSite(orgId, data, actor) {
  const ref = await addDoc(moduleCol(orgId, 'sites'), {
    ...siteFields(data),
    createdAt: serverTimestamp(),
  })
  await logAudit(orgId, actor, AUDIT.SITE_CREATE, {
    target: 'site',
    targetId: ref.id,
    targetLabel: data.name,
    summary: `Created site "${data.name}"`,
  })
  return ref.id
}

/**
 * Bulk-create sites from parsed rows in one batch. Callers must pre-validate
 * (every row needs a name + numeric lat/lng); this writes what it's given.
 */
export async function bulkCreateSites(orgId, rows, actor) {
  const batch = writeBatch(db)
  const names = []
  rows.forEach((r) => {
    const ref = doc(moduleCol(orgId, 'sites'))
    batch.set(ref, { ...siteFields(r), createdAt: serverTimestamp() })
    names.push(r.name)
  })
  await batch.commit()
  await logAudit(orgId, actor, AUDIT.SITE_CREATE, {
    target: 'site',
    summary: `Bulk imported ${names.length} site(s): ${names.slice(0, 6).join(', ')}${names.length > 6 ? '…' : ''}`,
  })
  return names.length
}

/** Assign (or clear) the site an employee is mapped to. */
export async function setUserSite(uid, siteId, siteName, orgId, actor, userLabel) {
  await updateDoc(userRef(uid), { siteId: siteId || null, siteName: siteName || '' })
  await logAudit(orgId, actor, AUDIT.USER_ROLE, {
    target: 'user',
    targetId: uid,
    targetLabel: userLabel || uid,
    summary: `Mapped to site ${siteName || '—'}`,
  })
}

// ── Site-scoped access / permissions ────────────────────────────────────────
const cleanScope = (scope = {}) => ({
  sites: Array.isArray(scope.sites) ? scope.sites : [],
  regions: Array.isArray(scope.regions) ? scope.regions : [],
  entities: Array.isArray(scope.entities) ? scope.entities : [],
})

/** Admin sets a user's department + granted access scope (and clears any request). */
export async function setUserAccess(uid, { department, access }, orgId, actor, userLabel) {
  await updateDoc(userRef(uid), {
    department: department || '',
    access: cleanScope(access),
    accessRequest: null,
  })
  await logAudit(orgId, actor, AUDIT.USER_ROLE, {
    target: 'user',
    targetId: uid,
    targetLabel: userLabel || uid,
    summary: `Granted site access${department ? ` · ${department}` : ''}`,
  })
}

/** A user submits an access request (department + desired scope) for admin review. */
export async function requestAccess(uid, { department, scope }, orgId, actor) {
  await updateDoc(userRef(uid), {
    department: department || '',
    accessRequest: { ...cleanScope(scope), at: serverTimestamp(), by: actor?.name || '' },
  })
  await logAudit(orgId, actor, AUDIT.USER_STATUS, {
    target: 'user',
    targetId: uid,
    targetLabel: actor?.name || uid,
    summary: 'Requested site access',
  })
}

/** Admin applies a user's pending request → grant, then clears the request. */
export async function grantAccessRequest(uid, request, orgId, actor, userLabel) {
  await updateDoc(userRef(uid), {
    access: cleanScope(request),
    accessRequest: null,
  })
  await logAudit(orgId, actor, AUDIT.USER_ROLE, {
    target: 'user',
    targetId: uid,
    targetLabel: userLabel || uid,
    summary: 'Granted requested site access',
  })
}

/**
 * Generic real-time listener for any org-scoped collection (used by the Sites
 * summary to roll up extinguishers / AEDs / incidents, etc.). No orderBy so it
 * never needs a composite index; returns [] on permission/other errors.
 */
export function subscribeCollection(orgId, name, cb) {
  return onSnapshot(
    moduleCol(orgId, name),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => cb([])
  )
}

export async function updateSite(orgId, id, updates, actor) {
  await updateDoc(moduleDoc(orgId, 'sites', id), updates)
  await logAudit(orgId, actor, AUDIT.SITE_UPDATE, { target: 'site', targetId: id })
}

export async function deleteSite(orgId, id, actor, label) {
  await deleteDoc(moduleDoc(orgId, 'sites', id))
  await logAudit(orgId, actor, AUDIT.SITE_DELETE, {
    target: 'site',
    targetId: id,
    targetLabel: label,
  })
}

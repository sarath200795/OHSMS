// ─────────────────────────────────────────────────────────────────────────────
// Shared data-access base: organizations, users, the public org-name index, and
// the append-only audit log. Domain data (incidents, illnesses) lives in its own
// module (incidents.js / illnesses.js) which reuses these helpers.
// ─────────────────────────────────────────────────────────────────────────────
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  limit,
} from 'firebase/firestore'
import { db } from '../firebase'
import { AUDIT } from './audit'

// ── Path helpers ─────────────────────────────────────────────────────────────
export const orgRef = (orgId) => doc(db, 'organizations', orgId)
export const userRef = (uid) => doc(db, 'users', uid)
export const auditCol = (orgId) => collection(db, 'organizations', orgId, 'auditLogs')
// Public, minimal name→org index so signup can look up an org by name WITHOUT
// reading the (member-only) organizations collection.
const orgIndexKey = (name) => (name || '').trim().toLowerCase()
const orgIndexRef = (name) => doc(db, 'orgIndex', orgIndexKey(name))

// ── Audit log ─────────────────────────────────────────────────────────────────
// Append-only trail. Never let an audit failure break the primary write.
export async function logAudit(orgId, actor, action, details = {}) {
  if (!orgId) return
  try {
    await addDoc(auditCol(orgId), {
      at: serverTimestamp(),
      actorUid: actor?.uid || null,
      actorName: actor?.name || 'Unknown',
      action,
      target: details.target || 'incident',
      targetId: details.targetId || null,
      targetLabel: details.targetLabel || '',
      summary: details.summary || '',
      source: details.source || 'portal',
    })
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[Incident IRA] audit log failed:', e?.message || e)
  }
}

export function subscribeAuditLogs(orgId, cb) {
  const q = query(auditCol(orgId), orderBy('at', 'desc'), limit(200))
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
  // Public lookup index (no sensitive fields) so signup can resolve org-by-name
  // without read access to the organizations collection.
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

/** Backfill the public orgIndex entry if missing (idempotent + non-blocking). */
export async function ensureOrgIndex(org) {
  if (!org?.id || !org?.name) return
  try {
    const ref = orgIndexRef(org.name)
    const snap = await getDoc(ref)
    if (snap.exists()) return
    await setDoc(ref, { orgId: org.id, name: org.name })
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[Incident IRA] orgIndex backfill skipped:', e?.message || e)
  }
}

/** Admin-triggered orgIndex backfill (surfaces errors, unlike ensureOrgIndex). */
export async function registerOrgInIndex(orgId, orgName) {
  if (!orgId || !orgName) throw new Error('Organization details are missing.')
  await setDoc(orgIndexRef(orgName), { orgId, name: orgName })
}

/** Create a pending member joining an existing org (defaults to a Reporter). */
export async function createPendingMember({ uid, name, email, orgId, orgName }) {
  await setDoc(userRef(uid), {
    name,
    email,
    orgId,
    orgName,
    role: 'reporter',
    status: 'pending',
    dept: '',
    createdAt: serverTimestamp(),
  })
}

export async function getUserProfile(uid) {
  const snap = await getDoc(userRef(uid))
  return snap.exists() ? normalizeRoles({ uid, ...snap.data() }) : null
}

// Multi-role compatibility: ensure roles[] exists and collapse to the single
// highest-privilege role (reporter < investigator < admin) so existing
// `can(role, …)` / `role === 'admin'` checks honour users holding several roles.
function normalizeRoles(p) {
  const roles = Array.isArray(p.roles) && p.roles.length ? p.roles : p.role ? [p.role] : []
  const isAdmin = p.isAdmin === true || roles.includes('admin')
  const RANK = { admin: 3, investigator: 2, reporter: 1 }
  const role = isAdmin
    ? 'admin'
    : [...roles].sort((a, b) => (RANK[b] || 0) - (RANK[a] || 0))[0] || p.role || 'reporter'
  return { ...p, roles, isAdmin, role }
}

// Delegated to the shared ref-counted org-users listener (one per org app-wide).
export { subscribeOrgUsers } from '../../../shared/org/orgData'

/** Live org document. */
export function subscribeOrg(orgId, cb) {
  return onSnapshot(orgRef(orgId), (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null))
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

/** Update a user's department label. */
export async function setUserDept(uid, dept) {
  await updateDoc(userRef(uid), { dept: dept || '' })
}

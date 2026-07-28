// ─────────────────────────────────────────────────────────────────────────────
// All Firestore access goes through here: org/user management (the auth +
// admin-approval workflow) plus the org-scoped consultation meetings and sites.
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
  onSnapshot,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase'

// ── Path helpers ─────────────────────────────────────────────────────────────
const orgRef = (orgId) => doc(db, 'organizations', orgId)
const userRef = (uid) => doc(db, 'users', uid)
const consultationCol = (orgId) => collection(db, 'organizations', orgId, 'consultations')
const consultationRef = (orgId, id) => doc(db, 'organizations', orgId, 'consultations', id)
const siteCol = (orgId) => collection(db, 'organizations', orgId, 'sites')
const siteRef = (orgId, id) => doc(db, 'organizations', orgId, 'sites', id)
// Public, minimal name→org index so signup can look up an org by name WITHOUT
// reading the (member-only) organizations collection.
const orgIndexKey = (name) => (name || '').trim().toLowerCase()
const orgIndexRef = (name) => doc(db, 'orgIndex', orgIndexKey(name))

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
    notificationEmail: email, // default: admin's email (editable later)
    createdAt: serverTimestamp(),
  })
  batch.set(userRef(uid), {
    name,
    email,
    orgId: org.id,
    orgName,
    role: 'admin',
    status: 'approved',
    createdAt: serverTimestamp(),
  })
  // Public lookup index (no sensitive fields) so signup can resolve org-by-name
  // without read access to the organizations collection.
  batch.set(orgIndexRef(orgName), { orgId: org.id, name: orgName })
  await batch.commit()
  return org.id
}

/**
 * Find an organization by exact (case-insensitive) name via the public
 * orgIndex. Returns { id, name } or null. (Only the fields needed at signup.)
 */
export async function findOrgByName(orgName) {
  const snap = await getDoc(orgIndexRef(orgName))
  if (!snap.exists()) return null
  const d = snap.data()
  return { id: d.orgId, name: d.name }
}

/**
 * List every organization (from the public orgIndex), as [{ id, name }] sorted
 * by name. Used by the signup dropdown so members pick a real org. Public-readable.
 */
export async function listOrganizations() {
  const snap = await getDocs(collection(db, 'orgIndex'))
  return snap.docs
    .map((d) => ({ id: d.data().orgId, name: d.data().name }))
    .filter((o) => o.id && o.name)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Backfill the public orgIndex entry for an org if it's missing. Idempotent +
 * non-blocking (the index is a convenience for signup, never critical).
 */
export async function ensureOrgIndex(org) {
  if (!org?.id || !org?.name) return
  try {
    const ref = orgIndexRef(org.name)
    const snap = await getDoc(ref)
    if (snap.exists()) return
    await setDoc(ref, { orgId: org.id, name: org.name })
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[HSE] orgIndex backfill skipped:', e?.message || e)
  }
}

/**
 * Explicit, admin-triggered orgIndex write. Unlike ensureOrgIndex this does NOT
 * swallow errors, so the UI can show a clear permission/error toast.
 */
export async function registerOrgInIndex(orgId, orgName) {
  if (!orgId || !orgName) throw new Error('Organization details are missing.')
  await setDoc(orgIndexRef(orgName), { orgId, name: orgName })
}

/** Create a pending member who is joining an existing org. */
export async function createPendingMember({ uid, name, email, orgId, orgName }) {
  await setDoc(userRef(uid), {
    name,
    email,
    orgId,
    orgName,
    role: 'member',
    status: 'pending',
    createdAt: serverTimestamp(),
  })
}

export async function getUserProfile(uid) {
  const snap = await getDoc(userRef(uid))
  return snap.exists() ? normalizeRoles({ uid, ...snap.data() }) : null
}

// Multi-role compatibility: ensure roles[] exists and role/isAdmin reflect it so
// existing `role === 'admin'` checks keep working when users hold several roles.
function normalizeRoles(p) {
  const roles = Array.isArray(p.roles) && p.roles.length ? p.roles : p.role ? [p.role] : []
  const isAdmin = p.isAdmin === true || roles.includes('admin')
  const role = isAdmin ? 'admin' : roles.includes(p.role) ? p.role : roles[0] || p.role || 'member'
  return { ...p, roles, isAdmin, role }
}

// Delegated to the shared ref-counted org-users listener (one per org app-wide).
export { subscribeOrgUsers } from '../../../shared/org/orgData'

/** Live org document. */
export function subscribeOrg(orgId, cb) {
  return onSnapshot(orgRef(orgId), (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null))
}

/** Admin updates org-level settings. */
export async function updateOrgSettings(orgId, updates) {
  await updateDoc(orgRef(orgId), updates)
}

export async function setUserStatus(uid, status) {
  await updateDoc(userRef(uid), { status })
}

export async function setUserRole(uid, role) {
  await updateDoc(userRef(uid), { role })
}

// ── Sites (organizations/{orgId}/sites) ────────────────────────────────────────
// Facility sites the committee meetings are scoped/filtered by. { code, name }.

// Delegated to the shared ref-counted org-sites listener (one per org app-wide).
export { subscribeSites } from '../../../shared/org/orgData'

export async function listSites(orgId) {
  const snap = await getDocs(siteCol(orgId))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

export async function addSite(orgId, { code, name }) {
  const ref = await addDoc(siteCol(orgId), {
    code: code || '',
    name: name || code || '',
    createdAt: serverTimestamp(),
  })
  return ref.id
}

export async function updateSite(orgId, id, updates) {
  await updateDoc(siteRef(orgId, id), updates)
}

export async function deleteSite(orgId, id) {
  await deleteDoc(siteRef(orgId, id))
}

// ── Consultations / meetings (organizations/{orgId}/consultations) ──────────────

export function subscribeConsultations(orgId, cb, onError) {
  return onSnapshot(consultationCol(orgId),
    (snap) => cb(snap.docs.map((d) => ({ firebaseKey: d.id, ...d.data() }))),
    (err) => { console.warn('[HSE] consultations read failed:', err?.message || err); onError?.(err) },
  )
}

export async function addConsultation(orgId, data) {
  const ref = await addDoc(consultationCol(orgId), { ...data, createdAt: serverTimestamp() })
  return ref.id
}

export async function updateConsultation(orgId, id, data) {
  await setDoc(consultationRef(orgId, id), data, { merge: true })
}

export async function deleteConsultation(orgId, id) {
  await deleteDoc(consultationRef(orgId, id))
}

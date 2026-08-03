// ─────────────────────────────────────────────────────────────────────────────
// All Firestore access goes through here. Org-scoped paths:
//   organizations/{orgId}                          — org doc
//   organizations/{orgId}/assessments/{id}         — risk assessments
//   users/{uid}                                    — user profiles
//   orgIndex/{slug}                                — public name→org index (signup)
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
import { reserveDocId } from '../../../shared/docId/reserve'

// ── Path helpers ─────────────────────────────────────────────────────────────
const orgRef = (orgId) => doc(db, 'organizations', orgId)
const assessmentCol = (orgId) => collection(db, 'organizations', orgId, 'assessments')
const assessmentRef = (orgId, id) => doc(db, 'organizations', orgId, 'assessments', id)
const userRef = (uid) => doc(db, 'users', uid)
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
  batch.set(orgIndexRef(orgName), { orgId: org.id, name: orgName })
  await batch.commit()
  return org.id
}

export async function findOrgByName(orgName) {
  const snap = await getDoc(orgIndexRef(orgName))
  if (!snap.exists()) return null
  const d = snap.data()
  return { id: d.orgId, name: d.name }
}

/** List every organization (from the public orgIndex), [{ id, name }] sorted. */
export async function listOrganizations() {
  const snap = await getDocs(collection(db, 'orgIndex'))
  return snap.docs
    .map((d) => ({ id: d.data().orgId, name: d.data().name }))
    .filter((o) => o.id && o.name)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Create a member joining an existing org. Auto-approved (no admin queue). */
export async function createMember({ uid, name, email, orgId, orgName }) {
  await setDoc(userRef(uid), {
    name,
    email,
    orgId,
    orgName,
    role: 'member',
    status: 'approved',
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

// Default snapshot error handler: log a warning instead of letting Firestore
// raise an "Uncaught Error in snapshot listener" that can hang/blank the UI.
const onSnapErr = (label) => (err) => {
  // eslint-disable-next-line no-console
  console.warn(`[HIRA] ${label} listener error:`, err?.code || err?.message || err)
}

// Delegated to the shared ref-counted org-users listener (one per org app-wide).
export { subscribeOrgUsers } from '../../../shared/org/orgData'

/** Live org document (name, address, sites, …). */
export function subscribeOrg(orgId, cb, onError) {
  return onSnapshot(orgRef(orgId), (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null), onError || onSnapErr('org'))
}

/** Replace the org's list of sites/facilities. */
export async function updateOrgSites(orgId, sites) {
  await updateDoc(orgRef(orgId), { sites })
}

// ── Activity log (append-only audit trail) ────────────────────────────────────
const activityCol = (orgId) => collection(db, 'organizations', orgId, 'activity')

/** Record a user action. Fire-and-forget — never blocks the main operation. */
export function logActivity(orgId, actor, { type, message, assessmentId = null }) {
  if (!orgId) return
  addDoc(activityCol(orgId), {
    type: type || 'event',
    message: message || '',
    assessmentId,
    actorUid: actor?.uid || null,
    actorName: actor?.name || 'Someone',
    at: serverTimestamp(),
  }).catch((e) => {
    // eslint-disable-next-line no-console
    console.warn('[HIRA] activity log failed:', e?.message || e)
  })
}

export function subscribeActivity(orgId, cb, onError, max = 50) {
  const q = query(activityCol(orgId), orderBy('at', 'desc'), limit(max))
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError || onSnapErr('activity'))
}

// ── Risk assessments ──────────────────────────────────────────────────────────

const ASSESSMENT_LOAD_CAP = 1000

export function subscribeAssessments(orgId, cb, onError, max = ASSESSMENT_LOAD_CAP) {
  const q = query(assessmentCol(orgId), orderBy('createdAt', 'desc'), limit(max))
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError || onSnapErr('assessments'))
}

export async function getAssessment(orgId, id) {
  const snap = await getDoc(assessmentRef(orgId, id))
  return snap.exists() ? { id, ...snap.data() } : null
}

/** Strip undefined values so Firestore accepts the nested write. */
function clean(value) {
  if (Array.isArray(value)) return value.map(clean)
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) out[k] = clean(v)
    }
    return out
  }
  return value
}

export async function createAssessment(orgId, data, actor) {
  const ref = await addDoc(assessmentCol(orgId), {
    ...clean(data),
    docId: await reserveDocId(orgId, 'hira'),
    createdBy: actor?.uid || null,
    createdByName: actor?.name || '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

export async function updateAssessment(orgId, id, data) {
  await updateDoc(assessmentRef(orgId, id), {
    ...clean(data),
    updatedAt: serverTimestamp(),
  })
}

export async function deleteAssessment(orgId, id) {
  await deleteDoc(assessmentRef(orgId, id))
}

/** Bulk create assessments (from CSV import) in chunked batches. `kind` marks
 *  the imported rows as 'site' (normal) or 'baseline' (activity template). */
export async function bulkCreateAssessments(orgId, list, actor, kind = 'site') {
  let created = 0
  for (let i = 0; i < list.length; i += 200) {
    const chunk = list.slice(i, i + 200)
    const batch = writeBatch(db)
    for (const data of chunk) {
      const ref = doc(assessmentCol(orgId))
      batch.set(ref, {
        ...clean(data),
        kind,
        baselineId: '',
        createdBy: actor?.uid || null,
        createdByName: actor?.name || '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      created++
    }
    await batch.commit()
  }
  return created
}

// ─────────────────────────────────────────────────────────────────────────────
// All Firestore access goes through here: org-scoped paths for inspection
// templates + records, the shared organizations/users/orgIndex collections, and
// an append-only audit trail. Mirrors the Fire Marshal data layer conventions.
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
  limit,
} from 'firebase/firestore'
import { db } from '../firebase'
import { reserveDocId } from '../../../shared/docId/reserve'

// ── Path helpers ─────────────────────────────────────────────────────────────
const orgRef = (orgId) => doc(db, 'organizations', orgId)
const templateCol = (orgId) => collection(db, 'organizations', orgId, 'inspectionTemplates')
const templateRef = (orgId, id) => doc(db, 'organizations', orgId, 'inspectionTemplates', id)
const recordCol = (orgId) => collection(db, 'organizations', orgId, 'inspectionRecords')
const recordRef = (orgId, id) => doc(db, 'organizations', orgId, 'inspectionRecords', id)
const siteCol = (orgId) => collection(db, 'organizations', orgId, 'sites')
const siteRef = (orgId, id) => doc(db, 'organizations', orgId, 'sites', id)
const userRef = (uid) => doc(db, 'users', uid)
const auditCol = (orgId) => collection(db, 'organizations', orgId, 'auditLogs')
const orgIndexKey = (name) => (name || '').trim().toLowerCase()
const orgIndexRef = (name) => doc(db, 'orgIndex', orgIndexKey(name))

// ── Audit log ────────────────────────────────────────────────────────────────
// Append-only trail. Never let an audit failure break the primary write.
async function logAudit(orgId, actor, action, details = {}) {
  if (!orgId) return
  try {
    await addDoc(auditCol(orgId), {
      at: serverTimestamp(),
      actorUid: actor?.uid || null,
      actorName: actor?.name || 'Unknown',
      action,
      target: details.target || 'template',
      targetId: details.targetId || null,
      targetLabel: details.targetLabel || '',
      summary: details.summary || '',
    })
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[Inspections] audit log failed:', e?.message || e)
  }
}

export function subscribeAuditLogs(orgId, cb) {
  const q = query(auditCol(orgId), orderBy('at', 'desc'), limit(200))
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
}

// ── Organizations & users ──────────────────────────────────────────────────────

/** Create an org + its first admin user + public name index, atomically-ish. */
export async function createOrganization({ orgName, address, uid, name, email }) {
  const org = doc(collection(db, 'organizations'))
  await setDoc(org, {
    name: orgName,
    nameLower: orgName.trim().toLowerCase(),
    address: address || '',
    createdBy: uid,
    notificationEmail: email,
    createdAt: serverTimestamp(),
  })
  await setDoc(userRef(uid), {
    name,
    email,
    orgId: org.id,
    orgName,
    role: 'admin',
    status: 'approved',
    createdAt: serverTimestamp(),
  })
  await setDoc(orgIndexRef(orgName), { orgId: org.id, name: orgName })
  return org.id
}

/** Find an organization by exact (case-insensitive) name via the public index. */
export async function findOrgByName(orgName) {
  const snap = await getDoc(orgIndexRef(orgName))
  if (!snap.exists()) return null
  const d = snap.data()
  return { id: d.orgId, name: d.name }
}

/** List every organization (from the public orgIndex), sorted by name. */
export async function listOrganizations() {
  const snap = await getDocs(collection(db, 'orgIndex'))
  return snap.docs
    .map((d) => ({ id: d.data().orgId, name: d.data().name }))
    .filter((o) => o.id && o.name)
    .sort((a, b) => a.name.localeCompare(b.name))
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

export function subscribeOrg(orgId, cb) {
  return onSnapshot(orgRef(orgId), (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null))
}

export async function setUserStatus(uid, status, orgId, actor, userLabel) {
  await updateDoc(userRef(uid), { status })
  await logAudit(orgId, actor, 'user.status', {
    target: 'user',
    targetId: uid,
    targetLabel: userLabel || uid,
    summary: `Set status → ${status}`,
  })
}

export async function setUserRole(uid, role, orgId, actor, userLabel) {
  await updateDoc(userRef(uid), { role })
  await logAudit(orgId, actor, 'user.role', {
    target: 'user',
    targetId: uid,
    targetLabel: userLabel || uid,
    summary: `Set role → ${role}`,
  })
}

// ── Inspection templates ───────────────────────────────────────────────────────

export function subscribeTemplates(orgId, cb) {
  const q = query(templateCol(orgId), orderBy('createdAt', 'desc'))
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
}

export async function addTemplate(orgId, data, actor) {
  const ref = await addDoc(templateCol(orgId), {
    ...data,
    assignments: data.assignments || [],
    createdBy: actor?.name || '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  await logAudit(orgId, actor, 'template.create', {
    targetId: ref.id,
    targetLabel: data.title || '',
    summary: `Created inspection form "${data.title}"`,
  })
  return ref.id
}

export async function updateTemplate(orgId, id, updates, actor) {
  await updateDoc(templateRef(orgId, id), { ...updates, updatedAt: serverTimestamp() })
  await logAudit(orgId, actor, 'template.update', {
    targetId: id,
    targetLabel: updates.title || '',
    summary: `Updated inspection form`,
  })
}

export async function setTemplateStatus(orgId, id, status) {
  await updateDoc(templateRef(orgId, id), { status, updatedAt: serverTimestamp() })
}

/** Replace the assignments array on a template (used by the scheduler modal). */
export async function updateTemplateAssignments(orgId, id, assignments, actor) {
  await updateDoc(templateRef(orgId, id), { assignments, updatedAt: serverTimestamp() })
  await logAudit(orgId, actor, 'assignment.update', {
    targetId: id,
    summary: `Updated assignments (${assignments.length})`,
  })
}

export async function deleteTemplate(orgId, id, label, actor) {
  await deleteDoc(templateRef(orgId, id))
  await logAudit(orgId, actor, 'template.delete', {
    targetId: id,
    targetLabel: label || '',
    summary: `Deleted inspection form "${label}"`,
  })
}

// ── Inspection records (completed inspections) ───────────────────────────────────

export function subscribeRecords(orgId, cb) {
  const q = query(recordCol(orgId), orderBy('completedAt', 'desc'), limit(500))
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
}

export async function addRecord(orgId, record, actor) {
  const ref = await addDoc(recordCol(orgId), {
    docId: await reserveDocId(orgId, 'inspections'),
    ...record,
    completedAt: record.completedAt || new Date().toISOString(),
    createdAt: serverTimestamp(),
  })
  await logAudit(orgId, actor, 'inspection.submit', {
    target: 'record',
    targetId: ref.id,
    targetLabel: record.templateTitle || '',
    summary: `Submitted "${record.templateTitle}" — ${record.score}% (${record.passFailResult})`,
  })
  return ref.id
}

export async function deleteRecord(orgId, id, label, actor) {
  await deleteDoc(recordRef(orgId, id))
  await logAudit(orgId, actor, 'record.delete', {
    target: 'record',
    targetId: id,
    targetLabel: label || '',
    summary: `Deleted inspection record`,
  })
}

// ── Sites (admin-managed) ────────────────────────────────────────────────────────

// Delegated to the shared ref-counted org-sites listener (one per org app-wide).
export { subscribeSites } from '../../../shared/org/orgData'

export async function addSite(orgId, data, actor) {
  const ref = await addDoc(siteCol(orgId), {
    name: data.name,
    code: data.code || '',
    address: data.address || '',
    createdBy: actor?.name || '',
    createdAt: serverTimestamp(),
  })
  await logAudit(orgId, actor, 'site.create', {
    target: 'site',
    targetId: ref.id,
    targetLabel: data.name || '',
    summary: `Created site "${data.name}"`,
  })
  return ref.id
}

export async function updateSite(orgId, id, updates, actor) {
  await updateDoc(siteRef(orgId, id), updates)
  await logAudit(orgId, actor, 'site.update', {
    target: 'site',
    targetId: id,
    targetLabel: updates.name || '',
    summary: `Updated site`,
  })
}

export async function deleteSite(orgId, id, label, actor) {
  await deleteDoc(siteRef(orgId, id))
  await logAudit(orgId, actor, 'site.delete', {
    target: 'site',
    targetId: id,
    targetLabel: label || '',
    summary: `Deleted site "${label}"`,
  })
}

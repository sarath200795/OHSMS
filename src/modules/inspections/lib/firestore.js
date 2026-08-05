// ─────────────────────────────────────────────────────────────────────────────
// All Firestore access goes through here: org-scoped paths for inspection
// templates + records, the shared organizations/users/orgIndex collections, and
// an append-only audit trail. Mirrors the Fire Marshal data layer conventions.
// ─────────────────────────────────────────────────────────────────────────────
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
  limit,
} from 'firebase/firestore'
import { db } from '../firebase'
import { reserveDocId } from '../../../shared/docId/reserve'

// ── Path helpers ─────────────────────────────────────────────────────────────
const templateCol = (orgId) => collection(db, 'organizations', orgId, 'inspectionTemplates')
const templateRef = (orgId, id) => doc(db, 'organizations', orgId, 'inspectionTemplates', id)
const recordCol = (orgId) => collection(db, 'organizations', orgId, 'inspectionRecords')
const recordRef = (orgId, id) => doc(db, 'organizations', orgId, 'inspectionRecords', id)
const auditCol = (orgId) => collection(db, 'organizations', orgId, 'auditLogs')

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

// ── Organizations & users ──────────────────────────────────────────────────────

// Delegated to the shared ref-counted org-users listener (one per org app-wide).
export { subscribeOrgUsers } from '../../../shared/org/orgData'

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

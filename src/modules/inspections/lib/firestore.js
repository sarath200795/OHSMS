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
  runTransaction,
  limit,
} from 'firebase/firestore'
import { db } from '../../../shared/firebase'
import { reserveDocId } from '../../../shared/docId/reserve'
import { logAudit as logOrgAudit, COLLECTION_READ_CAP } from '../../../shared/org/orgData'
import { snapshotHandlers } from '../../../shared/snapshotError'

// ── Path helpers ─────────────────────────────────────────────────────────────
const templateCol = (orgId) => collection(db, 'organizations', orgId, 'inspectionTemplates')
const templateRef = (orgId, id) => doc(db, 'organizations', orgId, 'inspectionTemplates', id)
const recordCol = (orgId) => collection(db, 'organizations', orgId, 'inspectionRecords')
const recordRef = (orgId, id) => doc(db, 'organizations', orgId, 'inspectionRecords', id)

// ── Audit log ────────────────────────────────────────────────────────────────
// One implementation, in shared/org/orgData; this wrapper adds only the module
// key and the default target. The private copy it replaces omitted both
// `module` and `source`, so inspection entries read as "Core" in the unified
// Audit Log with no origin recorded.
const logAudit = (orgId, actor, action, details = {}) =>
  logOrgAudit(orgId, actor, action, { module: 'inspections', target: 'template', ...details })

// ── Organizations & users ──────────────────────────────────────────────────────

// Delegated to the shared ref-counted org-users listener (one per org app-wide).
export { subscribeOrgUsers } from '../../../shared/org/orgData'

// ── Inspection templates ───────────────────────────────────────────────────────

export function subscribeTemplates(orgId, cb) {
  // Capped, like every other live listener in the app. Templates carry their
  // full `fields` array AND their entire `assignments` history, so an org with
  // years of forms was pulling all of it into the browser on every mount and
  // buildScheduledTasks then walked the lot.
  const q = query(templateCol(orgId), orderBy('createdAt', 'desc'), limit(COLLECTION_READ_CAP))
  const h = snapshotHandlers('inspection templates', cb)
  return onSnapshot(q, (snap) => h.ok(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), h.err)
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
/**
 * Mark one assignment done, once its inspection has actually been recorded.
 *
 * Nothing did this. Submitting an inspection wrote the record with the
 * `assignmentId` on it, but the assignment's own status was only ever written
 * by the assignments modal, and the only values it ever wrote were 'Pending'
 * and 'Cancelled'. Recurring assignments were saved by the past-records check
 * in schedule.js; the one-off branch has no such check, so a completed one-off
 * inspection stayed 'Pending' for ever and kept rolling into the overdue list —
 * which is how an overdue count stops meaning anything.
 *
 * A transaction, because `assignments` is an array on the template document:
 * read-modify-write from a stale copy would revert whatever the assignments
 * modal did in between.
 *
 * Best-effort by contract — the caller must not fail the submit if this fails.
 * The inspection IS recorded at this point, and telling someone their
 * inspection did not save because a status flag did not move would be a worse
 * lie than the stale flag.
 */
export async function completeAssignment(orgId, templateId, assignmentId, actor) {
  if (!templateId || !assignmentId) return
  const changed = await runTransaction(db, async (tx) => {
    const snap = await tx.get(templateRef(orgId, templateId))
    if (!snap.exists()) return false
    const assignments = Array.isArray(snap.data().assignments) ? snap.data().assignments : []
    let hit = false
    const next = assignments.map((a) => {
      if (a?.id !== assignmentId || a.status !== 'Pending') return a
      hit = true
      return { ...a, status: 'Completed', completedAt: new Date().toISOString() }
    })
    if (!hit) return false
    tx.update(templateRef(orgId, templateId), { assignments: next, updatedAt: serverTimestamp() })
    return true
  })
  if (changed) {
    await logAudit(orgId, actor, 'assignment.complete', {
      targetId: templateId,
      summary: `Assignment ${assignmentId} completed`,
    })
  }
}

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
  const h = snapshotHandlers('inspection records', cb)
  return onSnapshot(q, (snap) => h.ok(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), h.err)
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

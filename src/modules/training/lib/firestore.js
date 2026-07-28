// ─────────────────────────────────────────────────────────────────────────────
// Training & Certifications data layer. Org-scoped collections:
//   organizations/{orgId}/trainingCourses  — the course catalogue
//   organizations/{orgId}/trainingRecords  — one record per employee completion
// Every mutation writes to the shared append-only audit log (module 'training').
// ─────────────────────────────────────────────────────────────────────────────
import {
  addDoc, deleteDoc, doc, getDocs, limit, onSnapshot, orderBy, query, serverTimestamp,
  updateDoc, writeBatch, collection,
} from 'firebase/firestore'
import { db } from '../../../shared/firebase'
import { logAudit } from '../../../shared/org/orgData'
import { computeExpiry, todayISO } from './status'

const courseCol = (orgId) => collection(db, 'organizations', orgId, 'trainingCourses')
const courseRef = (orgId, id) => doc(db, 'organizations', orgId, 'trainingCourses', id)
const recordCol = (orgId) => collection(db, 'organizations', orgId, 'trainingRecords')
const recordRef = (orgId, id) => doc(db, 'organizations', orgId, 'trainingRecords', id)
const assignmentCol = (orgId) => collection(db, 'organizations', orgId, 'trainingAssignments')
const assignmentRef = (orgId, id) => doc(db, 'organizations', orgId, 'trainingAssignments', id)

export const COURSE_CATEGORIES = [
  'Induction', 'Fire Safety', 'First Aid', 'Work at Height', 'Electrical Safety',
  'LOTO', 'Chemical Handling', 'Confined Space', 'Emergency Response',
  'Manual Handling', 'PPE', 'Statutory', 'Refresher', 'Other',
]

// ── Subscriptions ─────────────────────────────────────────────────────────────
export function subscribeCourses(orgId, cb) {
  const q = query(courseCol(orgId), orderBy('name'))
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]))
}
// Live streams are bounded (most-recent first) so app start stays fast at
// thousands of employees; full history is fetched on demand for reports.
export const RECORDS_LIVE_CAP = 2500
export const ASSIGNMENTS_LIVE_CAP = 5000

export function subscribeRecords(orgId, cb) {
  const q = query(recordCol(orgId), orderBy('completedOn', 'desc'), limit(RECORDS_LIVE_CAP))
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]))
}
export function subscribeAssignments(orgId, cb) {
  const q = query(assignmentCol(orgId), orderBy('createdAt', 'desc'), limit(ASSIGNMENTS_LIVE_CAP))
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]))
}

/** One-time full fetches for reports (CSV) — not subject to the live caps. */
export async function fetchAllRecords(orgId) {
  const s = await getDocs(query(recordCol(orgId), orderBy('completedOn', 'desc')))
  return s.docs.map((d) => ({ id: d.id, ...d.data() }))
}
export async function fetchAllAssignments(orgId) {
  const s = await getDocs(assignmentCol(orgId))
  return s.docs.map((d) => ({ id: d.id, ...d.data() }))
}

// ── Courses ───────────────────────────────────────────────────────────────────
// Course content items: learning material shown in "My Learning".
const cleanContent = (content) =>
  (Array.isArray(content) ? content : [])
    .filter((c) => c && (c.label || '').trim() && (c.url || c.dataUrl))
    .map((c) => ({
      id: c.id || `ct-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      type: c.type === 'file' ? 'file' : 'link',
      label: c.label.trim(),
      url: c.url || '',
      fileName: c.fileName || '',
      dataUrl: c.dataUrl || '',
    }))

const cleanCourse = (data) => ({
  name: (data.name || '').trim(),
  category: data.category || 'Other',
  validityMonths: Number(data.validityMonths) || 0, // 0 = never expires
  mandatory: !!data.mandatory,
  description: (data.description || '').trim(),
  content: cleanContent(data.content),
  thumbnail: data.thumbnail || '', // small data-URL image for the course card
})

export async function createCourse(orgId, data, actor) {
  const ref = await addDoc(courseCol(orgId), {
    ...cleanCourse(data),
    createdAt: serverTimestamp(),
    createdBy: actor?.uid || null,
    createdByName: actor?.name || '',
  })
  await logAudit(orgId, actor, 'training.course_create', {
    module: 'training', target: 'course', targetId: ref.id, targetLabel: data.name,
    summary: `Created course "${data.name}"`,
  })
  return ref.id
}

export async function updateCourse(orgId, id, data, actor) {
  await updateDoc(courseRef(orgId, id), { ...cleanCourse(data), updatedAt: serverTimestamp() })
  await logAudit(orgId, actor, 'training.course_update', {
    module: 'training', target: 'course', targetId: id, targetLabel: data.name,
    summary: `Updated course "${data.name}"`,
  })
}

export async function deleteCourse(orgId, id, actor, label) {
  await deleteDoc(courseRef(orgId, id))
  await logAudit(orgId, actor, 'training.course_delete', {
    module: 'training', target: 'course', targetId: id, targetLabel: label,
    summary: `Deleted course "${label}"`,
  })
}

// ── Records ───────────────────────────────────────────────────────────────────
// One training session for N employees → N records (individual certification
// lifecycles), written in a single batch. Any matching OPEN assignments (same
// course + employee, passed in from the live context) are completed too.
export async function logTraining(orgId, { course, employees, trainerName, completedOn, scope, notes }, actor, openAssignments = []) {
  const expiresOn = computeExpiry(completedOn, course.validityMonths)
  const uids = new Set(employees.map((e) => e.uid))
  const matching = openAssignments.filter(
    (a) => a.status === 'assigned' && a.courseId === course.id && uids.has(a.employeeUid),
  )
  const batch = writeBatch(db)
  for (const a of matching) {
    batch.update(assignmentRef(orgId, a.id), { status: 'completed', completedOn })
  }
  for (const emp of employees) {
    batch.set(doc(recordCol(orgId)), {
      courseId: course.id,
      courseName: course.name,
      category: course.category || 'Other',
      validityMonths: Number(course.validityMonths) || 0,
      employeeUid: emp.uid,
      employeeName: emp.name || emp.email || 'Unknown',
      trainerName: (trainerName || '').trim(),
      completedOn,
      expiresOn,
      region: scope?.region || '',
      entity: scope?.entity || '',
      siteId: scope?.siteId || '',
      site: scope?.site || '',
      notes: (notes || '').trim(),
      createdAt: serverTimestamp(),
      createdBy: actor?.uid || null,
      createdByName: actor?.name || '',
    })
  }
  await batch.commit()
  await logAudit(orgId, actor, 'training.record_create', {
    module: 'training', target: 'record', targetLabel: course.name,
    summary: `Logged "${course.name}" for ${employees.length} employee(s)`,
  })
  return employees.length
}

export async function updateRecord(orgId, id, updates, actor, label) {
  await updateDoc(recordRef(orgId, id), { ...updates, updatedAt: serverTimestamp() })
  await logAudit(orgId, actor, 'training.record_update', {
    module: 'training', target: 'record', targetId: id, targetLabel: label,
    summary: `Updated training record${label ? ` "${label}"` : ''}`,
  })
}

export async function deleteRecord(orgId, id, actor, label) {
  await deleteDoc(recordRef(orgId, id))
  await logAudit(orgId, actor, 'training.record_delete', {
    module: 'training', target: 'record', targetId: id, targetLabel: label,
    summary: `Deleted training record${label ? ` "${label}"` : ''}`,
  })
}

// ── Assignments (LMS) ─────────────────────────────────────────────────────────

/**
 * Assign a course to employees with a due date — one assignment per employee,
 * skipping anyone who already has an OPEN assignment for that course. `group`
 * ({ mode, label }) stamps every doc so the Admin Workspace can show the batch
 * as one campaign (e.g. "Department: Safety"). Returns { assigned, skipped }.
 */
export async function assignCourse(orgId, { course, employees, dueDate, group }, actor, openAssignments = []) {
  const alreadyOpen = new Set(
    openAssignments
      .filter((a) => a.status === 'assigned' && a.courseId === course.id)
      .map((a) => a.employeeUid),
  )
  const targets = employees.filter((e) => !alreadyOpen.has(e.uid))
  const batchId = `asn-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  if (targets.length) {
    // Group assignments (a whole department/site/entity) can exceed the 500-op
    // Firestore batch limit — chunk the writes.
    for (let i = 0; i < targets.length; i += 400) {
      const batch = writeBatch(db)
      for (const emp of targets.slice(i, i + 400)) {
        batch.set(doc(assignmentCol(orgId)), {
          courseId: course.id,
          courseName: course.name,
          category: course.category || 'Other',
          employeeUid: emp.uid,
          employeeName: emp.name || emp.email || 'Unknown',
          dueDate: dueDate || '',
          status: 'assigned',
          batchId,
          groupMode: group?.mode || 'people',
          groupLabel: group?.label || 'Individual selection',
          assignedBy: actor?.uid || null,
          assignedByName: actor?.name || '',
          createdAt: serverTimestamp(),
        })
      }
      await batch.commit()
    }
    await logAudit(orgId, actor, 'training.assign', {
      module: 'training', target: 'assignment', targetLabel: course.name,
      summary: `Assigned "${course.name}" to ${targets.length} employee(s)${group?.label ? ` (${group.label})` : ''}${dueDate ? `, due ${dueDate}` : ''}`,
    })
  }
  return { assigned: targets.length, skipped: employees.length - targets.length, batchId }
}

/** Cancel many open assignments at once (whole campaign), chunked. */
export async function cancelAssignmentsBulk(orgId, ids, actor, label) {
  for (let i = 0; i < ids.length; i += 400) {
    const batch = writeBatch(db)
    for (const id of ids.slice(i, i + 400)) batch.update(assignmentRef(orgId, id), { status: 'cancelled' })
    await batch.commit()
  }
  await logAudit(orgId, actor, 'training.assign_cancel', {
    module: 'training', target: 'assignment', targetLabel: label || '',
    summary: `Cancelled ${ids.length} open assignment(s)${label ? ` — ${label}` : ''}`,
  })
}

export async function cancelAssignment(orgId, id, actor, label) {
  await updateDoc(assignmentRef(orgId, id), { status: 'cancelled' })
  await logAudit(orgId, actor, 'training.assign_cancel', {
    module: 'training', target: 'assignment', targetId: id, targetLabel: label,
    summary: `Cancelled assignment${label ? ` "${label}"` : ''}`,
  })
}

/**
 * Learner self-completion from "My Learning": creates the training record
 * (flagged loggedBy 'self') and closes the employee's open assignment(s) for
 * the course, atomically.
 */
export async function selfCompleteTraining(orgId, { course, profile, assignmentIds = [] }, actor) {
  const completedOn = todayISO()
  const expiresOn = computeExpiry(completedOn, course.validityMonths)
  const batch = writeBatch(db)
  const rref = doc(recordCol(orgId))
  batch.set(rref, {
    courseId: course.id,
    courseName: course.name,
    category: course.category || 'Other',
    validityMonths: Number(course.validityMonths) || 0,
    employeeUid: profile.uid,
    employeeName: profile.name || profile.email || 'Unknown',
    trainerName: '',
    completedOn,
    expiresOn,
    region: '', entity: '', siteId: '', site: '',
    notes: '',
    loggedBy: 'self',
    createdAt: serverTimestamp(),
    createdBy: profile.uid,
    createdByName: profile.name || '',
  })
  for (const id of assignmentIds) {
    batch.update(assignmentRef(orgId, id), { status: 'completed', completedOn, recordId: rref.id })
  }
  await batch.commit()
  await logAudit(orgId, actor, 'training.self_complete', {
    module: 'training', target: 'record', targetId: rref.id, targetLabel: course.name,
    summary: `Self-completed "${course.name}"`,
  })
  return rref.id
}

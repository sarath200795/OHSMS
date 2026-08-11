// ─────────────────────────────────────────────────────────────────────────────
// Illness reporting data access (occupational health). Standalone records,
// optionally linked to an incident. Corrective actions live embedded and feed
// the cross-source Action Tracker. Files (attachments) live in a base64
// subcollection. Dashboard illness aggregates are derived client-side, so there
// is no stats-counter bucket here — only a running reference-number counter.
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
  orderBy,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  limit,
  increment,
} from 'firebase/firestore'
import { db } from '../firebase'
import { logAudit } from './firestore'
import { AUDIT, diffSummary } from './audit'
// Reference numbers are issued by the same transactional reserver incidents
// use; only the counter document and the prefix differ.
import { reserveRefNo } from './incidents'
import { reserveDocId } from '../../../shared/docId/reserve'
import { putFile, removeFile, MAX_INLINE_BYTES, tooLargeForInline } from '../../../shared/storage'

const illnessCol = (orgId) => collection(db, 'organizations', orgId, 'illnesses')
const illnessRef = (orgId, id) => doc(db, 'organizations', orgId, 'illnesses', id)
const fileCol = (orgId, id) => collection(db, 'organizations', orgId, 'illnesses', id, 'files')
const fileRef = (orgId, id, fid) => doc(db, 'organizations', orgId, 'illnesses', id, 'files', fid)
const counterRef = (orgId) => doc(db, 'organizations', orgId, 'meta', 'illness')

export const ILLNESS_LOAD_CAP = 2000

export async function createIllness(orgId, actor, initial = {}) {
  // Both identifiers are reserved before anything is written, so a failure to
  // issue one leaves no half-created record behind — only an unused number.
  const refNo = await reserveRefNo(counterRef(orgId), 'ILL')
  const docId = await reserveDocId(orgId, 'illnesses')
  const ref = doc(illnessCol(orgId))
  const illness = {
    // See createIncident: docId is the org-wide id, refNo is kept for records
    // and correspondence that already quote the older number.
    docId,
    refNo,
    lifecycle: 'reporting',
    stagesDone: { initial: false, actions: false },
    deletedAt: null,
    closedAt: null,
    closedBy: null,
    linkedIncidentId: initial.linkedIncidentId || null,
    // Initial reporting
    affectedPersonnel: initial.affectedPersonnel || [],
    date: initial.date || '',
    time: initial.time || '',
    location: initial.location || '',
    region: initial.region || '',
    entity: initial.entity || '',
    siteId: initial.siteId || '',
    site: initial.site || '',
    exposedToAgent: initial.exposedToAgent || '',
    exposureDuration: initial.exposureDuration || '',
    ppe: initial.ppe || [],
    healthIssue: initial.healthIssue || '',
    affectedBodyParts: initial.affectedBodyParts || [],
    fileCount: 0,
    // Corrective actions
    actions: [],
    createdBy: actor?.uid || null,
    createdByName: actor?.name || '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }
  await setDoc(ref, illness)
  await logAudit(orgId, actor, AUDIT.ILLNESS_CREATE, {
    target: 'illness',
    targetId: ref.id,
    targetLabel: illness.refNo,
    summary: `Illness ${illness.refNo} created`,
  })
  return ref.id
}

export async function updateIllness(orgId, id, updates, opts = {}) {
  const current = await getDoc(illnessRef(orgId, id))
  if (!current.exists()) throw new Error('Illness not found')
  const before = current.data()
  await updateDoc(illnessRef(orgId, id), { ...updates, updatedAt: serverTimestamp() })
  if (!opts.silent) {
    const merged = { ...before }
    for (const [k, v] of Object.entries(updates)) if (!k.includes('.')) merged[k] = v
    await logAudit(orgId, opts.actor, opts.action || AUDIT.ILLNESS_UPDATE, {
      target: 'illness',
      targetId: id,
      targetLabel: before.refNo || id,
      summary: opts.summary || diffSummary(before, merged),
    })
  }
}

export async function getIllness(orgId, id) {
  const snap = await getDoc(illnessRef(orgId, id))
  return snap.exists() ? { id, ...snap.data() } : null
}

export function subscribeIllnesses(orgId, cb, max = ILLNESS_LOAD_CAP) {
  const q = query(illnessCol(orgId), orderBy('createdAt', 'desc'), limit(max))
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
}

export async function closeIllness(orgId, id, actor) {
  await updateIllness(orgId, id, {
    lifecycle: 'closed',
    'stagesDone.actions': true,
    closedAt: serverTimestamp(),
    closedBy: actor?.name || '',
  }, { actor, action: AUDIT.ILLNESS_CLOSE, summary: 'Illness closed' })
}

export async function deleteIllness(orgId, id, actor) {
  const snap = await getDoc(illnessRef(orgId, id))
  if (!snap.exists()) return
  const before = snap.data()
  await updateDoc(illnessRef(orgId, id), { deletedAt: serverTimestamp(), deletedBy: actor?.name || '' })
  await logAudit(orgId, actor, AUDIT.ILLNESS_DELETE, { target: 'illness', targetId: id, targetLabel: before.refNo || id })
}

export async function restoreIllness(orgId, id, actor) {
  const snap = await getDoc(illnessRef(orgId, id))
  if (!snap.exists()) return
  const data = snap.data()
  await updateDoc(illnessRef(orgId, id), { deletedAt: null, deletedBy: null, updatedAt: serverTimestamp() })
  await logAudit(orgId, actor, AUDIT.ILLNESS_RESTORE, { target: 'illness', targetId: id, targetLabel: data.refNo || id })
}

export async function purgeIllness(orgId, id, actor, label) {
  const files = await getDocs(fileCol(orgId, id))
  files.docs.forEach((d) => { if (d.data().path) removeFile(d.data().path) })
  const batch = writeBatch(db)
  files.docs.forEach((d) => batch.delete(d.ref))
  batch.delete(illnessRef(orgId, id))
  await batch.commit()
  await logAudit(orgId, actor, AUDIT.ILLNESS_PURGE, { target: 'illness', targetId: id, targetLabel: label || id })
}

// ── Files (base64 subcollection) ──────────────────────────────────────────────
export async function addIllnessFile(orgId, id, file) {
  // Same cloud-first-with-inline-fallback contract as incident photos.
  const up = file.dataUrl ? await putFile(orgId, 'illness-files', file.dataUrl, file.name) : null
  if (!up && file.dataUrl && (file.size || 0) > MAX_INLINE_BYTES) {
    throw new Error(tooLargeForInline(file.name))
  }
  const ref = await addDoc(fileCol(orgId, id), {
    name: file.name || '',
    type: file.type || '',
    dataUrl: up ? '' : file.dataUrl,
    url: up?.url || '',
    path: up?.path || '',
    size: file.size || 0,
    caption: file.caption || '',
    uploadedBy: file.uploadedBy || '',
    uploadedAt: serverTimestamp(),
  })
  await updateDoc(illnessRef(orgId, id), { fileCount: increment(1), updatedAt: serverTimestamp() })
  return ref.id
}

export function subscribeIllnessFiles(orgId, id, cb) {
  const q = query(fileCol(orgId, id), orderBy('uploadedAt', 'asc'))
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => {
    const data = d.data()
    return { id: d.id, ...data, dataUrl: data.dataUrl || data.url || '' }
  })))
}

export async function deleteIllnessFile(orgId, id, fileId) {
  try {
    const snap = await getDoc(fileRef(orgId, id, fileId))
    if (snap.data()?.path) removeFile(snap.data().path)
  } catch { /* orphan tolerated */ }
  await deleteDoc(fileRef(orgId, id, fileId))
  await updateDoc(illnessRef(orgId, id), { fileCount: increment(-1), updatedAt: serverTimestamp() })
}

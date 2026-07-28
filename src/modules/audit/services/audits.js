import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { db } from '../lib/firebase'

const col = (orgId) => collection(db, 'organizations', orgId, 'audits')

// A starter ISO 45001 clause checklist for new audits.
export const ISO_45001_CLAUSES = [
  { ref: '4', requirement: 'Context of the organization' },
  { ref: '5', requirement: 'Leadership & worker participation' },
  { ref: '6', requirement: 'Planning (risks, objectives)' },
  { ref: '7', requirement: 'Support (resources, competence, awareness)' },
  { ref: '8', requirement: 'Operation (operational controls, emergency)' },
  { ref: '9', requirement: 'Performance evaluation (monitoring, internal audit)' },
  { ref: '10', requirement: 'Improvement (incidents, nonconformity, CAPA)' },
]

export function buildClauseChecklist() {
  return ISO_45001_CLAUSES.map((c) => ({
    ...c,
    conformity: 'pending', // 'conforming' | 'minor_nc' | 'major_nc' | 'na' | 'pending'
    notes: '',
  }))
}

export function subscribeAudits(orgId, callback) {
  const q = query(col(orgId), orderBy('scheduledDate', 'asc'))
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
  })
}

export function subscribeAudit(orgId, auditId, callback) {
  const ref = doc(db, 'organizations', orgId, 'audits', auditId)
  return onSnapshot(ref, (snap) => {
    callback(snap.exists() ? { id: snap.id, ...snap.data() } : null)
  })
}

export function createAudit(orgId, data) {
  return addDoc(col(orgId), {
    standard: 'ISO 45001',
    status: 'planned',
    clauses: buildClauseChecklist(),
    ...data,
    createdAt: serverTimestamp(),
  })
}

export function updateAudit(orgId, auditId, data) {
  return updateDoc(doc(db, 'organizations', orgId, 'audits', auditId), data)
}

export function deleteAudit(orgId, auditId) {
  return deleteDoc(doc(db, 'organizations', orgId, 'audits', auditId))
}

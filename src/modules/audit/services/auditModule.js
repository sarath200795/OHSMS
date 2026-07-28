import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { db } from '../lib/firebase'

// Faithful to the original portal's Internal Audit data model:
//   organizations/{orgId}/auditPlans     — schedules with an execution matrix
//   organizations/{orgId}/auditFindings  — executed audits with findings + CAPA
const plansCol = (orgId) => collection(db, 'organizations', orgId, 'auditPlans')
const findingsCol = (orgId) =>
  collection(db, 'organizations', orgId, 'auditFindings')

export function subscribeAuditPlans(orgId, callback) {
  return onSnapshot(plansCol(orgId), (snap) => {
    callback(snap.docs.map((d) => ({ firebaseKey: d.id, ...d.data() })))
  })
}

export function subscribeAuditFindings(orgId, callback) {
  return onSnapshot(findingsCol(orgId), (snap) => {
    callback(snap.docs.map((d) => ({ firebaseKey: d.id, ...d.data() })))
  })
}

export async function createAuditPlan(orgId, payload) {
  const ref = await addDoc(plansCol(orgId), {
    ...payload,
    createdAt: payload.createdAt || new Date().toISOString(),
    _serverCreatedAt: serverTimestamp(),
  })
  return ref.id
}

export async function createAuditFinding(orgId, payload) {
  const ref = await addDoc(findingsCol(orgId), {
    ...payload,
    _serverCreatedAt: serverTimestamp(),
  })
  return ref.id
}

export function updateAuditFinding(orgId, firebaseKey, data) {
  return updateDoc(
    doc(db, 'organizations', orgId, 'auditFindings', firebaseKey),
    data,
  )
}

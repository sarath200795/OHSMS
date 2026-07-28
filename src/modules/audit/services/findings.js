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

const col = (orgId) => collection(db, 'organizations', orgId, 'findings')

export const SEVERITIES = ['observation', 'minor', 'major']
export const FINDING_STATUSES = ['open', 'in_progress', 'closed']

export function subscribeFindings(orgId, callback) {
  const q = query(col(orgId), orderBy('raisedAt', 'desc'))
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
  })
}

export function subscribeFinding(orgId, findingId, callback) {
  const ref = doc(db, 'organizations', orgId, 'findings', findingId)
  return onSnapshot(ref, (snap) => {
    callback(snap.exists() ? { id: snap.id, ...snap.data() } : null)
  })
}

export function createFinding(orgId, data) {
  return addDoc(col(orgId), {
    status: 'open',
    severity: 'minor',
    ...data,
    raisedAt: serverTimestamp(),
  })
}

export function updateFinding(orgId, findingId, data) {
  return updateDoc(doc(db, 'organizations', orgId, 'findings', findingId), data)
}

export function deleteFinding(orgId, findingId) {
  return deleteDoc(doc(db, 'organizations', orgId, 'findings', findingId))
}

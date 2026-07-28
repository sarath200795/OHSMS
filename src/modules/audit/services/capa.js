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

const col = (orgId) => collection(db, 'organizations', orgId, 'capas')

export const CAPA_STATUSES = ['open', 'in_progress', 'verified', 'closed']

export function subscribeCapas(orgId, callback) {
  const q = query(col(orgId), orderBy('createdAt', 'desc'))
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
  })
}

export function createCapa(orgId, data) {
  return addDoc(col(orgId), {
    status: 'open',
    ...data,
    createdAt: serverTimestamp(),
  })
}

export function updateCapa(orgId, capaId, data) {
  return updateDoc(doc(db, 'organizations', orgId, 'capas', capaId), data)
}

export function deleteCapa(orgId, capaId) {
  return deleteDoc(doc(db, 'organizations', orgId, 'capas', capaId))
}

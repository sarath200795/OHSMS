import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  limit,
} from 'firebase/firestore'
import { db } from '../../../shared/firebase'

const col = (orgId) => collection(db, 'organizations', orgId, 'capas')

export const CAPA_STATUSES = ['open', 'in_progress', 'verified', 'closed']

export function subscribeCapas(orgId, callback) {
  const q = query(col(orgId), orderBy('createdAt', 'desc'), limit(1000))
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

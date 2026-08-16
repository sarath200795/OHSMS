import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { db } from '../../../shared/firebase'

const COL = 'technicians'

export function subscribeTechnicians(orgId, cb, onError) {
  const q = query(collection(db, COL), where('orgId', '==', orgId))
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      items.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      cb(items)
    },
    onError,
  )
}

export async function addTechnician({ orgId, name, lockNo, contact }, user) {
  return addDoc(collection(db, COL), {
    orgId,
    name: name.trim(),
    lockNo: (lockNo || '').trim(),
    contact: (contact || '').trim(),
    active: true,
    createdBy: user.id,
    createdAt: serverTimestamp(),
  })
}

export async function updateTechnician(id, patch) {
  return updateDoc(doc(db, COL, id), patch)
}

export async function deleteTechnician(id) {
  return deleteDoc(doc(db, COL, id))
}

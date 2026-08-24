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
  limit,
} from 'firebase/firestore'
import { db } from '../../../shared/firebase'
import { COLLECTION_READ_CAP } from '../../../shared/org/orgData'

const COL = 'locks'

export function subscribeLocks(orgId, cb, onError) {
  const q = query(collection(db, COL), where('orgId', '==', orgId), limit(COLLECTION_READ_CAP))
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      items.sort((a, b) => (a.lockNo || '').localeCompare(b.lockNo || '', undefined, { numeric: true }))
      cb(items)
    },
    onError,
  )
}

export async function addLock({ orgId, lockNo, type }, user) {
  return addDoc(collection(db, COL), {
    orgId,
    lockNo: (lockNo || '').trim(),
    type: type === 'department' ? 'department' : 'personal',
    active: true,
    createdBy: user.id,
    createdAt: serverTimestamp(),
  })
}

export async function updateLock(id, patch) {
  return updateDoc(doc(db, COL, id), patch)
}

export async function deleteLock(id) {
  return deleteDoc(doc(db, COL, id))
}

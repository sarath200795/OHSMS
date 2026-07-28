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
import { db } from '../firebase/config'

const COL = 'sites'

export function subscribeSites(orgId, cb, onError) {
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

export async function addSite({ orgId, name }, user) {
  return addDoc(collection(db, COL), {
    orgId,
    name: name.trim(),
    active: true,
    createdBy: user.id,
    createdAt: serverTimestamp(),
  })
}

export async function updateSite(id, patch) {
  return updateDoc(doc(db, COL, id), patch)
}

export async function deleteSite(id) {
  return deleteDoc(doc(db, COL, id))
}

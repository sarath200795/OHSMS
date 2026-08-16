import {
  collection,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore'
import { db } from '../../../shared/firebase'

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

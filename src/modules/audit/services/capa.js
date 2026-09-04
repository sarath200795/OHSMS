import { collection, onSnapshot, orderBy, query, limit } from 'firebase/firestore'
import { onReadError } from '../../../shared/org/readError'
import { db } from '../../../shared/firebase'

// Reads only — see the note in audits.js. createCapa and updateCapa were part
// of the superseded data model and had no callers.
const col = (orgId) => collection(db, 'organizations', orgId, 'capas')

export function subscribeCapas(orgId, callback) {
  const q = query(col(orgId), orderBy('createdAt', 'desc'), limit(1000))
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onReadError('corrective actions', callback),
  )
}

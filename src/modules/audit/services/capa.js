import { collection, onSnapshot, orderBy, query, limit } from 'firebase/firestore'
import { db } from '../../../shared/firebase'
import { snapshotHandlers } from './snapshotError'

// Reads only — see the note in audits.js. createCapa and updateCapa were part
// of the superseded data model and had no callers.
const col = (orgId) => collection(db, 'organizations', orgId, 'capas')

export function subscribeCapas(orgId, callback) {
  const q = query(col(orgId), orderBy('createdAt', 'desc'), limit(1000))
  const h = snapshotHandlers('CAPAs', callback)
  return onSnapshot(q, (snap) => {
    h.ok(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
  }, h.err)
}

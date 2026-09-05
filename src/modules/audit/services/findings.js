import { collection, onSnapshot, orderBy, query, limit } from 'firebase/firestore'
import { onReadError } from '../../../shared/org/readError'
import { db } from '../../../shared/firebase'

// Reads only — see the note in audits.js. subscribeFinding, createFinding,
// updateFinding and deleteFinding were part of the superseded data model and
// had no callers.
const col = (orgId) => collection(db, 'organizations', orgId, 'findings')

export function subscribeFindings(orgId, callback) {
  const q = query(col(orgId), orderBy('raisedAt', 'desc'), limit(1000))
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onReadError('findings', callback),
  )
}

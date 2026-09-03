import { collection, onSnapshot, orderBy, query, limit } from 'firebase/firestore'
import { db } from '../../../shared/firebase'
import { snapshotHandlers } from './snapshotError'

// Reads only. The write path that used to live here — createAudit,
// updateAudit, deleteAudit, subscribeAudit, and the ISO 45001 clause checklist
// they seeded — belonged to an EARLIER data model and nothing called it.
//
// The Internal Audit module people actually use writes to auditPlans and
// auditFindings through services/auditModule.js. These `audits` documents are
// still subscribed to by OrgDataContext, so the read stays; the unreachable
// half was removed rather than left looking like a supported way in.
const col = (orgId) => collection(db, 'organizations', orgId, 'audits')

export function subscribeAudits(orgId, callback) {
  const q = query(col(orgId), orderBy('scheduledDate', 'asc'), limit(1000))
  const h = snapshotHandlers('audits', callback)
  return onSnapshot(q, (snap) => {
    h.ok(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
  }, h.err)
}

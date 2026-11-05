// ─────────────────────────────────────────────────────────────────────────────
// Shared data-access base for the incidents module: the live org document and
// the append-only audit log. Domain data (incidents, illnesses) lives in its
// own module (incidents.js / illnesses.js) which reuses these helpers.
//
// User administration and the org-wide audit viewer are not here. Those pages
// were the unrouted IRA copies; the live ones are src/pages/admin and they
// write through shared/org/orgData.js. A second writer here used different
// action strings (`user.status` rather than `user.status.update`).
// ─────────────────────────────────────────────────────────────────────────────
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../../../shared/firebase'
import { onReadError } from '../../../shared/org/readError'
import { logAudit as logOrgAudit } from '../../../shared/org/orgData'

const orgRef = (orgId) => doc(db, 'organizations', orgId)

// ── Audit log ─────────────────────────────────────────────────────────────────
// One implementation, in shared/org/orgData; this wrapper adds only the module
// key and the default target. The private copy it replaces omitted `module`, so
// entries written through incidents.js / illnesses.js / injuries.js displayed as
// "Core" in Admin → Audit Log — while pages/Incidents.jsx called the shared one
// directly, so the same module was writing two different shapes.
export const logAudit = (orgId, actor, action, details = {}) =>
  logOrgAudit(orgId, actor, action, { module: 'incidents', target: 'incident', ...details })

// Delegated to the shared ref-counted org-users listener (one per org app-wide).
export { subscribeOrgUsers } from '../../../shared/org/orgData'

/** Live org document. */
export function subscribeOrg(orgId, cb) {
  return onSnapshot(
    orgRef(orgId),
    (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    onReadError('the organization', cb, null)
  )
}

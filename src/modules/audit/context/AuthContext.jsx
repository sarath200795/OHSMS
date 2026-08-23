// Adapter: internal-audit-portal's code expects useAuth to expose
// `firebaseUser`, `org` and `logout` (plus profile/isAdmin/isApproved). Map the
// unified auth onto that shape, and roles onto its admin/auditor/member model —
// note this is the one module that keeps `auditor` as a distinct role rather
// than collapsing it to member.
import { createModuleAuth } from '../../../shared/auth/moduleAuth'

export { AuthProvider } from '../../../shared/auth/AuthContext'

const ROLE_MAP = { admin: 'admin', manager: 'admin', member: 'member', auditor: 'auditor' }

export const useAuth = createModuleAuth(ROLE_MAP, 'member', (a) => ({
  firebaseUser: a.user,
  org: { id: a.orgId, name: a.orgName },
  logout: a.signOut,
}))

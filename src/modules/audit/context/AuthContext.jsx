// Adapter: internal-audit-portal's code expects useAuth to expose `firebaseUser`,
// `org`, and `logout` (plus profile/isAdmin/isApproved). Map the unified auth
// onto that shape, and map roles onto its admin / auditor / member model.
import { useAuth as useSharedAuth } from '../../../shared/auth/AuthContext'

export { AuthProvider } from '../../../shared/auth/AuthContext'

const ROLE_MAP = { admin: 'admin', manager: 'admin', member: 'member', auditor: 'auditor' }

export function useAuth() {
  const a = useSharedAuth()
  const role = ROLE_MAP[a.role] || 'member'
  return {
    ...a,
    role,
    firebaseUser: a.user,
    org: { id: a.orgId, name: a.orgName },
    logout: a.signOut,
    profile: a.profile ? { ...a.profile, role, uid: a.user?.uid } : a.profile,
    isAdmin: a.isAdmin,
  }
}

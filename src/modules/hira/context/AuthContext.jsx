// Adapter: map the unified platform roles onto this module's admin/member model.
import { useAuth as useSharedAuth } from '../../../shared/auth/AuthContext'

export { AuthProvider } from '../../../shared/auth/AuthContext'

const ROLE_MAP = { admin: 'admin', manager: 'admin', member: 'member', auditor: 'member' }

export function useAuth() {
  const a = useSharedAuth()
  const role = ROLE_MAP[a.role] || 'member'
  return {
    ...a,
    role,
    profile: a.profile ? { ...a.profile, role, uid: a.user?.uid } : a.profile,
    isAdmin: a.isAdmin,
  }
}

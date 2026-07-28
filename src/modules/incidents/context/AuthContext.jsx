// Adapter: the ported incident-ira code imports `useAuth` from its own
// AuthContext (role vocabulary: reporter < investigator < admin). Map the
// unified platform roles (admin/manager/member/auditor) onto that vocabulary so
// the module's permission checks (can(role, …)) and role gates work unchanged.
import { useAuth as useSharedAuth } from '../../../shared/auth/AuthContext'

export { AuthProvider } from '../../../shared/auth/AuthContext'

const ROLE_MAP = {
  admin: 'admin',
  manager: 'investigator',
  member: 'reporter',
  auditor: 'auditor', // read-only: unknown to the module's can() → all checks false
}

export function useAuth() {
  const a = useSharedAuth()
  const role = ROLE_MAP[a.role] || 'reporter'
  return {
    ...a,
    role,
    profile: a.profile ? { ...a.profile, role } : a.profile,
    isAdmin: a.isAdmin,
    isInvestigator: a.role === 'admin' || a.role === 'manager',
  }
}

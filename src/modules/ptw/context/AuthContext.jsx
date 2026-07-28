// Adapter: map unified platform roles onto permit-to-work's role model
// (admin / engineering / operations / technician) and expose the derived
// isAdmin / isApprover flags the module's UI and PermitContext expect.
import { useAuth as useSharedAuth } from '../../../shared/auth/AuthContext'
import { ROLES, isApprover as roleIsApprover, isAdmin as roleIsAdmin } from '../lib/permissions'

export { AuthProvider } from '../../../shared/auth/AuthContext'

const ROLE_MAP = {
  admin: ROLES.ADMIN,
  manager: ROLES.ADMIN, // safety officer → full approve/close authority
  member: ROLES.TECHNICIAN, // create permits
  auditor: ROLES.TECHNICIAN,
}

export function useAuth() {
  const a = useSharedAuth()
  const role = ROLE_MAP[a.role] || ROLES.TECHNICIAN
  const profile = a.profile
    ? { ...a.profile, role, roles: [role], uid: a.user?.uid }
    : a.profile
  return {
    ...a,
    role,
    profile,
    isAdmin: roleIsAdmin(role),
    isApprover: roleIsApprover(role),
  }
}

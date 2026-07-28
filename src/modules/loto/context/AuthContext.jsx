// Adapter: hecp-loto's code expects useAuth to expose a permission function
// `can(permission)`, plus firebaseUser / profileStatus / org / authReady / logout.
// Map the unified roles onto loto's role→permission model and derive `can`.
import { useAuth as useSharedAuth } from '../../../shared/auth/AuthContext'
import { ROLES, ROLE_PERMISSIONS } from '../constants/roles'

export { AuthProvider } from '../../../shared/auth/AuthContext'

const ROLE_MAP = {
  admin: ROLES.ADMIN,
  manager: ROLES.SAFETY, // safety officer
  member: ROLES.TECHNICIAN,
  auditor: ROLES.TECHNICIAN,
}

export function useAuth() {
  const a = useSharedAuth()
  const role = ROLE_MAP[a.role] || ROLES.TECHNICIAN
  const perms = ROLE_PERMISSIONS[role] || []
  const can = (permission) => a.isAdmin || perms.includes(permission)
  // hecp-loto's ported code writes user.id / user.displayName on every record.
  // The unified profile exposes uid / name, so map them across (and expose id +
  // displayName) to keep those Firestore writes valid.
  const uid = a.user?.uid
  const profile = a.profile
    ? { ...a.profile, role, uid, id: uid, displayName: a.profile.name || a.user?.displayName || a.profile.email || 'Unknown' }
    : a.profile
  return {
    ...a,
    role,
    profile,
    can,
    firebaseUser: a.user,
    profileStatus: a.profile?.status || (a.loading ? 'loading' : 'none'),
    org: { id: a.orgId, name: a.orgName },
    authReady: !a.loading,
    logout: a.signOut,
    isAdmin: a.isAdmin,
  }
}

// Adapter: hecp-loto's code expects useAuth to expose a permission function
// `can(permission)`, plus firebaseUser / profileStatus / org / authReady /
// logout. Map the unified roles onto loto's role→permission model and derive
// `can`.
import { createModuleAuth } from '../../../shared/auth/moduleAuth'
import { ROLES, ROLE_PERMISSIONS } from '../constants/roles'

export { AuthProvider } from '../../../shared/auth/AuthContext'

const ROLE_MAP = {
  admin: ROLES.ADMIN,
  manager: ROLES.SAFETY, // safety officer
  member: ROLES.TECHNICIAN,
  auditor: ROLES.TECHNICIAN,
}

export const useAuth = createModuleAuth(ROLE_MAP, ROLES.TECHNICIAN, (a, role, profile) => {
  const perms = ROLE_PERMISSIONS[role] || []
  return {
    // hecp-loto's ported code writes user.id / user.displayName onto every
    // record, while the unified profile carries uid / name. Map them across so
    // those Firestore writes stay valid.
    profile: profile
      ? {
          ...profile,
          id: profile.uid,
          displayName: profile.name || a.user?.displayName || profile.email || 'Unknown',
        }
      : profile,
    can: (permission) => a.isAdmin || perms.includes(permission),
    firebaseUser: a.user,
    profileStatus: a.profile?.status || (a.loading ? 'loading' : 'none'),
    org: { id: a.orgId, name: a.orgName },
    authReady: !a.loading,
    logout: a.signOut,
  }
})

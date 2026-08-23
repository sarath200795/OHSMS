// Adapter: map the unified platform roles onto this module's admin/member
// model. See shared/auth/moduleAuth.js for why this indirection exists.
import { createModuleAuth, ADMIN_MEMBER_ROLES } from '../../../shared/auth/moduleAuth'

export { AuthProvider } from '../../../shared/auth/AuthContext'

export const useAuth = createModuleAuth(ADMIN_MEMBER_ROLES, 'member')

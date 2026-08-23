// Adapter: the ported incident-ira code imports `useAuth` from its own
// AuthContext (role vocabulary: reporter < investigator < admin). Map the
// unified platform roles onto that vocabulary so the module's permission checks
// (can(role, …)) and role gates work unchanged.
import { createModuleAuth } from '../../../shared/auth/moduleAuth'

export { AuthProvider } from '../../../shared/auth/AuthContext'

const ROLE_MAP = {
  admin: 'admin',
  manager: 'investigator',
  member: 'reporter',
  auditor: 'auditor', // read-only: unknown to the module's can() → all checks false
}

export const useAuth = createModuleAuth(ROLE_MAP, 'reporter', (a) => ({
  // Deliberately derived from the PLATFORM role, not the mapped one: 'auditor'
  // maps to a role the module's can() does not know, and this flag must stay
  // false for them rather than accidentally following the mapping.
  isInvestigator: a.role === 'admin' || a.role === 'manager',
}))

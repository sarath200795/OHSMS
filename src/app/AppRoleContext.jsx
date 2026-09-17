// ─────────────────────────────────────────────────────────────────────────────
// Which frontend this bundle is.
//
// combined — npm run dev / e2e. One SPA, every route. Default.
// shell    — sign-in, onboarding, portal, admin, platform. Launches modules.
// module   — one operating module. Anything else is a real navigation to the
//            shell so the other SPA loads.
// ─────────────────────────────────────────────────────────────────────────────
import { createContext, useContext, useMemo } from 'react'
import { pathIsOwned } from '../shared/modules/ownership'

const AppRoleContext = createContext({
  role: 'combined',
  moduleKey: null,
  ownsPath: () => true,
  shellHref: (path) => path,
})

export function AppRoleProvider({ role = 'combined', moduleKey = null, children }) {
  const shellOrigin = (import.meta.env.VITE_SHELL_ORIGIN || '').replace(/\/$/, '')
  const value = useMemo(
    () => ({
      role,
      moduleKey,
      ownsPath: (path) => pathIsOwned(path, role, moduleKey),
      shellHref: (path) => `${shellOrigin}${path || '/'}`,
    }),
    [role, moduleKey, shellOrigin]
  )
  return <AppRoleContext.Provider value={value}>{children}</AppRoleContext.Provider>
}

// The hook is the reason this file exists; splitting it from the provider would
// just mean every caller imports two files for one concept.
// eslint-disable-next-line react-refresh/only-export-components
export function useAppRole() {
  return useContext(AppRoleContext)
}

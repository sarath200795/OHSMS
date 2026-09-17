import { Suspense, useEffect } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { isFirebaseConfigured } from '../shared/firebase'
import ProtectedRoute from '../shared/auth/ProtectedRoute'
import ModuleGate from '../shared/modules/ModuleGate'
import AppChrome from '../shared/layout/AppChrome'
import ModuleLoading from '../shared/layout/ModuleLoading'
import SamLoading from '../shared/layout/SamLoading'
import ErrorBoundary from '../shared/ErrorBoundary'
import { MODULE_BY_KEY } from '../shared/modules/registry'
import { useAppRole } from './AppRoleContext'
import SetupNeeded from '../pages/SetupNeeded'

function LeaveToShell() {
  const location = useLocation()
  const { shellHref } = useAppRole()
  const dest = location.pathname + location.search + location.hash
  useEffect(() => {
    window.location.replace(shellHref(dest))
  }, [dest, shellHref])
  return <SamLoading label="Taking you there…" />
}

/**
 * One operating module, with the same chrome and gate the combined app uses.
 * `Page` is passed in by the Vite entry so this bundle does not import every
 * other module.
 */
export default function ModuleApp({ moduleKey, Page }) {
  const mod = MODULE_BY_KEY[moduleKey]

  if (
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    window.location.search.includes('__crash=1')
  ) {
    throw new Error('Deliberate test crash (?__crash=1)')
  }

  if (!isFirebaseConfigured) {
    return (
      <Suspense fallback={<SamLoading />}>
        <Routes>
          <Route path="*" element={<SetupNeeded />} />
        </Routes>
      </Suspense>
    )
  }

  return (
    <Routes>
      {mod && Page && (
        <Route
          path={`${mod.path}/*`}
          element={
            <ProtectedRoute>
              <AppChrome>
                <ErrorBoundary>
                  <Suspense fallback={<ModuleLoading />}>
                    <ModuleGate moduleKey={moduleKey}>
                      <Page />
                    </ModuleGate>
                  </Suspense>
                </ErrorBoundary>
              </AppChrome>
            </ProtectedRoute>
          }
        />
      )}
      <Route path="*" element={<LeaveToShell />} />
    </Routes>
  )
}

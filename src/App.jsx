import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { isFirebaseConfigured } from './shared/firebase'
import ProtectedRoute from './shared/auth/ProtectedRoute'
import AppChrome from './shared/layout/AppChrome'
import { FullPageLoader, SkeletonDetail } from './shared/ui'

// Public QR landing for equipment labels — no auth, so it stays outside the shell.
const QrLanding = lazy(() => import('./modules/fire/pages/QrLanding'))
const PublicPermit = lazy(() => import('./modules/ptw/pages/PublicPermit'))

// Public / auth pages (eager — small, first paint).
import SetupNeeded from './pages/SetupNeeded'
import Login from './pages/auth/Login'
import RegisterOrg from './pages/auth/RegisterOrg'
import Signup from './pages/auth/Signup'
import ForgotPassword from './pages/auth/ForgotPassword'
import PendingApproval from './pages/auth/PendingApproval'
import NotFound from './pages/NotFound'

// App pages.
import Dashboard from './pages/Dashboard'
const Users = lazy(() => import('./pages/admin/Users'))
const Sites = lazy(() => import('./pages/admin/Sites'))
const OrgSettings = lazy(() => import('./pages/admin/OrgSettings'))
const AuditLog = lazy(() => import('./pages/admin/AuditLog'))

// Modules (lazy — several pull heavy libs like react-flow / three / xlsx).
const Incidents = lazy(() => import('./modules/incidents'))
const Hira = lazy(() => import('./modules/hira'))
const Inspections = lazy(() => import('./modules/inspections'))
const Audit = lazy(() => import('./modules/audit'))
const Permits = lazy(() => import('./modules/ptw'))
const Loto = lazy(() => import('./modules/loto'))
const Equipment = lazy(() => import('./modules/fire'))
const Drills = lazy(() => import('./modules/fire/DrillsModule'))
const Committee = lazy(() => import('./modules/committee'))
const Training = lazy(() => import('./modules/training'))
const Documents = lazy(() => import('./modules/documents'))
const Actions = lazy(() => import('./modules/actions'))
const Emergency = lazy(() => import('./modules/emergency'))
const Objectives = lazy(() => import('./modules/objectives'))
const Weather = lazy(() => import('./modules/weather'))

// Employee portal — brings its own shell, so it is not wrapped in AppChrome.
const Portal = lazy(() => import('./pages/portal'))
const Analytics = lazy(() => import('./pages/analytics'))

function Protected({ children, ...guard }) {
  return (
    <ProtectedRoute {...guard}>
      <AppChrome>
        <Suspense fallback={<SkeletonDetail />}>{children}</Suspense>
      </AppChrome>
    </ProtectedRoute>
  )
}

export default function App() {
  // Dev-only crash switch so the root ErrorBoundary stays verifiable: append
  // ?__crash=1 to any URL in dev and the recovery screen must appear. Compiled
  // out of production builds by the DEV guard.
  if (import.meta.env.DEV && window.location.search.includes('__crash=1')) {
    throw new Error('Deliberate test crash (?__crash=1)')
  }

  // Without Firebase config, only the setup screen can render.
  if (!isFirebaseConfigured) {
    return (
      <Suspense fallback={<FullPageLoader />}>
        <Routes>
          <Route path="*" element={<SetupNeeded />} />
        </Routes>
      </Suspense>
    )
  }

  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<Login />} />
      <Route path="/register-org" element={<RegisterOrg />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      {/* Scanned from a printed extinguisher label — deliberately public. */}
      <Route path="/qr/:token" element={<QrLanding />} />
      {/* The QR printed on every work permit. Public: whoever scans a permit
          taped to a scaffold has no account. */}
      <Route path="/permit/:token" element={<PublicPermit />} />
      <Route path="/pending" element={<PendingApproval />} />

      {/* Employee portal. Signed in like everything else, but outside AppShell:
          the admin sidebar is the thing this surface exists to replace. */}
      <Route
        path="/portal/*"
        element={
          <ProtectedRoute>
            <Suspense fallback={<FullPageLoader />}><Portal /></Suspense>
          </ProtectedRoute>
        }
      />

      {/* App. /hub was the old home; the portal replaced it and carries the same
          module grid plus the workspace tiles, so old links land there. */}
      <Route path="/hub" element={<Navigate to="/portal" replace />} />
      <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
      <Route path="/incidents/*" element={<Protected><Incidents /></Protected>} />
      <Route path="/hira/*" element={<Protected><Hira /></Protected>} />
      <Route path="/inspections/*" element={<Protected><Inspections /></Protected>} />
      <Route path="/audit/*" element={<Protected><Audit /></Protected>} />
      <Route path="/permits/*" element={<Protected><Permits /></Protected>} />
      <Route path="/loto/*" element={<Protected><Loto /></Protected>} />
      <Route path="/equipment/*" element={<Protected><Equipment /></Protected>} />
      <Route path="/mock-drills/*" element={<Protected><Drills /></Protected>} />
      <Route path="/committee/*" element={<Protected><Committee /></Protected>} />
      <Route path="/training/*" element={<Protected><Training /></Protected>} />
      <Route path="/documents/*" element={<Protected><Documents /></Protected>} />
      <Route path="/actions/*" element={<Protected><Actions /></Protected>} />
      <Route path="/emergency-response/*" element={<Protected><Emergency /></Protected>} />
      <Route path="/objectives/*" element={<Protected><Objectives /></Protected>} />
      <Route path="/weather/*" element={<Protected><Weather /></Protected>} />

      {/* Administration */}
      <Route path="/analytics" element={<Protected><Analytics /></Protected>} />
      <Route path="/sites" element={<Protected requireCap="record.view"><Sites /></Protected>} />
      <Route path="/audit-log" element={<Protected requireCap="audit.view"><AuditLog /></Protected>} />
      <Route path="/users" element={<Protected requireAdmin><Users /></Protected>} />
      <Route path="/settings" element={<Protected requireAdmin><OrgSettings /></Protected>} />

      {/* Fallbacks */}
      {/* The portal is everyone's home. Anyone with a role above plain member
          gets to the modules from the Personal / Organization switch. */}
      <Route path="/" element={<Navigate to="/portal" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

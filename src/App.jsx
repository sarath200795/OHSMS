import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useParams } from 'react-router-dom'
import { isFirebaseConfigured } from './shared/firebase'
import ProtectedRoute from './shared/auth/ProtectedRoute'
import AppChrome from './shared/layout/AppChrome'
import ModuleLoading from './shared/layout/ModuleLoading'
import SamLoading from './shared/layout/SamLoading'

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
import Security from './pages/auth/Security'
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
const Cctv = lazy(() => import('./modules/cctv'))
const Stakeholder = lazy(() => import('./modules/stakeholder'))
// Side-effect import: registers CCTV's site-created hook eagerly, so a site
// added by someone who never opens the CCTV tab still gets its Meraki.
import './modules/cctv/registerHooks'

// Employee portal — brings its own shell, so it is not wrapped in AppChrome.
const Portal = lazy(() => import('./pages/portal'))
const Analytics = lazy(() => import('./pages/analytics'))

/**
 * The target of a scanned LOTO procedure QR.
 *
 * Kept as a redirect so the printed code stays short and the real page stays
 * the single place a procedure is rendered. `replace` so the scan does not
 * leave a dead entry in history for the back button to land on.
 */
function ProcedureScanRedirect() {
  const { id } = useParams()
  return <Navigate to={`/loto/procedures/${id}`} replace />
}

/**
 * The target of a tag scanned at an isolation point.
 *
 * Goes to the OPERATION, not the procedure. The procedure is the instruction
 * set; someone standing at a locked valve wants the live state of this
 * particular point, and the operation page is the only thing that carries it.
 *
 * The point travels as a hash so the page can bring it into view without the
 * route needing to know anything about how that page is laid out.
 */
function TagScanRedirect() {
  const { id, point } = useParams()
  return <Navigate to={`/loto/operations/${id}#point-${point}`} replace />
}

function Protected({ children, ...guard }) {
  return (
    <ProtectedRoute {...guard}>
      <AppChrome>
        <Suspense fallback={<ModuleLoading />}>{children}</Suspense>
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
      <Suspense fallback={<SamLoading />}>
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

      {/* The QR printed on a LOTO isolation procedure. It has always encoded
          `/p/<id>` (procedureScanUrl), and until now nothing served that path —
          every scan fell through to the catch-all, so the codes on the machines
          led nowhere.

          A redirect rather than a renamed URL, because those codes are printed
          and stuck to equipment: changing the generator would orphan every one
          already in the field. The short path is also the better QR — fewer
          characters means a less dense code, which matters when it is being
          scanned off a dirty machine in bad light.

          Not public, unlike the extinguisher and permit codes. A procedure is
          the instruction set for making equipment safe, and the target route is
          protected, so a scan by someone signed out lands on sign-in and
          returns here afterwards. */}
      <Route path="/p/:id" element={<ProcedureScanRedirect />} />

      {/* The tag hung at an isolation point. Opens the live operation rather
          than the procedure: a tag is printed when the lock goes on and can
          outlive the job, so pointing at live state is what stops a stale tag
          claiming a machine is still isolated. */}
      <Route path="/t/:id/:point" element={<TagScanRedirect />} />

      {/* Employee portal. Signed in like everything else, but outside AppShell:
          the admin sidebar is the thing this surface exists to replace. */}
      <Route
        path="/portal/*"
        element={
          <ProtectedRoute>
            <Suspense fallback={<SamLoading />}><Portal /></Suspense>
          </ProtectedRoute>
        }
      />

      {/* App. /hub was the old home; the portal replaced it and carries the same
          module grid plus the workspace tiles, so old links land there. */}
      <Route path="/hub" element={<Navigate to="/portal" replace />} />
      <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
      <Route path="/security" element={<Protected><Security /></Protected>} />
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
      <Route path="/cctv/*" element={<Protected><Cctv /></Protected>} />
      <Route path="/stakeholder/*" element={<Protected><Stakeholder /></Protected>} />

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

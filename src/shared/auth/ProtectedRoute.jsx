import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { can } from './permissions'
import { loginPathFor } from './continueTo'
import SamLoading from '../layout/SamLoading'
import ForcePasswordChange from '../../pages/auth/ForcePasswordChange'
import { useAppRole } from '../../app/AppRoleContext'
import CrossAppRedirect from '../../app/CrossAppRedirect'

/**
 * Guards the authenticated app. Redirects:
 *   - not signed in            → /login?next=<here> (landing module deep-links)
 *   - signed in, no profile    → /login (edge case: half-created account)
 *   - signed in, pending       → /pending
 *   - requireAdmin & not admin → /dashboard
 *   - requireCap & lacking it  → /dashboard
 */
export default function ProtectedRoute({ children, requireAdmin = false, requireCap = null }) {
  const {
    loading,
    isAuthed,
    profile,
    isApproved,
    isAdmin,
    role,
    isPlatformAdmin,
    platformAdminReady,
  } = useAuth()
  const location = useLocation()
  const { role: appRole } = useAppRole()

  const bounce = (path) =>
    appRole === 'module' ? <CrossAppRedirect to={path} /> : <Navigate to={path} replace />

  if (loading) return <SamLoading label="Getting your workspace ready…" />
  if (!isAuthed) return bounce(loginPathFor(location))
  // A platform operator belongs to no organization ON PURPOSE, so it has no
  // profile and never will — the wait below would never end for them. Send them
  // to their own console instead of a loading screen that never resolves.
  if (!profile && platformAdminReady && isPlatformAdmin) return bounce('/platform')
  // Authenticated but the profile is still resolving — wait, don't bounce to
  // /login (bouncing races the login redirect and causes a loop).
  if (!profile) return <SamLoading label="Loading your profile…" />
  // Provisioned employees must replace the temporary password before anything else.
  if (profile.mustChangePassword) return <ForcePasswordChange />
  if (!isApproved) return bounce('/pending')
  if (requireAdmin && !isAdmin) return bounce('/portal')
  if (requireCap && !can(role, requireCap)) return bounce('/portal')

  return children
}

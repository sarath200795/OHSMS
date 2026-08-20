// ─────────────────────────────────────────────────────────────────────────────
// The guard on the platform console.
//
// It does NOT go through ProtectedRoute. That guard is about membership of a
// tenant — it requires a /users profile, an approved status and an orgId, and
// bounces anyone without them to /portal. The operator is supposed to have none
// of those: a dedicated account belonging to no organization is the whole point
// of the separation, and running it through the tenant guard would either lock
// the operator out or force them to be somebody's admin.
//
// So the only questions here are: is there a session, and does it hold the
// platform grant. Both are answered against /platformAdmins, which no client
// operation can write.
//
// A signed-in account WITHOUT the grant is signed out rather than merely
// redirected. It arrived at an operator URL; leaving its session alive would
// mean a tenant user sitting on the console's doorstep with a live token, and
// the tenant app is not reachable from here anyway.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import SamLoading from '../layout/SamLoading'

export default function PlatformRoute({ children }) {
  const { loading, isAuthed, isPlatformAdmin, platformAdminReady, signOut } = useAuth()

  // Signed in, resolved, and not an operator: end the session on the way out.
  const stranded = isAuthed && platformAdminReady && !isPlatformAdmin
  useEffect(() => {
    if (stranded) signOut?.().catch(() => {})
  }, [stranded, signOut])

  // BEFORE the isAuthed test, not after. On a cold load of /platform the
  // Firebase session has not been restored yet, so isAuthed is momentarily
  // false for everyone — including the operator. Deciding then bounced them to
  // the login screen on every refresh, and worse, it meant a tenant account
  // typing this URL was redirected before the stranded branch below could run,
  // so the session it should have ended stayed alive.
  if (loading) return <SamLoading label="Checking operator access…" />
  if (!isAuthed) return <Navigate to="/platform/login" replace />
  // Rendering anything before the grant is known would show the console to a
  // tenant account for a frame.
  if (!platformAdminReady) return <SamLoading label="Checking operator access…" />
  if (!isPlatformAdmin) return <Navigate to="/platform/login" replace />

  return children
}

import { useAuth } from '../context/AuthContext'

/**
 * Renders children only when the current user's role is in `roles`.
 */
export default function RoleGate({ roles = [], children, fallback = null }) {
  const { profile } = useAuth()
  if (!profile?.role || !roles.includes(profile.role)) return fallback
  return children
}

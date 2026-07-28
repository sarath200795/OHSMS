import { useAuth } from '../context/AuthContext'

/**
 * Conditionally renders children when the current user holds `permission`.
 * Optionally renders `fallback` otherwise.
 */
export default function PermissionGate({ permission, children, fallback = null }) {
  const { can } = useAuth()
  if (!can(permission)) return fallback
  return children
}

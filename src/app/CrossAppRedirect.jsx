import { useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { useAppRole } from './AppRoleContext'
import SamLoading from '../shared/layout/SamLoading'

/**
 * Send the browser to `to`. Same-app paths stay in react-router; anything
 * owned by another app is a real navigation so that SPA loads.
 */
export default function CrossAppRedirect({ to }) {
  const { ownsPath, shellHref } = useAppRole()
  const href = shellHref(to)

  useEffect(() => {
    if (ownsPath(to)) return undefined
    window.location.replace(href)
    return undefined
  }, [ownsPath, to, href])

  if (ownsPath(to)) return <Navigate to={to} replace />
  return <SamLoading label="Taking you there…" />
}

import { forwardRef } from 'react'
import { Link } from 'react-router-dom'
import { useAppRole } from './AppRoleContext'

/**
 * A link that stays inside this SPA when it can, and becomes a real <a href>
 * when the destination belongs to another app. React-router <Link> would
 * change the URL without loading the other bundle, which is how a shell-only
 * build 404s on every module tile.
 */
const AppLink = forwardRef(function AppLink({ to, children, ...rest }, ref) {
  const { ownsPath, shellHref } = useAppRole()
  const path = typeof to === 'string' ? to : to?.pathname
  if (path && !ownsPath(path)) {
    return (
      <a href={shellHref(path)} ref={ref} {...rest}>
        {children}
      </a>
    )
  }
  return (
    <Link to={to} ref={ref} {...rest}>
      {children}
    </Link>
  )
})

export default AppLink

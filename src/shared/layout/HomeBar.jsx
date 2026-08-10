import { Link, useLocation } from 'react-router-dom'
import { Home, ChevronRight } from 'lucide-react'
import { moduleForPath } from '../modules/registry'

/**
 * Where you are, and the two ways out.
 *
 * The header carries a logo that goes to the portal, but a logo is not a
 * signpost — people do not read it as "home", and on a sub-page three levels
 * into a module there was no way back to the module's own front page at all
 * except the browser button.
 *
 * So: always an app Home, plus the module's own home whenever you are past it.
 * Rendered once here rather than added to forty pages, which also means it
 * cannot drift out of step between modules.
 *
 * Hidden on the portal itself and on the loading screens — offering "Home" to
 * someone already standing on it is noise.
 */
export default function HomeBar() {
  const { pathname } = useLocation()

  // The portal IS home. Its own sub-pages get a way back; its root gets nothing.
  const onPortal = pathname === '/portal' || pathname.startsWith('/portal/')
  if (pathname === '/portal' || pathname === '/') return null

  const mod = moduleForPath(pathname)
  // Past the module's front page — /cctv/inventory but not /cctv.
  const insideModule = mod && pathname !== mod.path

  return (
    <nav
      aria-label="Breadcrumb"
      className="mb-4 flex flex-wrap items-center gap-1 text-xs font-semibold text-ink-500"
    >
      <Link
        to="/portal"
        className="flex items-center gap-1.5 rounded-lg px-2 py-1 transition hover:bg-ink-100 hover:text-ink-800"
      >
        <Home size={13} /> Home
      </Link>

      {mod && (
        <>
          <ChevronRight size={13} className="text-ink-300" />
          {insideModule ? (
            <Link
              to={mod.path}
              className="rounded-lg px-2 py-1 transition hover:bg-ink-100 hover:text-ink-800"
            >
              {mod.label}
            </Link>
          ) : (
            // Already on the module's front page: name it, do not link it to
            // itself — a link that does nothing teaches people not to trust the
            // rest of the trail.
            <span className="px-2 py-1 text-ink-700">{mod.label}</span>
          )}
        </>
      )}

      {!mod && !onPortal && (
        <>
          <ChevronRight size={13} className="text-ink-300" />
          <span className="px-2 py-1 text-ink-700">{adminLabel(pathname)}</span>
        </>
      )}
    </nav>
  )
}

/** Admin and analytics routes are not modules, but they still need a trail. */
function adminLabel(pathname) {
  const seg = pathname.split('/').filter(Boolean)[0] || ''
  return seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, ' ')
}

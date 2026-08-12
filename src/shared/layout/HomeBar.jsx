import { Link, useLocation } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
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
 *
 * It reads as a bar rather than a line of small print because it stopped being
 * legible otherwise: the trail was 12px semibold in ink-500, which lands at
 * about 3.3:1 against the kraft background and fails AA for text that size.
 * Raising it onto a clay surface buys the contrast (ink-800 on clay-surface is
 * ~10:1) and, more usefully, gives the thing an edge — navigation that is
 * flush with the page reads as a caption for the page rather than a control.
 * The brand mark anchors the Home end so the way out is findable by shape
 * before it is read.
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
      className="mb-5 flex flex-wrap items-center gap-0.5 rounded-2xl bg-clay-surface px-2.5 py-2 text-sm font-bold shadow-clay-sm"
    >
      <Link
        to="/portal"
        className="flex items-center gap-2 rounded-xl px-2 py-1 text-ink-800 transition-colors hover:bg-clay-100 hover:text-brand-700"
      >
        {/* Decorative: the word "Home" already names this link, so announcing
            the mark as well would just make the trail read twice. */}
        <img
          src="/wehs.svg"
          alt=""
          aria-hidden="true"
          className="h-6 w-6 flex-none rounded-md shadow-clay-sm"
        />
        Home
      </Link>

      {mod && (
        <>
          <ChevronRight size={15} className="flex-none text-ink-500" />
          {insideModule ? (
            <Link
              to={mod.path}
              className="rounded-xl px-2 py-1 text-ink-700 transition-colors hover:bg-clay-100 hover:text-brand-700"
            >
              {mod.label}
            </Link>
          ) : (
            // Already on the module's front page: name it, do not link it to
            // itself — a link that does nothing teaches people not to trust the
            // rest of the trail.
            <span className="px-2 py-1 text-ink-900">{mod.label}</span>
          )}
        </>
      )}

      {!mod && !onPortal && (
        <>
          <ChevronRight size={15} className="flex-none text-ink-500" />
          <span className="px-2 py-1 text-ink-900">{adminLabel(pathname)}</span>
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

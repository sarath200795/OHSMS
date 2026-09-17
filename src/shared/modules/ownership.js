// ─────────────────────────────────────────────────────────────────────────────
// Which app owns a pathname.
//
// Combined mode (npm run dev, e2e) owns everything: one SPA, one router.
// The shell owns anything that is not a registry module. A module app owns
// only its own prefix. Cross-app links use a real <a href> so the browser
// loads the other SPA; in-app links stay on react-router.
// ─────────────────────────────────────────────────────────────────────────────
import { moduleForPath } from './registry'
import { OPERATING_APP_BY_KEY } from './apps'

export function pathIsOwned(pathname, role = 'combined', moduleKey = null) {
  if (!role || role === 'combined') return true
  const path = (typeof pathname === 'string' ? pathname : '').split('#')[0].split('?')[0]
  const mod = moduleForPath(path)
  if (role === 'shell') return !mod
  if (role === 'module') return Boolean(mod && mod.key === moduleKey)
  return true
}

/** The path prefix a standalone module app is mounted at. */
export function modulePathPrefix(moduleKey) {
  return OPERATING_APP_BY_KEY[moduleKey]?.pathPrefix || ''
}

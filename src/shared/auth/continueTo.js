// ─────────────────────────────────────────────────────────────────────────────
// Post-auth continue-to. Landing (and bookmarks) deep-link a module prefix;
// an unauthenticated visit must bounce to the shell, then resume that prefix
// once the session exists. ModuleGate still decides whether the org is
// entitled — this helper only carries the destination across /login.
//
// The destination is attacker-influenceable (it arrives as ?next= or as
// location.state.from), so it goes through safeInternalPath, and auth pages
// themselves are refused so /login?next=/login cannot loop.
// ─────────────────────────────────────────────────────────────────────────────
import { safeInternalPath } from '../safeUrl'

const AUTH_PREFIXES = [
  '/login',
  '/register-org',
  '/signup',
  '/forgot-password',
  '/pending',
  '/platform',
]

export function locationPath(location) {
  if (!location || typeof location.pathname !== 'string') return ''
  return location.pathname + (location.search || '')
}

/** An in-app path safe to resume after sign-in. Auth pages fall back. */
export function continueToPath(value, fallback = '/portal') {
  const path = safeInternalPath(value, '')
  if (!path) return fallback
  const bare = path.split('#')[0].split('?')[0]
  if (AUTH_PREFIXES.some((p) => bare === p || bare.startsWith(`${p}/`))) return fallback
  return path
}

export function continueToFromSearch(search, fallback = '/portal') {
  const raw = typeof search === 'string' ? search : ''
  const next = new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw).get('next')
  return continueToPath(next, fallback)
}

/** Where ProtectedRoute sends an unauthenticated visitor. */
export function loginPathFor(location) {
  const dest = continueToPath(locationPath(location), '')
  if (!dest) return '/login'
  return `/login?next=${encodeURIComponent(dest)}`
}

/** Append ?next= to an auth path, skipping the default landing. */
export function withContinueTo(path, next, fallback = '/portal') {
  const dest = continueToPath(next, '')
  if (!dest || dest === fallback) return path
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}next=${encodeURIComponent(dest)}`
}

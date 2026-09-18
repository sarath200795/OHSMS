// ─────────────────────────────────────────────────────────────────────────────
// Handoff from weehs-landing (https://github.com/sarath200795/weehs-landing).
//
// That site is the public front door. All six product cards open THIS origin
// (https://suite.weehs.org) — the five standalone Vercel apps are no longer
// landing destinations. OHS Suite opens the shell. The other five deep-link
// a module prefix; an unauthenticated visit bounces to /login?next=… and
// resumes that prefix after sign-in. ModuleGate (and firestore.rules) still
// decide whether the org is entitled; a placeholder org sees the locked
// screen, not a 404.
//
// Landing CONFIG.routes (assets/js/app.js) remains:
//
//   { login: '/login', register: '/register-org', join: '/signup' }
//
// A product may override those. landingProductRoutes() is what the five
// module cards should set. Paths come from OPERATING_APPS — Permit to Work
// is /permits (key ptw), Fire Marshal is /equipment (not /fire).
// ─────────────────────────────────────────────────────────────────────────────
import { OPERATING_APP_BY_KEY } from './apps'

export const PUBLIC_SHELL_ORIGIN = 'https://suite.weehs.org'

export const LANDING_ENTRY_ROUTES = [
  { path: '/login', purpose: 'sign in' },
  { path: '/register-org', purpose: 'create a new organisation (first account is admin)' },
  { path: '/signup', purpose: 'join an organisation that already exists' },
]

export const LANDING_ENTRY_PATHS = LANDING_ENTRY_ROUTES.map((r) => r.path)

// Hosts that must appear on Firebase Auth → Authorized domains (and on the
// App Check reCAPTCHA domain list) for sign-in on the shell. weehs.org itself
// does not: the landing page never runs Firebase Auth.
export const AUTH_AUTHORIZED_HOSTS = ['suite.weehs.org']

// weehs-landing product id → OHSMS registry key (null = shell).
export const LANDING_PRODUCTS = [
  { id: 'fire-marshal', name: 'Fire Marshal', moduleKey: 'equipment' },
  { id: 'hecp', name: 'HECP LOTO', moduleKey: 'loto' },
  { id: 'permit-to-work', name: 'Online Permit to Work', moduleKey: 'ptw' },
  { id: 'iso-45001-auditor', name: 'ISO 45001 Auditor', moduleKey: 'audit' },
  { id: 'hira', name: 'HIRA', moduleKey: 'hira' },
  { id: 'ohs-suite', name: 'OHS Suite', moduleKey: null },
]

export function landingOpenPath(product) {
  if (!product?.moduleKey) return '/login'
  return OPERATING_APP_BY_KEY[product.moduleKey]?.pathPrefix || '/login'
}

/** Paths landing should put on CONFIG.routes / per-product `routes`. */
export function landingProductRoutes(product) {
  const open = landingOpenPath(product)
  if (!product?.moduleKey) {
    return { login: '/login', register: '/register-org', join: '/signup' }
  }
  return {
    login: open,
    register: `/register-org?next=${encodeURIComponent(open)}`,
    join: `/signup?next=${encodeURIComponent(open)}`,
  }
}

/** Absolute URL landing should open for one of LANDING_ENTRY_PATHS. */
export function landingHandoffUrl(path, origin = PUBLIC_SHELL_ORIGIN) {
  const base = String(origin || '').replace(/\/$/, '')
  const route = LANDING_ENTRY_PATHS.includes(path) ? path : LANDING_ENTRY_PATHS[0]
  return `${base}${route}`
}

export function landingProductUrl(productId, route = 'login', origin = PUBLIC_SHELL_ORIGIN) {
  const product = LANDING_PRODUCTS.find((p) => p.id === productId)
  const base = String(origin || '').replace(/\/$/, '')
  if (!product) return `${base}/login`
  const routes = landingProductRoutes(product)
  return `${base}${routes[route] || routes.login}`
}

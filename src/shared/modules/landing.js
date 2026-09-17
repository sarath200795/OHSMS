// ─────────────────────────────────────────────────────────────────────────────
// Handoff from weehs-landing (https://github.com/sarath200795/weehs-landing).
//
// That site is the public front door. Trial / Open app / Join organisation
// links open THIS shell, not a module app. Landing's CONFIG.routes (in
// assets/js/app.js) is:
//
//   { login: '/login', register: '/register-org', join: '/signup' }
//
// Those three paths already existed here under the same names — they are not
// aliases. This file exists so a later rewrite, a new module prefix, or a
// rename of RegisterOrg cannot silently break the landing without a unit test.
//
// Canonical public origin of the shell: https://suite.weehs.org
// Landing's OHS Suite `domain` (and `hosting`, until domainsLive) must point
// there. Module apps stay under their registry prefixes and are reached from
// the shell after auth + entitlements.
// ─────────────────────────────────────────────────────────────────────────────

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

/** Absolute URL landing should open for one of LANDING_ENTRY_PATHS. */
export function landingHandoffUrl(path, origin = PUBLIC_SHELL_ORIGIN) {
  const base = String(origin || '').replace(/\/$/, '')
  const route = LANDING_ENTRY_PATHS.includes(path) ? path : LANDING_ENTRY_PATHS[0]
  return `${base}${route}`
}

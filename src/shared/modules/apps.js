// ─────────────────────────────────────────────────────────────────────────────
// Operating-module apps.
//
// The registry (registry.js) is the product list: labels, icons, dashboard
// tiles. This is the deployable-app list: one Vite entry and one hosting path
// per registry key, all talking to the same Firebase project.
//
// Kept as its own file, without lucide-react, so Node (Vite configs, tests that
// read firebase.json) can import it. A test pins that the keys and path
// prefixes here match MODULES exactly — if they drift, a module is either
// undeployable or deployed at a URL the shell will not launch.
// ─────────────────────────────────────────────────────────────────────────────

export const OPERATING_APPS = [
  { key: 'incidents', pathPrefix: '/incidents' },
  { key: 'hira', pathPrefix: '/hira' },
  { key: 'inspections', pathPrefix: '/inspections' },
  { key: 'audit', pathPrefix: '/audit' },
  { key: 'ptw', pathPrefix: '/permits' },
  { key: 'loto', pathPrefix: '/loto' },
  { key: 'equipment', pathPrefix: '/equipment' },
  { key: 'drills', pathPrefix: '/mock-drills' },
  { key: 'committee', pathPrefix: '/committee' },
  { key: 'training', pathPrefix: '/training' },
  { key: 'documents', pathPrefix: '/documents' },
  { key: 'emergency', pathPrefix: '/emergency-response' },
  { key: 'objectives', pathPrefix: '/objectives' },
  { key: 'weather', pathPrefix: '/weather' },
  { key: 'cctv', pathPrefix: '/cctv' },
  { key: 'stakeholder', pathPrefix: '/stakeholder' },
  { key: 'actions', pathPrefix: '/actions' },
]

export const OPERATING_APP_BY_KEY = Object.fromEntries(OPERATING_APPS.map((a) => [a.key, a]))

/** Hosting destination for a module SPA built by vite.apps.config.js. */
export function appIndexPath(key) {
  return `/apps/${key}/index.html`
}

/** Firebase / Vite middleware rewrites: exact prefix and everything under it. */
export function appRewrites(apps = OPERATING_APPS) {
  return apps.flatMap((a) => [
    { source: a.pathPrefix, destination: appIndexPath(a.key) },
    { source: `${a.pathPrefix}/**`, destination: appIndexPath(a.key) },
  ])
}

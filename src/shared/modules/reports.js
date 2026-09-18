// ─────────────────────────────────────────────────────────────────────────────
// Per-module reports.
//
// Each operating app owns a reports surface at `<pathPrefix>/reports`. The
// shell `/analytics` page is a cross-suite rollup in addition to that, not a
// substitute: a Fire Marshal tenant that never opens the portal still needs
// equipment figures, and a HIRA app that is not in the analytics tab list
// still needs a risk report.
//
// Paths are derived from OPERATING_APPS so a module that gains a prefix cannot
// silently miss a reports URL. Kept lucide-free so Node tests can import it
// the same way they import apps.js.
// ─────────────────────────────────────────────────────────────────────────────
import { OPERATING_APPS } from './apps.js'

export const REPORTS_SEGMENT = 'reports'

/** Module-app reports URL for a path prefix (`/incidents` → `/incidents/reports`). */
export function moduleReportsPath(pathPrefix) {
  return `${pathPrefix}/${REPORTS_SEGMENT}`
}

export const MODULE_REPORTS = OPERATING_APPS.map((a) => ({
  key: a.key,
  pathPrefix: a.pathPrefix,
  reportsPath: moduleReportsPath(a.pathPrefix),
}))

export const MODULE_REPORTS_BY_KEY = Object.fromEntries(MODULE_REPORTS.map((r) => [r.key, r]))

/**
 * Secondary-nav entry for a module's reports tab.
 *
 * Icon is left to the caller so this file stays Node-importable. `end` is set
 * so a deeper path under reports does not keep the tab pressed.
 */
export function reportsNavTab(pathPrefix) {
  return { to: moduleReportsPath(pathPrefix), label: 'Reports', end: true }
}

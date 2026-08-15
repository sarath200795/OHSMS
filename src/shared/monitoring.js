// ─────────────────────────────────────────────────────────────────────────────
// Error reporting.
//
// One funnel for everything that goes wrong in production: render crashes (via
// the root ErrorBoundary), unhandled promise rejections, and uncaught errors.
// Locally and un-configured it logs to the console; with VITE_SENTRY_DSN set it
// also ships to Sentry — loaded dynamically, so projects that never configure it
// pay zero bundle bytes for it.
//
// Uses @sentry/browser rather than @sentry/react because:
//   • We only call init() and captureException() — no React ErrorBoundary,
//     Profiler, or component-name integrations.
//   • @sentry/react v10 bundles Preact, a feedback widget, screenshot capture,
//     and replay infrastructure (~494 KB). Its Preact rendering scheduler hooks
//     into requestAnimationFrame at module evaluation time, causing Chrome
//     violations ("requestAnimationFrame handler took 163ms") even when those
//     features are disabled via init() config.
//   • @sentry/browser is the errors-only core (~90 KB), with none of that
//     overhead.
//
// reportError never throws and never awaits: it is called from the paths where
// things are already going wrong, and the last thing a crash handler may do is
// crash.
// ─────────────────────────────────────────────────────────────────────────────

const DSN = (import.meta.env.VITE_SENTRY_DSN || '').trim()

let sentry = null // the loaded module, once init has succeeded
let loading = null

function loadSentry() {
  if (!DSN || sentry || loading) return loading
  loading = import('@sentry/browser')
    .then((mod) => {
      mod.init({
        dsn: DSN,
        // The release ties an error to a deploy. Vite injects the mode; the
        // commit would be better, but only if the build pipeline provides it.
        environment: import.meta.env.MODE,
        // Errors only. Tracing and replay are paid-volume features to opt into
        // deliberately, not defaults to discover on an invoice.
        tracesSampleRate: 0,
        // No performance integrations — we only capture errors.
        integrations(defaults) {
          return defaults.filter((i) => {
            const name = i.name
            return (
              name !== 'BrowserTracing' &&
              name !== 'BrowserProfiling' &&
              name !== 'Replay' &&
              name !== 'Feedback'
            )
          })
        },
      })
      sentry = mod
    })
    .catch(() => { /* monitoring must never break the app it monitors */ })
  return loading
}

/**
 * Report an error with optional context. Safe to call from anywhere, including
 * inside error handlers.
 */
export function reportError(error, context = {}) {
  try {
    // eslint-disable-next-line no-console
    console.error('[OHS MS]', error, context)
    if (!DSN) return
    if (sentry) {
      sentry.captureException(error, { extra: context })
    } else {
      // First error races the SDK load: queue it behind the import.
      loadSentry()?.then(() => sentry?.captureException(error, { extra: context }))
    }
  } catch { /* see above */ }
}

/** Install global handlers once, at app start. */
export function installMonitoring() {
  loadSentry()
  window.addEventListener('error', (e) => {
    // Resource-load failures (e.g. an image 404) also fire 'error'; only real
    // script errors carry an .error object worth reporting.
    if (e.error) reportError(e.error, { source: 'window.onerror' })
  })
  window.addEventListener('unhandledrejection', (e) => {
    reportError(e.reason instanceof Error ? e.reason : new Error(String(e.reason)), {
      source: 'unhandledrejection',
    })
  })
}

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

// ── Keeping tokens out of a third party's logs ───────────────────────────────
//
// The public scan routes carry their authorisation IN THE PATH:
//   /qr/<token>       a fire-equipment defect report
//   /permit/<token>   a permit-to-work at a barrier
//   /p/<id>           a LOTO isolation procedure
// Anyone holding one of those strings can act on that surface, so a URL from one
// of these pages is a credential and must not leave the origin. Everything else
// about the path is useful and is kept — "an error on /qr" is the half that
// makes a report worth reading.
const TOKEN_ROUTES = ['qr', 'permit', 'p']

/** Strip the query, the fragment, and any scan token in the first path segment. */
export function sanitizeUrl(value) {
  if (typeof value !== 'string' || !value) return value
  try {
    // A relative URL needs a base to parse; the base is discarded either way,
    // because only pathname survives below.
    const u = new URL(value, 'https://app.invalid')
    const parts = u.pathname.split('/').filter(Boolean)
    if (parts.length >= 2 && TOKEN_ROUTES.includes(parts[0])) {
      parts[1] = ':token'
      // Nothing legitimate follows the token on these routes; anything that
      // does is not worth the risk of guessing at.
      parts.length = 2
    }
    const path = `/${parts.join('/')}`
    // Absolute in, absolute out — the origin is not sensitive and a bare path
    // in a report reads as though it came from nowhere.
    return /^[a-z]+:\/\//i.test(value) ? `${u.origin}${path}` : path
  } catch {
    // Unparseable: return the path-shaped prefix and drop everything after the
    // first ? or #, rather than handing back the original.
    return String(value).split(/[?#]/)[0]
  }
}

/** Apply sanitizeUrl everywhere Sentry records a URL on an event. */
export function sanitizeEvent(event) {
  if (!event) return event
  if (event.request?.url) event.request.url = sanitizeUrl(event.request.url)
  // query_string and the Referer both reproduce what the URL scrub just removed.
  if (event.request) {
    delete event.request.query_string
    if (event.request.headers) delete event.request.headers.Referer
  }
  for (const crumb of event.breadcrumbs || []) {
    if (crumb?.data?.url) crumb.data.url = sanitizeUrl(crumb.data.url)
  }
  return event
}

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
        // Never send the URL's query string or fragment to a third party.
        //
        // Sentry is a US subprocessor and this app has PUBLIC ROUTES WHOSE PATH
        // IS A CREDENTIAL: /qr/:token, /permit/:token and /p/:id are scanned off
        // a sticker or a permit at a barrier, and the token in them is the whole
        // of the authorisation. An error thrown on one of those pages ships the
        // full URL by default, which puts a live bearer token in a third
        // party's inbox, in their logs, and in whatever they retain.
        //
        // The path is kept because it is what makes a report actionable; only
        // what follows it is dropped. Tokens ride in the path segment on those
        // three routes, so `sanitizeUrl` below replaces the segment as well.
        beforeSend(event) {
          return sanitizeEvent(event)
        },
        // Breadcrumbs carry the same URLs, one per navigation, and are attached
        // to every event — so scrubbing only the event would leave the token in
        // the trail beside it.
        beforeBreadcrumb(crumb) {
          if (crumb?.data?.url) crumb.data.url = sanitizeUrl(crumb.data.url)
          if (crumb?.data?.from) crumb.data.from = sanitizeUrl(crumb.data.from)
          if (crumb?.data?.to) crumb.data.to = sanitizeUrl(crumb.data.to)
          return crumb
        },
        // Belt and braces with the two above: this is the SDK's own switch for
        // attaching IP address, cookies and user identifiers. It defaults to
        // false, and it is stated here because a default is not a decision and
        // the next SDK major is free to change one.
        sendDefaultPii: false,
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

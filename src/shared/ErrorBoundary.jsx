import { Component } from 'react'
import { reportError } from './monitoring'

// A failed dynamic import almost always means the person is on an OLD build
// whose chunk filenames no longer exist in Hosting. Every module in this app is
// lazy-loaded, so after a deploy anyone with a tab still open hits this the
// first time they open a module they had not already visited — and what they
// see is a crash screen, for a problem one reload fixes completely.
//
// This came from src/modules/loto/components/ErrorBoundary.jsx, which had it
// and which nothing imported. It belongs here: the trigger is a deploy, not
// anything about LOTO, and here it covers all seventeen modules.
const CHUNK_ERROR =
  /dynamically imported module|Loading chunk|Importing a module script failed|Failed to fetch/i
const RELOAD_KEY = 'hecp:chunkReloadAt'

// Reload once, not in a loop. If the reload does not fix it — a genuinely
// broken deploy, an offline device — the second crash within the window falls
// through to the recovery screen instead of cycling the tab forever.
function reloadOnceForStaleChunk(error) {
  if (!CHUNK_ERROR.test(String(error?.message || ''))) return
  let last = 0
  try {
    last = Number(sessionStorage.getItem(RELOAD_KEY) || 0)
  } catch {
    /* private mode: no memory of a previous reload, so fall through */
  }
  if (Date.now() - last <= 10000) return
  try {
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch {
    /* see above — without the stamp we must NOT reload, or it loops */
    return
  }
  window.location.reload()
}

// ─────────────────────────────────────────────────────────────────────────────
// The root error boundary.
//
// Without one, a single render error anywhere blanks the entire app to a white
// screen — on a phone, on a site, with no way back but knowing to hard-refresh.
// This catches the crash, reports it, and gives the person a button.
//
// A class component because that is still the only way to implement
// componentDidCatch; do not convert it.
//
// Deliberately styled with plain inline CSS rather than the design-system
// classes: if the crash happened before the stylesheet loaded, a fallback that
// depends on the stylesheet renders as unstyled soup exactly when it matters.
// ─────────────────────────────────────────────────────────────────────────────
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    reportError(error, { source: 'ErrorBoundary', componentStack: info?.componentStack })
    reloadOnceForStaleChunk(error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: '#0c1024',
          padding: 24,
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <div
          style={{
            maxWidth: 420,
            background: '#151b36',
            borderRadius: 16,
            padding: 32,
            textAlign: 'center',
            boxShadow: '0 0 0 1px rgba(255,255,255,0.08), 0 18px 48px rgba(4,8,24,0.55)',
            border: '1px solid rgba(255,255,255,0.1)',
          }}
        >
          <p style={{ fontSize: 40, margin: 0 }}>⚠️</p>
          <h1 style={{ fontSize: 18, margin: '12px 0 6px', color: '#f4f7ff' }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.5, color: '#8b9cb8', margin: '0 0 20px' }}>
            The error has been recorded. Nothing you entered before this screen is lost — reload to
            carry on where you were.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              background: 'linear-gradient(90deg, #ff2d92, #e11d8a)',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
              borderRadius: 999,
              padding: '12px 28px',
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            Reload the app
          </button>
        </div>
      </div>
    )
  }
}

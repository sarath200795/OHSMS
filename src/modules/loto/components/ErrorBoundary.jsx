import { Component } from 'react'

// App-level safety net. Without this, any uncaught render error — or a stale
// lazy-chunk import that 404s after a redeploy — unmounts the whole React tree
// and leaves a blank page (e.g. on the logout → /login transition, which pulls
// the lazy Login chunk). Here we log the real error, auto-reload once on a
// chunk-load failure, and otherwise show a usable recovery screen.
const CHUNK_ERROR = /dynamically imported module|Loading chunk|Importing a module script failed|Failed to fetch/i
const RELOAD_KEY = 'hecp:chunkReloadAt'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[HECP] App crashed:', error, info)
    // A failed dynamic import almost always means the user is on an old build
    // whose chunk filenames no longer exist — reload to fetch the current
    // bundle. Guard with a timestamp so we never reload-loop.
    if (CHUNK_ERROR.test(String(error?.message || ''))) {
      let last = 0
      try {
        last = Number(sessionStorage.getItem(RELOAD_KEY) || 0)
      } catch {
        /* ignore */
      }
      if (Date.now() - last > 10000) {
        try {
          sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
        } catch {
          /* ignore */
        }
        window.location.reload()
      }
    }
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="hecp-grid-bg flex min-h-screen items-center justify-center p-6">
        <div className="max-w-lg rounded-2xl border border-danger/40 bg-steel-900/70 p-8 text-center">
          <div className="text-4xl">⚠️</div>
          <h1 className="mt-3 text-xl font-bold text-steel-50">Something went wrong</h1>
          <p className="mt-2 text-sm text-steel-300">
            The page failed to load. Reloading usually fixes it.
          </p>
          <button
            onClick={() => window.location.assign('/login')}
            className="mt-6 rounded-2xl bg-hazard px-5 py-2.5 font-semibold text-ink shadow-clay hover:bg-hazard-dark"
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
}

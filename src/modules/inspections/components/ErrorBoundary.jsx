import { Component } from 'react'

/** Catches render errors anywhere below so the app shows a recovery screen
 *  instead of a blank page. */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[Inspections] render error:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-clay-bg p-6 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-500 text-2xl text-white shadow-glow">
            !
          </div>
          <h1 className="text-xl font-extrabold text-ink-900">Something went wrong</h1>
          <p className="max-w-md text-sm text-ink-500">
            An unexpected error occurred. Reloading the page usually fixes it.
          </p>
          <button className="btn-primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

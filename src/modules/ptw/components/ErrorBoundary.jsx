import { Component } from 'react'

/** Catches render errors so the whole app never blanks out on a thrown error. */
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
    console.error('[Permit to Work] render error:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-clay-bg p-6 text-center">
          <h1 className="text-2xl font-extrabold text-ink-900">Something went wrong</h1>
          <p className="max-w-md text-sm text-ink-500">
            An unexpected error occurred. Try reloading the page.
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

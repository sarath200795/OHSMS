import { Component } from 'react'

/** Surfaces render errors instead of a blank screen. */
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
    console.error('[Fire Marshal] Render error:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-ink-50 p-6">
          <div className="card max-w-lg p-8 text-center">
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-red-100 text-2xl">⚠️</div>
            <h1 className="text-xl font-extrabold text-ink-900">Something went wrong</h1>
            <p className="mt-2 text-sm text-ink-500">{String(this.state.error?.message || this.state.error)}</p>
            <button className="btn-primary mx-auto mt-5" onClick={() => location.reload()}>
              Reload
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

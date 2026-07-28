import { Component } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

/**
 * App-level error boundary. Catches render-time crashes anywhere below it and
 * shows a readable recovery screen instead of a blank white page.
 */
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
    console.error('[HIRA] Unhandled UI error:', error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="grid min-h-screen place-items-center bg-clay-bg px-6">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-card">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-red-50 text-red-600">
            <AlertTriangle size={26} />
          </div>
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-ink-900">
            Something went wrong
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            The page hit an unexpected error. Reloading usually fixes it.
          </p>
          <button
            type="button"
            className="btn-primary mt-6 w-full"
            onClick={() => window.location.reload()}
          >
            <RotateCcw size={16} /> Reload page
          </button>
        </div>
      </div>
    )
  }
}

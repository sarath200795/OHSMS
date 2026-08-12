import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import App from './App'
import ErrorBoundary from './shared/ErrorBoundary'
import { installMonitoring } from './shared/monitoring'
import { AuthProvider } from './shared/auth/AuthContext'
import './index.css'

installMonitoring()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* Outermost on purpose: a crash in the router or auth provider must still
        land on the recovery screen, not a blank page. */}
    <ErrorBoundary>
      {/* Opted in to v7 behaviour now, because until this was set React Router
          printed two future-flag warnings on EVERY navigation — around 94% of
          everything in the console, which is how a console stops being read at
          all and a real error hides in plain sight.

          Safe to turn on here, checked rather than assumed: v7_relativeSplatPath
          only changes how a RELATIVE path resolves inside a splat route, and
          this app has no relative <Link to> and no relative navigate() — every
          module's tabs are absolute ('/loto/inventory'), and the only relative
          navigation is navigate(-1), which is history and unaffected. */}
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthProvider>
          <App />
          <Toaster
            position="top-right"
            toastOptions={{
              duration: 3500,
              className: '!bg-clay-surface !text-ink-800 !shadow-clay !rounded-2xl',
              success: { iconTheme: { primary: '#0d9488', secondary: '#fff' } },
            }}
          />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
)

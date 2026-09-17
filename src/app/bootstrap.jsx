import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import ErrorBoundary from '../shared/ErrorBoundary'
import { installMonitoring } from '../shared/monitoring'
import { AuthProvider } from '../shared/auth/AuthContext'
import { AppRoleProvider } from './AppRoleContext'
import '../index.css'

export function mountApp({ role = 'combined', moduleKey = null }, App) {
  installMonitoring()
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <ErrorBoundary>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AppRoleProvider role={role} moduleKey={moduleKey}>
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
          </AppRoleProvider>
        </BrowserRouter>
      </ErrorBoundary>
    </StrictMode>
  )
}

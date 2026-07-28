import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import App from './App'
import { AuthProvider } from './shared/auth/AuthContext'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
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
  </StrictMode>
)

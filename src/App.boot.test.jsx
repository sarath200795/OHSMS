// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

// The store row fetches a release file after paint. That update is not the
// gate this file is about, and it lands outside the render's act().
vi.mock('./pages/auth/StoreBadges', () => ({ default: () => null }))
import { AuthProvider } from './shared/auth/AuthContext'
import { clearAccessToken } from './shared/auth/ownStackSession'

// The dedicated host injects this before the bundle runs. The test sets the
// same object. isFirebaseConfigured stays false here: this environment has no
// Firebase web config, which is the case that used to render SetupNeeded
// even after a correct postgres injection.
const STACK = {
  VITE_DATA_DRIVER: 'postgres',
  VITE_DATA_GATEWAY: 'http://127.0.0.1:8787',
  VITE_AUTH_METHOD: 'oidc',
}

function boot() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>
  )
}

afterEach(() => {
  cleanup()
  clearAccessToken()
  delete globalThis.__OHSMS_STACK__
})

describe('app boot gate', () => {
  it('shows the Firebase setup screen when nothing is configured', () => {
    boot()
    expect(screen.getByRole('heading', { name: 'Connect Firebase' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Sign in' })).toBeNull()
  })

  it('opens the sign-in screen when the dedicated host injected postgres', () => {
    globalThis.__OHSMS_STACK__ = STACK
    boot()
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Connect Firebase' })).toBeNull()
    expect(screen.queryByLabelText('Password')).toBeNull()
    expect(
      screen.getByRole('link', { name: 'Continue to company sign-in' }).getAttribute('href')
    ).toBe('http://127.0.0.1:8787/auth/start')
  })

  it('still requires Firebase when the injection is not an own-stack driver', () => {
    globalThis.__OHSMS_STACK__ = { VITE_AUTH_METHOD: 'oidc' }
    boot()
    expect(screen.getByRole('heading', { name: 'Connect Firebase' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Sign in' })).toBeNull()
  })
})

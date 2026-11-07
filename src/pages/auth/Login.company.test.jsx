// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../../shared/auth/AuthContext'
import { clearAccessToken } from '../../shared/auth/ownStackSession'

vi.mock('./StoreBadges', () => ({ default: () => null }))
import Login from './Login'

const LOCAL = {
  VITE_DATA_DRIVER: 'postgres',
  VITE_DATA_GATEWAY: 'http://127.0.0.1:8787',
  VITE_AUTH_METHOD: 'saml',
}

function show() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <Login />
      </AuthProvider>
    </MemoryRouter>
  )
}

afterEach(() => {
  cleanup()
  clearAccessToken()
  delete globalThis.__OHSMS_STACK__
})

describe('dedicated host sign-in', () => {
  it('sends company SAML to the host start URL instead of the email form', () => {
    globalThis.__OHSMS_STACK__ = LOCAL
    show()
    expect(screen.queryByLabelText('Password')).toBeNull()
    expect(screen.queryByLabelText('Email')).toBeNull()
    expect(screen.queryByText('Forgot password?')).toBeNull()
    const link = screen.getByRole('link', { name: 'Continue to company sign-in' })
    expect(link.getAttribute('href')).toBe('http://127.0.0.1:8787/auth/start')
  })

  it('keeps the email form when this is not an own-stack host', () => {
    show()
    expect(screen.getByLabelText('Password')).toBeTruthy()
    expect(screen.getByLabelText('Email')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Continue to company sign-in' })).toBeNull()
  })

  it('keeps the email form for an own-stack host that uses Supabase passwords', () => {
    globalThis.__OHSMS_STACK__ = { ...LOCAL, VITE_AUTH_METHOD: 'supabase' }
    show()
    expect(screen.getByLabelText('Password')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Continue to company sign-in' })).toBeNull()
  })
})

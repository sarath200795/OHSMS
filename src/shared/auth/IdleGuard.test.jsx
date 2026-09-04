// @vitest-environment jsdom
//
// The guard both shells mount. It was inline in AppChrome, which is how
// /platform — the one screen that does not go through AppChrome — ended up as
// the only route in the product with no inactivity logout, on the account that
// can change what every customer may use.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const state = { isWarning: false, isExpired: false, remainingSeconds: 0, resetActivity: vi.fn() }
vi.mock('./useIdleTimeout', () => ({ useIdleTimeout: () => state }))

const { default: IdleGuard } = await import('./IdleGuard')

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(state, { isWarning: false, isExpired: false, remainingSeconds: 0, resetActivity: vi.fn() })
})

describe('while the session is active', () => {
  it('renders nothing at all', () => {
    const { container } = render(<IdleGuard signOut={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('does not sign anybody out', () => {
    const signOut = vi.fn()
    render(<IdleGuard signOut={signOut} />)
    expect(signOut).not.toHaveBeenCalled()
  })
})

describe('during the warning', () => {
  beforeEach(() => { Object.assign(state, { isWarning: true, remainingSeconds: 42 }) })

  it('says how long is left', () => {
    render(<IdleGuard signOut={vi.fn()} />)
    expect(screen.getByText('42')).toBeTruthy()
  })

  it('is announced as a dialog rather than appearing silently', () => {
    render(<IdleGuard signOut={vi.fn()} />)
    expect(screen.getByRole('alertdialog')).toBeTruthy()
  })

  it('lets the person stay, without signing them out', () => {
    const signOut = vi.fn()
    render(<IdleGuard signOut={signOut} />)
    fireEvent.click(screen.getByRole('button', { name: /stay signed in/i }))
    expect(state.resetActivity).toHaveBeenCalled()
    expect(signOut).not.toHaveBeenCalled()
  })

  it('lets the person leave now', () => {
    const signOut = vi.fn()
    render(<IdleGuard signOut={signOut} />)
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))
    expect(signOut).toHaveBeenCalled()
  })
})

describe('on expiry', () => {
  it('signs out', () => {
    Object.assign(state, { isExpired: true })
    const signOut = vi.fn()
    render(<IdleGuard signOut={signOut} />)
    expect(signOut).toHaveBeenCalled()
  })

  it('survives a shell that passed no signOut rather than crashing it', () => {
    // The platform console renders this beside its own sign-out button; a
    // throw here would take the whole operator screen down with it.
    Object.assign(state, { isExpired: true })
    expect(() => render(<IdleGuard />)).not.toThrow()
  })
})

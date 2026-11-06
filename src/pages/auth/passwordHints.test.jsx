// @vitest-environment jsdom
//
// The three screens that ask for a new password used to disagree with
// passwordPolicy.js: six characters to join or found an organization, eight to
// replace a temporary one, ten inside validatePassword. These pin the rendered
// hint, the minLength attribute, and the absence of those old numbers.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MIN_PASSWORD_LENGTH, passwordLengthHint } from '../../shared/auth/passwordPolicy'
import { authErrorMessage } from '../../shared/lib/authErrors'

vi.mock('react-hot-toast', () => ({
  default: { success: () => {}, error: () => {} },
}))
vi.mock('react-router-dom', () => ({
  Link: ({ children }) => children,
  Navigate: () => null,
  useNavigate: () => () => {},
}))
vi.mock('../../shared/auth/AuthContext', () => ({
  useAuth: () => ({
    signUpMember: vi.fn(),
    registerOrganization: vi.fn(),
    isAuthed: false,
    profile: { name: 'Ravi Nair', status: 'approved' },
    refreshProfile: vi.fn(),
    signOut: vi.fn(),
  }),
}))
vi.mock('../../shared/org/orgData', () => ({
  findOrgByName: vi.fn(),
  orgIndexRef: vi.fn(),
}))
vi.mock('./AuthLayout', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('../../shared/firebase', () => ({
  auth: { currentUser: { email: 'ravi@acme.test' } },
  db: {},
}))
vi.mock('firebase/auth', () => ({
  updatePassword: vi.fn(),
  reauthenticateWithCredential: vi.fn(),
  EmailAuthProvider: { credential: vi.fn() },
}))
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  updateDoc: vi.fn(),
  collection: vi.fn(),
  getDocs: vi.fn(),
  limit: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  serverTimestamp: vi.fn(),
  writeBatch: vi.fn(),
}))
vi.mock('../../shared/branding/BrandMark', () => ({ default: () => null }))

const { default: Signup } = await import('./Signup')
const { default: RegisterOrg } = await import('./RegisterOrg')
const { default: ForcePasswordChange } = await import('./ForcePasswordChange')

afterEach(cleanup)

function expectNewPassword(label) {
  const input = screen.getByLabelText(label)
  expect(input.minLength).toBe(MIN_PASSWORD_LENGTH)
  const hintId = input.getAttribute('aria-describedby')
  expect(hintId).toBeTruthy()
  expect(document.getElementById(hintId).textContent).toBe(passwordLengthHint())
  return input
}

describe('new-password fields show the shared client floor', () => {
  it('join, register, and the forced change all name the same length', () => {
    const { unmount } = render(<Signup />)
    expectNewPassword('Password')
    unmount()

    render(<RegisterOrg />)
    fireEvent.click(screen.getByRole('radio', { name: /WEEHS database/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expectNewPassword('Password')
    cleanup()

    render(<ForcePasswordChange />)
    expectNewPassword('New password')
    // The temporary password was issued already. It is not a new-password rule.
    const temporary = screen.getByLabelText('Temporary password')
    expect(temporary.minLength).toBe(-1)
    expect(document.getElementById(temporary.getAttribute('aria-describedby')).textContent).toBe(
      'The one you were given'
    )
    expect(screen.getByLabelText('Confirm new password').minLength).toBe(-1)
  })
})

function sourceFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) sourceFiles(path, out)
    else if (/\.(jsx|js)$/.test(name) && !/\.test\./.test(name)) out.push(path)
  }
  return out
}

describe('active screens do not keep the old six- and eight-character hints', () => {
  // A hardcoded "At least 10 characters" would pass a search for 6 and 8 and
  // then drift the next time the constant moves. Any digit in that sentence,
  // outside passwordLengthHint(), is the stale form.
  it('has no "at least N characters" copy under src/pages', () => {
    const stale = []
    for (const path of sourceFiles('src/pages')) {
      const text = readFileSync(path, 'utf8')
      if (/at least\s+\d+\s+characters/i.test(text)) stale.push(path)
    }
    expect(stale).toEqual([])
  })

  it('does not quote a length when Identity Toolkit rejects a password', () => {
    // auth/weak-password is the provider's answer. Naming 6 repeats Firebase's
    // historical default; naming MIN_PASSWORD_LENGTH would claim the console
    // policy matches the client check. Neither is known from here.
    const message = authErrorMessage({ code: 'auth/weak-password' })
    expect(message).toMatch(/stronger password/i)
    expect(message).not.toMatch(/at least\s+\d+\s+characters/i)
    expect(message).not.toContain(String(MIN_PASSWORD_LENGTH))
    const source = readFileSync('src/shared/lib/authErrors.js', 'utf8')
    expect(source).not.toMatch(/at least\s+\d+\s+characters/i)
  })
})

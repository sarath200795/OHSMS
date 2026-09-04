// @vitest-environment jsdom
//
// The organization is TYPED here, not picked from a list, and these tests pin
// that. The dropdown this replaced was filled by listOrganizations() — a
// getDocs() over the whole public index — so opening /signup downloaded every
// customer's name and orgId, unauthenticated. `list` is now refused to everyone
// but the platform operator (firestore.rules, /orgIndex), so the old page could
// not work even if it came back; what these assert is that the replacement
// still refuses to create an account against an org it did not resolve.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const signUpMember = vi.fn()
const findOrgByName = vi.fn()
const navigate = vi.fn()
const toastError = vi.fn()
const toastSuccess = vi.fn()

vi.mock('../../shared/auth/AuthContext', () => ({
  useAuth: () => ({ signUpMember, isAuthed: false, profile: null }),
}))
vi.mock('../../shared/org/orgData', () => ({
  findOrgByName: (...a) => findOrgByName(...a),
}))
vi.mock('react-router-dom', () => ({
  Link: ({ children }) => children,
  Navigate: () => null,
  useNavigate: () => navigate,
}))
vi.mock('react-hot-toast', () => ({
  default: { success: (...a) => toastSuccess(...a), error: (...a) => toastError(...a) },
}))
vi.mock('./AuthLayout', () => ({ default: ({ children }) => children }))

const { default: Signup } = await import('./Signup')

const type = (label, value) =>
  fireEvent.change(screen.getByLabelText(label, { exact: false }), { target: { value } })
const blurOrg = () => fireEvent.blur(screen.getByLabelText('Organization', { exact: false }))

/** Fill everything except the organization, which each test decides. */
function fillTheRest() {
  type('Your name', 'Ravi Nair')
  type('Work email', 'ravi@acme.test')
  type('Password', 'correct-horse-9')
}

beforeEach(() => {
  vi.clearAllMocks()
  findOrgByName.mockResolvedValue({ id: 'org-1', name: 'Acme Manufacturing' })
  signUpMember.mockResolvedValue(undefined)
})

describe('resolving the organization', () => {
  it('does not read the index until a name has been typed', () => {
    render(<Signup />)
    expect(findOrgByName).not.toHaveBeenCalled()
  })

  it('resolves one document by name, never a listing', async () => {
    render(<Signup />)
    type('Organization', 'Acme Manufacturing')
    blurOrg()
    await waitFor(() => expect(findOrgByName).toHaveBeenCalledWith('Acme Manufacturing'))
  })

  it('confirms the match while the name is still on screen', async () => {
    render(<Signup />)
    type('Organization', 'Acme Manufacturing')
    blurOrg()
    expect(await screen.findByText(/Found Acme Manufacturing/)).toBeTruthy()
  })

  it('says so when the name is not there, before a password is chosen', async () => {
    findOrgByName.mockResolvedValue(null)
    render(<Signup />)
    type('Organization', 'Acme Manufacurting')
    blurOrg()
    expect(await screen.findByText(/No organization with that name/)).toBeTruthy()
  })

  it('ignores a blank name rather than looking it up', async () => {
    render(<Signup />)
    type('Organization', '   ')
    blurOrg()
    await waitFor(() => expect(findOrgByName).not.toHaveBeenCalled())
  })

  it('does NOT report "no such organization" when the lookup itself failed', async () => {
    // A dropped connection is not the same answer as a name that is not there,
    // and saying so sends somebody off to register a duplicate of their own
    // company — which then owns the index entry their colleagues resolve.
    findOrgByName.mockRejectedValue(new Error('offline'))
    render(<Signup />)
    type('Organization', 'Acme Manufacturing')
    blurOrg()
    await waitFor(() => expect(findOrgByName).toHaveBeenCalled())
    expect(screen.queryByText(/No organization with that name/)).toBeNull()
  })
})

describe('creating the account', () => {
  it('signs up against the RESOLVED id, not anything the form held', async () => {
    render(<Signup />)
    type('Organization', 'acme manufacturing')
    blurOrg()
    await screen.findByText(/Found Acme Manufacturing/)
    fillTheRest()
    fireEvent.click(screen.getByRole('button', { name: /request access/i }))
    await waitFor(() => expect(signUpMember).toHaveBeenCalled())
    expect(signUpMember.mock.calls[0][0]).toMatchObject({
      orgId: 'org-1',
      orgName: 'Acme Manufacturing',
    })
  })

  it('refuses to create an account when the name resolves to nothing', async () => {
    findOrgByName.mockResolvedValue(null)
    render(<Signup />)
    type('Organization', 'Nowhere Ltd')
    fillTheRest()
    fireEvent.click(screen.getByRole('button', { name: /request access/i }))
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(signUpMember).not.toHaveBeenCalled()
  })

  it('re-resolves a name edited after it was confirmed', async () => {
    // The blur result is a convenience. If it were trusted, editing the name
    // after the check would create the account against the previous org — the
    // one shape where a resolved-then-changed field is worse than no check.
    render(<Signup />)
    type('Organization', 'Acme Manufacturing')
    blurOrg()
    await screen.findByText(/Found Acme Manufacturing/)
    findOrgByName.mockResolvedValue({ id: 'org-2', name: 'Beta Works' })
    type('Organization', 'Beta Works')
    fillTheRest()
    fireEvent.click(screen.getByRole('button', { name: /request access/i }))
    await waitFor(() => expect(signUpMember).toHaveBeenCalled())
    expect(signUpMember.mock.calls[0][0]).toMatchObject({ orgId: 'org-2' })
  })

  it('rejects a weak password before creating anything', async () => {
    render(<Signup />)
    type('Organization', 'Acme Manufacturing')
    blurOrg()
    await screen.findByText(/Found Acme Manufacturing/)
    type('Your name', 'Ravi Nair')
    type('Work email', 'ravi@acme.test')
    type('Password', 'short')
    fireEvent.click(screen.getByRole('button', { name: /request access/i }))
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(signUpMember).not.toHaveBeenCalled()
  })
})

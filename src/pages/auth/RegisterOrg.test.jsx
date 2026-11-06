// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const registerOrganization = vi.fn()
const navigate = vi.fn()
const fileProvisioningRequest = vi.hoisted(() => vi.fn())

vi.mock('../../shared/auth/AuthContext', () => ({
  useAuth: () => ({ registerOrganization, isAuthed: false, profile: null }),
}))
vi.mock('react-router-dom', () => ({
  Link: ({ children }) => children,
  Navigate: () => null,
  useNavigate: () => navigate,
}))
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('./AuthLayout', () => ({
  default: ({ title, subtitle, children }) => (
    <div>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      {children}
    </div>
  ),
}))
vi.mock('../../shared/firebase', () => ({ db: {}, auth: {} }))
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  writeBatch: vi.fn(),
  serverTimestamp: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
}))
vi.mock('../../shared/org/provisioningRequest', () => ({
  fileProvisioningRequest: (...args) => fileProvisioningRequest(...args),
}))

const { default: RegisterOrg } = await import('./RegisterOrg')

const choose = (name) => {
  fireEvent.click(screen.getByRole('radio', { name }))
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  registerOrganization.mockResolvedValue(undefined)
  fileProvisioningRequest.mockResolvedValue({
    id: 'reqNorthwind1',
    orgName: 'Northwind Metals',
    contactEmail: 'asha@northwind.test',
    handoffContact: 'asha@northwind.test',
    mode: 'bring',
    engine: 'mysql',
    authMethod: 'oidc',
  })
})

describe('the database choice', () => {
  it('shows both doors and does not ask for a WEEHS password yet', () => {
    render(<RegisterOrg />)
    expect(screen.getByRole('radio', { name: /WEEHS database/i })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /your own database/i })).toBeTruthy()
    expect(screen.queryByLabelText('Password')).toBeNull()
  })

  it('keeps the WEEHS path on registerOrganization', async () => {
    render(<RegisterOrg />)
    choose(/WEEHS database/i)
    fireEvent.change(screen.getByLabelText('Organization name'), {
      target: { value: 'Acme Manufacturing Ltd' },
    })
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Jane Doe' } })
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'jane@acme.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse-9' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create organization' }))
    await waitFor(() => expect(registerOrganization).toHaveBeenCalled())
    expect(registerOrganization.mock.calls[0][0]).toMatchObject({
      orgName: 'Acme Manufacturing Ltd',
      email: 'jane@acme.com',
      password: 'correct-horse-9',
    })
    expect(fileProvisioningRequest).not.toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith('/portal', { replace: true })
  })

  it('files an own-database request and does not create a WEEHS organization', async () => {
    render(<RegisterOrg />)
    choose(/your own database/i)
    expect(screen.queryByLabelText('Password')).toBeNull()
    fireEvent.change(screen.getByLabelText('Organization name'), {
      target: { value: 'Northwind Metals' },
    })
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Asha Rao' } })
    fireEvent.change(screen.getByLabelText('Work email'), {
      target: { value: 'asha@northwind.test' },
    })
    fireEvent.change(screen.getByLabelText('Hosting'), { target: { value: 'bring' } })
    fireEvent.change(screen.getByLabelText('Database engine'), { target: { value: 'mysql' } })
    fireEvent.change(screen.getByLabelText('Sign-in'), { target: { value: 'oidc' } })
    fireEvent.change(screen.getByLabelText('Issuer URL'), {
      target: { value: 'https://login.northwind.test/realms/staff' },
    })
    fireEvent.change(screen.getByLabelText('Client id'), { target: { value: 'ohsms-northwind' } })
    fireEvent.change(screen.getByLabelText('File store'), { target: { value: 'provision' } })
    fireEvent.click(screen.getByRole('button', { name: 'File provisioning request' }))
    await waitFor(() => expect(fileProvisioningRequest).toHaveBeenCalled())
    const payload = fileProvisioningRequest.mock.calls[0][0]
    expect(payload).toMatchObject({
      orgName: 'Northwind Metals',
      engine: 'mysql',
      mode: 'bring',
      authMethod: 'oidc',
      status: 'requested',
    })
    expect(payload).not.toHaveProperty('password')
    expect(payload).not.toHaveProperty('dataKeyMaster')
    expect(registerOrganization).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
    expect(await screen.findByText(/Status: requested/i)).toBeTruthy()
    expect(screen.getByText(/reqNorthwind1/)).toBeTruthy()
    expect(screen.getByText(/dedicated URL|own URL/i)).toBeTruthy()
    expect(screen.queryByText(/welcome/i)).toBeNull()
  })
})

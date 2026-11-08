// @vitest-environment jsdom
//
// The own-stack Employees panel. The host is the enforcement
// (src/shared/data/controlPlane.test.js); these check the form sends what the
// admin chose, says why a refusal happened instead of "request refused", and
// that withdrawing is a click that does not also submit the invite form.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const inviteMember = vi.fn()
const listInvites = vi.fn()
const revokeInvite = vi.fn()
const getAutoJoin = vi.fn()
const setAutoJoin = vi.fn()
const getGroupRoles = vi.fn()
const setGroupRoles = vi.fn()
const scimStatus = vi.fn()
const createScimToken = vi.fn()
const revokeScimToken = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()

vi.mock('../../shared/functions', () => ({
  inviteMember: (...a) => inviteMember(...a),
  listInvites: (...a) => listInvites(...a),
  revokeInvite: (...a) => revokeInvite(...a),
  getAutoJoin: (...a) => getAutoJoin(...a),
  setAutoJoin: (...a) => setAutoJoin(...a),
  getGroupRoles: (...a) => getGroupRoles(...a),
  setGroupRoles: (...a) => setGroupRoles(...a),
  scimStatus: (...a) => scimStatus(...a),
  createScimToken: (...a) => createScimToken(...a),
  revokeScimToken: (...a) => revokeScimToken(...a),
}))
vi.mock('react-hot-toast', () => ({
  default: { success: (...a) => toastSuccess(...a), error: (...a) => toastError(...a) },
}))

const { default: OwnStackInvites } = await import('./OwnStackInvites')

function refused(reason) {
  const err = new Error('The request was refused.')
  err.reason = reason
  return err
}

beforeEach(() => {
  vi.clearAllMocks()
  listInvites.mockResolvedValue([])
  getAutoJoin.mockResolvedValue(null)
  getGroupRoles.mockResolvedValue([])
  scimStatus.mockResolvedValue({ ok: true, enabled: false, createdAt: null })
  inviteMember.mockResolvedValue({ ok: true, email: 'ravi@northwind.test', emailed: true })
  revokeInvite.mockResolvedValue({ ok: true, removed: true })
})

async function openPanel() {
  render(<OwnStackInvites />)
  fireEvent.click(screen.getByRole('button', { name: /invite employee/i }))
  await waitFor(() => expect(listInvites).toHaveBeenCalled())
}

describe('own-stack invites panel', () => {
  it('sends the address, name and chosen role', async () => {
    await openPanel()
    fireEvent.change(screen.getByLabelText('Work email'), {
      target: { value: 'ravi@northwind.test' },
    })
    fireEvent.change(screen.getByLabelText('Name', { exact: false }), {
      target: { value: 'Ravi Nair' },
    })
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'manager' } })
    fireEvent.click(screen.getByRole('button', { name: /send invite/i }))
    await waitFor(() =>
      expect(inviteMember).toHaveBeenCalledWith({
        email: 'ravi@northwind.test',
        name: 'Ravi Nair',
        role: 'manager',
      })
    )
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining('emailed'))
  })

  it('explains a refusal in words, not as "request refused"', async () => {
    inviteMember.mockRejectedValue(refused('already-member'))
    await openPanel()
    fireEvent.change(screen.getByLabelText('Work email'), {
      target: { value: 'asha@northwind.test' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send invite/i }))
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(expect.stringContaining('already has an account'))
    )
  })

  it('withdraws a pending invite without submitting a new one', async () => {
    listInvites.mockResolvedValue([{ email: 'temp@northwind.test', role: 'member', name: 'T' }])
    await openPanel()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Withdraw invite for temp@northwind.test' })
    )
    await waitFor(() => expect(revokeInvite).toHaveBeenCalledWith('temp@northwind.test'))
    expect(inviteMember).not.toHaveBeenCalled()
  })
})

describe('joining automatically by domain', () => {
  it('saves the domains typed and the role chosen, and never offers admin', async () => {
    setAutoJoin.mockResolvedValue({ domains: ['cult.fit', 'cult.test'], role: 'member' })
    await openPanel()
    await waitFor(() => expect(screen.getByLabelText('Email domains').disabled).toBe(false))
    expect(screen.getByText(/Off: only invited people join/)).toBeTruthy()
    const role = screen.getByLabelText('They join as')
    expect([...role.querySelectorAll('option')].map((o) => o.value)).not.toContain('admin')
    fireEvent.change(screen.getByLabelText('Email domains'), {
      target: { value: 'cult.fit, cult.test' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(setAutoJoin).toHaveBeenCalledWith({
        domains: ['cult.fit', 'cult.test'],
        role: 'member',
      })
    )
    await waitFor(() =>
      expect(screen.getByText(/On: anyone your company sign-in admits/)).toBeTruthy()
    )
    expect(inviteMember).not.toHaveBeenCalled()
  })

  it('says why a save was refused', async () => {
    setAutoJoin.mockRejectedValue(refused('domains'))
    await openPanel()
    await waitFor(() => expect(screen.getByLabelText('Email domains').disabled).toBe(false))
    fireEvent.change(screen.getByLabelText('Email domains'), { target: { value: 'not a domain' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/domains only/))
    )
  })
})

describe('following the company directory', () => {
  it('saves group rows as typed, including an administrator group', async () => {
    setGroupRoles.mockImplementation(async (rules) => rules)
    await openPanel()
    await waitFor(() => expect(getGroupRoles).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Add a group' }))
    fireEvent.change(screen.getByLabelText('Group name or ID'), { target: { value: ' EHS-Admins ' } })
    fireEvent.change(screen.getByLabelText('Role for this group'), { target: { value: 'admin' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save groups' }))
    await waitFor(() =>
      expect(setGroupRoles).toHaveBeenCalledWith([{ group: 'EHS-Admins', role: 'admin' }])
    )
    expect(inviteMember).not.toHaveBeenCalled()
  })

  it('shows a new SCIM token once, with the base URL to give the identity provider', async () => {
    createScimToken.mockResolvedValue('weehs_scim_example-token')
    scimStatus
      .mockResolvedValueOnce({ ok: true, enabled: false, createdAt: null })
      .mockResolvedValue({ ok: true, enabled: true, createdAt: '2026-11-08T12:00:00Z' })
    await openPanel()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Turn on sync' }).disabled).toBe(false)
    )
    expect(screen.getByLabelText('SCIM base URL').value).toMatch(/\/scim\/v2$/)
    fireEvent.click(screen.getByRole('button', { name: 'Turn on sync' }))
    await waitFor(() =>
      expect(screen.getByLabelText(/Token \(shown once\)/).value).toBe('weehs_scim_example-token')
    )
    expect(screen.getByRole('button', { name: 'Turn off sync' })).toBeTruthy()
  })
})

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const listProvisioningRequests = vi.hoisted(() => vi.fn())

vi.mock('../../shared/org/provisioningRequest', () => ({
  listProvisioningRequests: (...args) => listProvisioningRequests(...args),
}))

const { default: ProvisioningRequests } = await import('./ProvisioningRequests')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('own-database requests', () => {
  it('shows a request as requested and offers no way to mark it live', async () => {
    listProvisioningRequests.mockResolvedValue({
      capped: false,
      rows: [
        {
          id: 'reqNorthwind1',
          orgName: 'Northwind Metals',
          contactEmail: 'asha@northwind.test',
          mode: 'bring',
          engine: 'mysql',
          authMethod: 'oidc',
          status: 'requested',
          createdAt: '2026-11-06T09:00:00.000Z',
        },
      ],
    })
    render(<ProvisioningRequests />)
    expect(await screen.findByText('Northwind Metals')).toBeTruthy()
    expect(screen.getByText('requested')).toBeTruthy()
    expect(screen.getByText('mysql')).toBeTruthy()
    expect(screen.getByText(/does not create a WEEHS organization/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /provision|approve|live/i })).toBeNull()
  })

  it('says when there are none', async () => {
    listProvisioningRequests.mockResolvedValue({ capped: false, rows: [] })
    render(<ProvisioningRequests />)
    expect(await screen.findByText('No own-database requests')).toBeTruthy()
  })
})

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { formatDate, formatDateTime } from '../../shared/lib/format'

const fns = vi.hoisted(() => ({
  listPlatformOrganizations: vi.fn(),
}))

vi.mock('../../shared/functions', () => fns)

const { default: Organizations } = await import('./Organizations.jsx')

const directory = {
  recentWindowDays: 30,
  truncated: false,
  orgTruncated: false,
  userTruncated: false,
  partial: false,
  rows: [
    {
      id: 'orgA',
      name: 'Acme Fitness',
      status: 'active',
      createdAt: '2024-01-15T00:00:00.000Z',
      lastActivityAt: '2026-11-02T08:30:00.000Z',
      counts: {
        users: 4,
        approved: 2,
        pending: 1,
        suspended: 1,
        other: 0,
        sites: 3,
        recentRecords: 2,
      },
      admins: [
        { uid: 'ada', name: 'Ada Admin', email: 'ada@acme.test', status: 'approved' },
        { uid: 'bea', name: 'Bea Admin', email: 'bea@other.test', status: 'suspended' },
      ],
    },
    {
      id: 'orgB',
      name: 'Beacon Health',
      status: 'suspended',
      createdAt: '2023-05-01T00:00:00.000Z',
      lastActivityAt: null,
      counts: {
        users: 1,
        approved: 0,
        pending: 0,
        suspended: 1,
        other: 0,
        sites: 0,
        recentRecords: 0,
      },
      admins: [{ uid: 'sam', name: 'Sam Quiet', email: 'sam@beacon.test', status: 'suspended' }],
    },
  ],
}

beforeEach(() => {
  fns.listPlatformOrganizations.mockReset()
  fns.listPlatformOrganizations.mockResolvedValue(directory)
})

describe('Organizations', () => {
  it('lists every organization with its activity and every admin', async () => {
    render(<Organizations />)
    expect(await screen.findByRole('heading', { name: 'Organizations' })).toBeTruthy()
    const table = screen.getByRole('table')
    expect(within(table).getByRole('columnheader', { name: 'Organization' })).toBeTruthy()
    expect(within(table).getByRole('columnheader', { name: 'Activity' })).toBeTruthy()
    expect(within(table).getByRole('columnheader', { name: 'Admin name' })).toBeTruthy()
    expect(within(table).getByRole('columnheader', { name: 'Admin email' })).toBeTruthy()
    expect(within(table).getByRole('rowheader', { name: /Acme Fitness/ })).toBeTruthy()
    expect(within(table).getByText('Ada Admin')).toBeTruthy()
    expect(within(table).getByText('Bea Admin')).toBeTruthy()
    expect(within(table).getByRole('link', { name: 'ada@acme.test' }).getAttribute('href')).toBe(
      'mailto:ada@acme.test'
    )
    expect(within(table).getByRole('link', { name: 'bea@other.test' })).toBeTruthy()
    expect(within(table).getByText(/3 sites/)).toBeTruthy()
    expect(
      within(table).getByText(`Created ${formatDate('2024-01-15T00:00:00.000Z')}`)
    ).toBeTruthy()
    expect(
      within(table).getByText(
        new RegExp(`Last activity ${formatDateTime('2026-11-02T08:30:00.000Z')}`)
      )
    ).toBeTruthy()
    expect(within(table).getAllByText('Active').length).toBeGreaterThan(0)
    expect(within(table).getByText('Sam Quiet')).toBeTruthy()

    const cards = screen.getByRole('list', { name: 'Organizations' })
    expect(cards.className).toContain('md:hidden')
    expect(within(cards).getByRole('heading', { name: 'Acme Fitness' })).toBeTruthy()
    expect(within(cards).getByRole('link', { name: 'sam@beacon.test' })).toBeTruthy()
  })

  it('filters by organization name and by admin email together', async () => {
    render(<Organizations />)
    await screen.findByRole('table')
    fireEvent.change(screen.getByLabelText('Organization name'), { target: { value: 'acme' } })
    expect(screen.getByRole('rowheader', { name: /Acme Fitness/ })).toBeTruthy()
    expect(screen.queryByRole('rowheader', { name: /Beacon Health/ })).not.toBeTruthy()
    expect(screen.getByText('1 of 2 organizations')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Admin email'), { target: { value: 'beacon.test' } })
    expect(screen.getByText('No organizations match')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    fireEvent.change(screen.getByLabelText('Admin email'), { target: { value: 'SAM@beacon' } })
    expect(screen.getByRole('rowheader', { name: /Beacon Health/ })).toBeTruthy()
    expect(screen.queryByRole('rowheader', { name: /Acme Fitness/ })).not.toBeTruthy()
  })

  it('says when the read was short instead of presenting a partial list as complete', async () => {
    fns.listPlatformOrganizations.mockResolvedValue({
      ...directory,
      orgTruncated: true,
      truncated: true,
      partial: true,
      rows: [
        {
          ...directory.rows[0],
          counts: { ...directory.rows[0].counts, sites: null, recentRecords: null },
        },
      ],
    })
    render(<Organizations />)
    const notice = await screen.findByRole('status')
    expect(notice.textContent).toMatch(/stopped at its read cap/)
    expect(notice.textContent).toMatch(/unavailable rather than zero/)
    expect(screen.getByText(/Sites unavailable/)).toBeTruthy()
  })

  it('shows a refusal without claiming the platform has no organizations', async () => {
    const denied = Object.assign(new Error('Platform operators only.'), {
      code: 'functions/permission-denied',
    })
    fns.listPlatformOrganizations.mockRejectedValue(denied)
    render(<Organizations />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/operator grant may have been removed/)
    expect(screen.queryByText('No organization has registered yet.')).not.toBeTruthy()
  })
})

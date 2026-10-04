// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PermitDashboard from './PermitDashboard'

const NOW = Date.UTC(2026, 9, 5, 10, 0)
const HOUR = 3600 * 1000
const p = (status, end) => ({
  id: status + end,
  status,
  windowStart: NOW - 4 * HOUR,
  windowEnd: end,
})

describe('PermitDashboard', () => {
  const permits = [
    p('active', NOW + 5 * HOUR),
    p('active', NOW - HOUR),
    p('requested', NOW + 5 * HOUR),
    p('returned', NOW - 9 * HOUR),
    p('emergency_removed', NOW - 9 * HOUR),
  ]

  it('shows the open, overdue, due and closed counts', () => {
    render(<PermitDashboard permits={permits} now={NOW} />)
    const tile = (name) => screen.getByRole('button', { name: new RegExp(name) })
    expect(tile('Open').textContent).toMatch(/^3/)
    expect(tile('Overdue').textContent).toMatch(/^1/)
    expect(tile('Due soon').textContent).toMatch(/^0/)
    expect(tile('Closed').textContent).toMatch(/^2/)
    expect(screen.getByText(/1 permit was closed by emergency removal/)).toBeTruthy()
  })

  it('hands the tile key back so the list can filter', () => {
    const onPick = vi.fn()
    render(<PermitDashboard permits={permits} now={NOW} onPick={onPick} />)
    fireEvent.click(screen.getByRole('button', { name: /Overdue/ }))
    expect(onPick).toHaveBeenCalledWith('overdue')
  })

  it('renders zeros for no permits', () => {
    render(<PermitDashboard permits={[]} now={NOW} />)
    expect(screen.getByRole('button', { name: /Open/ }).textContent).toMatch(/^0/)
  })
})

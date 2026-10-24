// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FieldAppGrid from './FieldAppGrid'
import { ViewModeProvider } from '../mobile/viewModeContext'

const auth = vi.hoisted(() => ({ moduleMap: {}, role: 'member' }))

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => auth,
}))

afterEach(() => {
  cleanup()
  auth.role = 'member'
  auth.moduleMap = {}
})

describe('FieldAppGrid', () => {
  it('shows Technical only for a member', () => {
    render(
      <MemoryRouter>
        <ViewModeProvider>
          <FieldAppGrid />
        </ViewModeProvider>
      </MemoryRouter>
    )
    expect(screen.getByRole('button', { name: /Switch to (desktop|mobile) view/ })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Technical' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Admin' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Extinguishers' }).getAttribute('href')).toBe(
      '/equipment/extinguishers'
    )
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull()
  })

  it('adds Admin when the role can open those tools', () => {
    auth.role = 'admin'
    render(
      <MemoryRouter>
        <ViewModeProvider>
          <FieldAppGrid />
        </ViewModeProvider>
      </MemoryRouter>
    )
    expect(screen.getByRole('heading', { name: 'Technical' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Admin' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Meetings' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/settings')
    expect(screen.getByRole('link', { name: 'Employees' })).toBeTruthy()
  })
})

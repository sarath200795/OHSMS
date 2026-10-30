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
    const extinguishers = screen.getByRole('link', { name: 'Extinguishers' })
    const aed = screen.getByRole('link', { name: 'AED' })
    expect(extinguishers.getAttribute('href')).toBe('/equipment/extinguishers')
    const extIdle = extinguishers.querySelector('.field-idle')
    const aedIdle = aed.querySelector('.field-idle')
    expect(extIdle.className).toContain('field-idle-sway')
    expect(aedIdle.className).toContain('field-idle-pulse')
    expect(extinguishers.className).not.toContain('logo-hover')
    expect(aed.className).not.toContain('logo-hover')
    expect(extIdle.style.animationDelay).not.toBe(aedIdle.style.animationDelay)
    expect(extIdle.style.animationDuration).not.toBe('')
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

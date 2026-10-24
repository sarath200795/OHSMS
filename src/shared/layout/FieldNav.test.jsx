// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import FieldNav from './FieldNav'

afterEach(cleanup)

describe('FieldNav', () => {
  it('offers the five field destinations as links', () => {
    render(
      <MemoryRouter>
        <FieldNav />
      </MemoryRouter>
    )
    const bar = screen.getByRole('navigation', { name: 'Field' })
    expect(bar).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Scan QR' }).getAttribute('href')).toBe('/field/scan')
    expect(
      screen.getByRole('link', { name: 'My tasks and inspections' }).getAttribute('href')
    ).toBe('/field/tasks')
    expect(screen.getByRole('link', { name: 'Report incident' }).getAttribute('href')).toBe(
      '/portal/report'
    )
    expect(screen.getByRole('link', { name: 'Defects' }).getAttribute('href')).toBe(
      '/equipment/defects'
    )
    expect(screen.getByRole('link', { name: 'Sites' }).getAttribute('href')).toBe('/sites')
  })
})

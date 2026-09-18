// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import ModuleTabs from './ModuleTabs'

afterEach(cleanup)

const TABS = [
  { to: '/permits', label: 'Permits', end: true },
  { to: '/permits/approvals', label: 'Approvals' },
]

function renderAt(path, props = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ModuleTabs tabs={TABS} {...props} />
    </MemoryRouter>
  )
}

describe('ModuleTabs', () => {
  it('marks the matching tab as the current page', () => {
    renderAt('/permits/approvals')
    const approvals = screen.getByRole('link', { name: 'Approvals' })
    expect(approvals.getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Permits' }).getAttribute('aria-current')).toBeNull()
  })

  it('honours an explicit active flag (Emergency Response site pages)', () => {
    render(
      <MemoryRouter initialEntries={['/emergency-response/sites/abc']}>
        <ModuleTabs
          tabs={[
            { to: '/emergency-response', label: 'Site Repository', end: true, active: true },
            { to: '/emergency-response/baseline', label: 'Baseline Plans', active: false },
          ]}
        />
      </MemoryRouter>
    )
    expect(screen.getByRole('link', { name: 'Site Repository' }).className).toMatch(
      /nav-tab-active/
    )
  })
})

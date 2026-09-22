// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import LoginModules from './LoginModules'
import { loginBrief } from './loginBriefs'
import { MODULES } from '../../shared/modules/registry'

describe('LoginModules', () => {
  it('lists every module as a short one-line brief', () => {
    render(<LoginModules />)
    expect(screen.getByRole('heading', { name: /^modules$/i })).toBeTruthy()
    for (const m of MODULES) {
      const brief = loginBrief(m)
      expect(screen.getByText(m.label)).toBeTruthy()
      expect(screen.getByText(brief)).toBeTruthy()
      expect(brief.length).toBeLessThan(42)
    }
  })

  it('pairs each line with a small glass mark, not a tile', () => {
    const { container } = render(<LoginModules />)
    expect(container.querySelector('.glass-tile')).toBeNull()
    const section = container.querySelector('section')
    expect(section.className).toMatch(/max-w-md/)
    expect(section.className).toMatch(/login-glass/)
    const rows = container.querySelectorAll('li')
    expect(rows.length).toBe(MODULES.length)
    rows.forEach((row) => {
      expect(row.className).toMatch(/login-line/)
      expect(row.className).toMatch(/py-1/)
      const mark = row.querySelector('.glass-mark')
      expect(mark).toBeTruthy()
      expect(mark.className).toMatch(/h-5/)
      expect(mark.className).toMatch(/w-5/)
      expect(mark.querySelector('svg')).toBeTruthy()
    })
  })
})

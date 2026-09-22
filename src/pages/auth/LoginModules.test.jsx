// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import LoginModules, { loginBrief } from './LoginModules'
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

  it('is a narrow line list, not a tile grid', () => {
    const { container } = render(<LoginModules />)
    expect(container.querySelector('.glass-tile')).toBeNull()
    const section = container.querySelector('section')
    expect(section.className).toMatch(/max-w-md/)
    const list = container.querySelector('ul')
    expect(list.className).not.toMatch(/grid-cols/)
    const rows = list.querySelectorAll('li')
    expect(rows.length).toBe(MODULES.length)
    rows.forEach((row) => {
      expect(row.className).toMatch(/py-1/)
      expect(row.className).toMatch(/leading-tight/)
      expect(row.querySelectorAll('span').length).toBe(2)
    })
  })
})
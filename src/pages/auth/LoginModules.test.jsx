// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import LoginModules from './LoginModules'
import { MODULES } from '../../shared/modules/registry'

describe('LoginModules', () => {
  it('lists every registry module with its label and full brief', () => {
    render(<LoginModules />)
    expect(screen.getByRole('heading', { name: /what you can run in wehs/i })).toBeTruthy()
    for (const m of MODULES) {
      expect(screen.getByText(m.label)).toBeTruthy()
      expect(screen.getByText(m.description)).toBeTruthy()
    }
  })

  it('is a line list, not a tile grid', () => {
    const { container } = render(<LoginModules />)
    expect(container.querySelector('.glass-tile')).toBeNull()
    expect(container.querySelector('svg')).toBeNull()
    const list = container.querySelector('ul')
    expect(list.className).toMatch(/divide-y/)
    expect(list.className).not.toMatch(/grid-cols/)
    const rows = list.querySelectorAll('li')
    expect(rows.length).toBe(MODULES.length)
    rows.forEach((row) => {
      const name = row.querySelector('p')
      const brief = row.querySelectorAll('p')[1]
      expect(name.textContent.length).toBeGreaterThan(0)
      expect(brief.textContent.length).toBeGreaterThan(20)
    })
  })
})

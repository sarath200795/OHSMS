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
      expect(screen.getByRole('heading', { name: m.label })).toBeTruthy()
      expect(screen.getByText(m.description)).toBeTruthy()
    }
  })

  it('keeps icons as small accents beside text-forward briefs', () => {
    const { container } = render(<LoginModules />)
    const tiles = container.querySelectorAll('.glass-tile')
    expect(tiles.length).toBe(MODULES.length)
    const list = container.querySelector('ul')
    // Narrow phones stay single-column; two columns only from md up.
    expect(list.className).toMatch(/md:grid-cols-2/)
    expect(list.className).not.toMatch(/(?:^|\s)sm:grid-cols-2(?:\s|$)/)
    tiles.forEach((tile) => {
      // Text-forward: left-aligned row, not a centred logo stack.
      expect(tile.className).toMatch(/items-start/)
      expect(tile.className).toMatch(/text-left/)
      expect(tile.className).not.toMatch(/items-center/)
      expect(tile.className).not.toMatch(/text-center/)
      expect(tile.className).not.toMatch(/min-h-\[152px\]/)
      const accent = tile.querySelector('[class*="h-6"][class*="w-6"]')
      expect(accent).toBeTruthy()
      const icons = accent.querySelectorAll('svg')
      expect(icons.length).toBe(1)
      expect(icons[0].getAttribute('width')).toBe('14')
      const brief = tile.querySelector('p')
      expect(brief?.textContent?.length).toBeGreaterThan(20)
    })
  })
})

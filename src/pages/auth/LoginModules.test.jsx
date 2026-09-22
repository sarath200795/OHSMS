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
    tiles.forEach((tile) => {
      // Text-forward: left-aligned row, not a centred logo stack.
      expect(tile.className).toMatch(/items-start/)
      expect(tile.className).toMatch(/text-left/)
      expect(tile.className).not.toMatch(/items-center/)
      expect(tile.className).not.toMatch(/text-center/)
      expect(tile.className).not.toMatch(/min-h-\[152px\]/)
      const accent = tile.querySelector('.h-7.w-7, [class*="h-7"][class*="w-7"]')
      expect(accent).toBeTruthy()
      const icon = accent.querySelector('svg')
      // lucide size={14} → width/height 14 on the svg
      expect(icon?.getAttribute('width')).toBe('14')
      const brief = tile.querySelector('p')
      expect(brief?.textContent?.length).toBeGreaterThan(20)
    })
  })
})

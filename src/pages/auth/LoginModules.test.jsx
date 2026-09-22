// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import LoginModules from './LoginModules'
import { MODULES } from '../../shared/modules/registry'

describe('LoginModules', () => {
  it('lists every registry module with its label and description', () => {
    render(<LoginModules />)
    expect(screen.getByRole('heading', { name: /what you can run in wehs/i })).toBeTruthy()
    for (const m of MODULES) {
      expect(screen.getByRole('heading', { name: m.label })).toBeTruthy()
      expect(screen.getByText(m.description)).toBeTruthy()
    }
  })

  it('centres each module mark in a Liquid Glass tile', () => {
    const { container } = render(<LoginModules />)
    const tiles = container.querySelectorAll('.glass-tile')
    expect(tiles.length).toBe(MODULES.length)
    tiles.forEach((tile) => {
      expect(tile.className).toMatch(/items-center/)
      expect(tile.className).toMatch(/justify-center/)
      const mark = tile.querySelector('.place-items-center')
      expect(mark).toBeTruthy()
      expect(mark.className).toMatch(/h-11/)
      expect(mark.className).toMatch(/w-11/)
      const icon = mark.querySelector('svg')
      expect(icon?.classList.contains('block') || icon?.getAttribute('class')?.includes('block')).toBeTruthy()
    })
  })
})

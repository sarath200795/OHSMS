import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { desktopMarkClass } from './markMotion'

const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8')

describe('desktop module marks', () => {
  it('does not loop a logo just because the tile is on screen', () => {
    expect(desktopMarkClass(true)).toBe('logo-hover logo-phase')
    expect(desktopMarkClass(true)).not.toContain('playing')
    expect(desktopMarkClass(false)).toBe('logo-hover')
  })

  it('starts the idle and the 3D loop only for a fine pointer hover or focus', () => {
    expect(css).toContain('@media (hover: hover) and (pointer: fine)')
    expect(css).toContain('.logo-hover .field-idle')
    expect(css).toContain('.logo-hover:focus-visible .field-idle-float')
    expect(css).toContain('@media not ((hover: hover) and (pointer: fine))')
    const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toContain('.field-idle')
    expect(reduced).toContain(".logo-phase [class*='animate-']")
  })
})

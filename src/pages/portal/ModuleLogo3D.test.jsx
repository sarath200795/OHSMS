// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import ModuleLogo3D, { has3DLogo } from './ModuleLogo3D'

afterEach(cleanup)

describe('ModuleLogo3D', () => {
  it('keeps the grid as the containing block so slabs centre as boxes', () => {
    expect(has3DLogo('incidents')).toBe(true)
    const { container } = render(<ModuleLogo3D moduleKey="incidents" />)
    const scene = container.firstElementChild
    expect(scene.className).toMatch(/grid/)
    expect(scene.className).toMatch(/place-items-center/)
    // A 0×0 anchor at 50%/50% pins each slab's top-left to the centre, so the
    // artwork grows down and to the right of the tile. The grid has to be the
    // containing block or Home / All Modules shifts every mark.
    expect(container.querySelector('.left-1\\/2.top-1\\/2.h-0')).toBeNull()
  })

  it('renders nothing for modules without a built object', () => {
    const { container } = render(<ModuleLogo3D moduleKey="not-a-module" />)
    expect(container.firstChild).toBeNull()
  })
})

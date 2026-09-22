// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import ModuleLogo3D, { has3DLogo } from './ModuleLogo3D'

afterEach(cleanup)

describe('ModuleLogo3D', () => {
  it('anchors absolute slabs on a centred origin so logos sit in the mark', () => {
    expect(has3DLogo('incidents')).toBe(true)
    const { container } = render(<ModuleLogo3D moduleKey="incidents" />)
    const origin = container.querySelector('.absolute.left-1\\/2.top-1\\/2')
    expect(origin).toBeTruthy()
    expect(origin.className).toMatch(/h-0/)
    expect(origin.className).toMatch(/w-0/)
  })

  it('renders nothing for modules without a built object', () => {
    const { container } = render(<ModuleLogo3D moduleKey="not-a-module" />)
    expect(container.firstChild).toBeNull()
  })
})

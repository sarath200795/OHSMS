// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import BrandMark from './BrandMark'
import { WE_EHS_MARK } from './OrgMark'

describe('BrandMark', () => {
  it('centres the WEHS mark inside a Liquid Glass disc', () => {
    const { container } = render(<BrandMark alt="WEHS" />)
    const disc = container.firstChild
    expect(disc.className).toMatch(/glass-mark/)
    expect(disc.className).toMatch(/place-items-center/)
    const img = container.querySelector('img')
    expect(img.getAttribute('src')).toBe(WE_EHS_MARK)
    expect(img.className).toMatch(/object-contain/)
    expect(img.className).toMatch(/h-\[82%\]/)
  })

  it('hides the image from assistive tech when alt is empty', () => {
    const { container } = render(<BrandMark alt="" />)
    expect(container.querySelector('img').getAttribute('aria-hidden')).toBe('true')
  })
})

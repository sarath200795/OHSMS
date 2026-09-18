// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import ModuleMark from './ModuleMark'

afterEach(cleanup)

describe('ModuleMark', () => {
  it('puts the registry tone on a glass disc so every surface shares one chrome', () => {
    const { container } = render(
      <ModuleMark tone="red">
        <span>IR</span>
      </ModuleMark>
    )
    const mark = container.querySelector('.glass-mark')
    expect(mark).toBeTruthy()
    expect(mark.getAttribute('data-tone')).toBe('red')
    expect(mark.textContent).toBe('IR')
  })

  it('accepts a hex tint without a tone, for analytics tiles that carry their own colour', () => {
    const { container } = render(<ModuleMark tint="#6db3aa" size="sm" />)
    const mark = container.querySelector('.glass-mark')
    expect(mark.getAttribute('data-tone')).toBeNull()
    expect(mark.style.getPropertyValue('--mark-tint')).toBe('#6db3aa')
    expect(mark.style.getPropertyValue('--mark-ink')).toMatch(/^#/)
    expect(mark.className).toMatch(/h-10/)
  })
})

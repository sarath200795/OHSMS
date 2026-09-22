// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import LoginFloatLogos from './LoginFloatLogos'
import { MODULES } from '../../shared/modules/registry'

describe('LoginFloatLogos', () => {
  it('floats a repeated, large backdrop mark per module', () => {
    const { container } = render(<LoginFloatLogos />)
    const field = container.querySelector('.login-float')
    expect(field.getAttribute('aria-hidden')).toBe('true')
    const marks = container.querySelectorAll('.login-float-mark')
    expect(marks.length).toBe(MODULES.length * 2)
    marks.forEach((mark) => {
      expect(mark.className).toMatch(/glass-mark/)
      expect(mark.querySelector('svg')).toBeTruthy()
      expect(mark.style.animationDuration).toBeTruthy()
      expect(Number.parseInt(mark.style.width, 10)).toBeGreaterThanOrEqual(44)
    })
  })
})

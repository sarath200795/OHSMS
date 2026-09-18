import { describe, it, expect } from 'vitest'
import { contrastRatio } from '../../../shared/lib/contrast'
import { DUE_TEXT_COLOR, dueTextColor } from './assetLogic'

// The surfaces the due-date text actually sits on. `#ffffff` is the token;
// `#fcf7ec` is white frost at 72% over amber canvas (the composited card).
// Canvas is the floor underneath both.
const SURFACES = {
  card: '#fcf7ec',
  surface: '#ffffff',
  canvas: '#f6e3bb',
}

describe('DUE_TEXT_COLOR', () => {
  it('clears WCAG AA on amber+white glass for every due state', () => {
    for (const [state, color] of Object.entries(DUE_TEXT_COLOR)) {
      for (const [name, surface] of Object.entries(SURFACES)) {
        expect(
          contrastRatio(color, surface),
          `${state} (${color}) on ${name} (${surface})`
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('falls back to the ok stop for an unknown state', () => {
    expect(dueTextColor(null)).toBe(DUE_TEXT_COLOR.ok)
    expect(dueTextColor('mystery')).toBe(DUE_TEXT_COLOR.ok)
  })
})

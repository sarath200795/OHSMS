import { describe, it, expect } from 'vitest'
import { contrastRatio } from '../../../shared/lib/contrast'
import { DUE_TEXT_COLOR, dueTextColor } from './assetLogic'

// The surfaces the due-date text actually sits on. `#151b36` is the token;
// `#131932` is the composited card axe measured on the extinguisher list
// (glass + hairline + elevation). Canvas is the floor underneath both.
const SURFACES = {
  card: '#131932',
  surface: '#151b36',
  canvas: '#0c1024',
}

describe('DUE_TEXT_COLOR', () => {
  // The previous white-card palette (red-800 / amber-800 / slate-600) dropped
  // to ~2.3:1 on navy glass. Axe failed the extinguisher repository on
  // "in 300d". These numbers are the whole point of the palette.
  it('clears WCAG AA on dark glass for every due state', () => {
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

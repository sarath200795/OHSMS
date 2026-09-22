// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { contrastRatio, lightCanvas, tintOver } from '../lib/contrast'
import {
  DEFAULT_ACCENT,
  DEFAULT_CANVAS,
  applyOrgTheme,
  brandScale,
  cssVarsFromTokens,
  extractPaletteFromImageData,
  isHexColor,
  normalizeTheme,
  nextTheme,
  paletteFromLogo,
  readTheme,
  sampleSrcForLogo,
  shouldSampleLogo,
  themePatchForLogo,
  themeTokens,
} from './theme'

function imageDataFromPixels(pixels) {
  const data = new Uint8ClampedArray(pixels.flat())
  return { data, width: pixels.length, height: 1 }
}

describe('readTheme / normalizeTheme', () => {
  it('treats missing fields as unset, not as the kit default', () => {
    expect(readTheme(undefined)).toEqual({ accent: null, canvas: null, canvasSource: null })
    expect(readTheme({ accent: 'navy' }).accent).toBeNull()
  })

  it('normalises a stored map onto kit defaults', () => {
    expect(normalizeTheme(null)).toEqual({
      accent: DEFAULT_ACCENT,
      canvas: DEFAULT_CANVAS,
      canvasSource: 'default',
    })
    expect(
      normalizeTheme({ accent: '#4A90D9', canvas: '#FAF3EA', canvasSource: 'custom' })
    ).toEqual({
      accent: '#4a90d9',
      canvas: '#faf3ea',
      canvasSource: 'custom',
    })
  })
})

describe('isHexColor', () => {
  it('accepts #rrggbb only', () => {
    expect(isHexColor('#f6e3bb')).toBe(true)
    expect(isHexColor('#FFF')).toBe(false)
    expect(isHexColor('red')).toBe(false)
  })
})

describe('extractPaletteFromImageData', () => {
  it('picks the saturated hue, not the white paper around it', () => {
    const red = [200, 32, 40, 255]
    const white = [255, 255, 255, 255]
    const clear = [0, 0, 0, 0]
    const { accent } = extractPaletteFromImageData(
      imageDataFromPixels([red, red, red, red, white, white, clear])
    )
    const [r, g, b] = [
      parseInt(accent.slice(1, 3), 16),
      parseInt(accent.slice(3, 5), 16),
      parseInt(accent.slice(5, 7), 16),
    ]
    expect(r).toBeGreaterThan(g)
    expect(r).toBeGreaterThan(b)
  })

  it('does not let a warm off-white field outvote the mark', () => {
    // HSL saturation of this cream is ~0.39 because it divides by (1−L).
    // Chroma is ~0.06. The mark has to win, and the cream has to become the wash.
    const red = [180, 35, 24, 255]
    const cream = [243, 239, 228, 255]
    const { accent, canvasWash } = extractPaletteFromImageData(
      imageDataFromPixels([cream, cream, cream, cream, cream, cream, red, red, red])
    )
    const r = parseInt(accent.slice(1, 3), 16)
    const g = parseInt(accent.slice(3, 5), 16)
    expect(r).toBeGreaterThan(g + 40)
    expect(contrastRatio('#26211a', canvasWash)).toBeGreaterThanOrEqual(4.5)
    expect(canvasWash.toLowerCase()).not.toBe(DEFAULT_CANVAS)
  })

  it('falls back to the kit teal when the bitmap is empty or fully transparent', () => {
    expect(extractPaletteFromImageData(imageDataFromPixels([[0, 0, 0, 0]])).accent).toBe(
      DEFAULT_ACCENT
    )
    expect(extractPaletteFromImageData({ data: new Uint8ClampedArray(0) }).canvasWash).toBe(
      DEFAULT_CANVAS
    )
  })

  it('returns a canvas wash ink can sit on', () => {
    const navy = [11, 31, 58, 255]
    const { canvasWash } = extractPaletteFromImageData(imageDataFromPixels([navy, navy, navy]))
    expect(contrastRatio('#26211a', canvasWash)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('themeTokens', () => {
  it('keeps the kit defaults when nothing is passed', () => {
    const t = themeTokens()
    expect(t.canvas).toBe(DEFAULT_CANVAS)
    expect(t.accent).toBe(DEFAULT_ACCENT)
  })

  it('makes brand-600 carry white text at AA', () => {
    for (const accent of ['#6db3aa', '#4a90d9', '#e8a33d', '#c43d32', '#8fbc74']) {
      const scale = brandScale(accent)
      expect(contrastRatio('#ffffff', scale[600]), accent).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('makes brand-700 readable on the soft button wash over canvas', () => {
    // The smoke axe failure: kit teal 700 generated as #376a63 on 14% teal
    // over amber was 4.46:1. `.btn-soft` is that composite.
    const t = themeTokens()
    const soft = tintOver(t.accent, t.canvas, 0.14)
    expect(contrastRatio(t.brand[700], soft)).toBeGreaterThanOrEqual(4.5)
    for (const accent of ['#4a90d9', '#e8a33d', '#c43d32', '#8fbc74']) {
      const tokens = themeTokens({ accent, canvas: DEFAULT_CANVAS })
      const bg = tintOver(tokens.accent, tokens.canvas, 0.14)
      expect(contrastRatio(tokens.brand[700], bg), accent).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('washes a dark canvas until ink is AA', () => {
    const t = themeTokens({ accent: '#4a90d9', canvas: '#0b1f3a' })
    expect(contrastRatio('#26211a', t.canvas)).toBeGreaterThanOrEqual(4.5)
    expect(t.canvas).not.toBe('#0b1f3a')
  })
})

describe('cssVarsFromTokens / applyOrgTheme', () => {
  afterEach(() => applyOrgTheme(null))

  it('writes --canvas and --brand-400 from the tokens', () => {
    const vars = cssVarsFromTokens(themeTokens({ accent: '#4a90d9', canvas: '#faf3ea' }))
    expect(vars['--canvas']).toBe('#faf3ea')
    expect(vars['--brand-400']).toBe('#4a90d9')
    expect(vars['--brand-rgb']).toMatch(/^\d+, \d+, \d+$/)
    expect(vars['--canvas-rgb']).toMatch(/^\d+ \d+ \d+$/)
  })

  it('sets and clears properties on documentElement', () => {
    applyOrgTheme(themeTokens({ accent: '#4a90d9', canvas: '#faf3ea' }))
    expect(document.documentElement.style.getPropertyValue('--canvas')).toBe('#faf3ea')
    applyOrgTheme(null)
    expect(document.documentElement.style.getPropertyValue('--canvas')).toBe('')
  })
})

describe('nextTheme', () => {
  it('keeps a custom canvas when only the accent changes', () => {
    const next = nextTheme(
      { accent: '#6db3aa', canvas: '#faf3ea', canvasSource: 'custom' },
      { accent: '#4a90d9' }
    )
    expect(next.accent).toBe('#4a90d9')
    expect(next.canvas).toBe('#faf3ea')
    expect(next.canvasSource).toBe('custom')
  })

  it('lightens a custom canvas that would fail AA', () => {
    const next = nextTheme(null, { canvas: '#000000', canvasSource: 'custom' })
    expect(next.canvas).toBe(lightCanvas('#000000'))
    expect(contrastRatio('#26211a', next.canvas)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('paletteFromLogo / shouldSampleLogo / themePatchForLogo', () => {
  it('rejects the extractor fallback so a failed read is not stored as the brand', () => {
    expect(paletteFromLogo(null)).toBeNull()
    expect(paletteFromLogo({ accent: DEFAULT_ACCENT, canvasWash: DEFAULT_CANVAS })).toBeNull()
    expect(paletteFromLogo({ accent: '#c43d32', canvasWash: '#f8e4e2' })).toEqual({
      accent: '#c43d32',
      canvas: '#f8e4e2',
    })
  })

  it('samples when a logo is paired with the kit default map, not when the owner already chose', () => {
    const kit = { accent: DEFAULT_ACCENT, canvas: DEFAULT_CANVAS, canvasSource: 'default' }
    expect(shouldSampleLogo(undefined, true)).toBe(true)
    expect(shouldSampleLogo(kit, true)).toBe(true)
    expect(
      shouldSampleLogo({ accent: '#c43d32', canvas: '#f8e4e2', canvasSource: 'logo' }, true)
    ).toBe(false)
    expect(
      shouldSampleLogo({ accent: '#c43d32', canvas: '#ffffff', canvasSource: 'custom' }, true)
    ).toBe(false)
    // Amber wash picked after a real accent: do not resample over it.
    expect(
      shouldSampleLogo({ accent: '#c43d32', canvas: DEFAULT_CANVAS, canvasSource: 'default' }, true)
    ).toBe(false)
    expect(shouldSampleLogo(undefined, false)).toBe(false)
  })

  it('persists logo colours and keeps a custom canvas', () => {
    const patched = themePatchForLogo(
      { accent: DEFAULT_ACCENT, canvas: '#ffffff', canvasSource: 'custom' },
      { accent: '#c43d32', canvasWash: '#f8e4e2' }
    )
    expect(patched.canvasSource).toBe('custom')
    expect(patched.canvas).toBe('#ffffff')
    expect(patched.accent).toBe('#c43d32')

    const fromLogo = themePatchForLogo(null, { accent: '#c43d32', canvasWash: '#f8e4e2' })
    expect(fromLogo.canvasSource).toBe('logo')
    expect(fromLogo.accent).toBe('#c43d32')
    expect(
      themePatchForLogo(null, { accent: DEFAULT_ACCENT, canvasWash: DEFAULT_CANVAS })
    ).toBeNull()
  })

  it('samples the inline thumb rather than a cross-origin download URL', () => {
    expect(sampleSrcForLogo('data:image/jpeg;base64,thumb', 'https://cdn.example/logo.jpg')).toBe(
      'data:image/jpeg;base64,thumb'
    )
    expect(sampleSrcForLogo('data:image/jpeg;base64,thumb', 'blob:logo')).toBe('blob:logo')
    expect(sampleSrcForLogo('', 'https://cdn.example/logo.jpg')).toBe(
      'https://cdn.example/logo.jpg'
    )
    expect(sampleSrcForLogo('', '')).toBe('')
  })
})

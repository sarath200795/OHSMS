import { describe, it, expect } from 'vitest'
import { contrastRatio, parseHex, readableOnTint, solidBackground, tintOver } from './contrast'

describe('parseHex', () => {
  it('reads both shorthand and full form', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255])
    expect(parseHex('#16a34a')).toEqual([22, 163, 74])
    expect(parseHex('16a34a')).toEqual([22, 163, 74])
  })
  it('returns null rather than guessing', () => {
    expect(parseHex('rebeccapurple')).toBeNull()
    expect(parseHex('#ab')).toBeNull()
    expect(parseHex(null)).toBeNull()
  })
})

describe('contrastRatio', () => {
  // The two anchors of the scale — if these drift, the formula is wrong.
  it('is 21 for black on white and 1 for a colour on itself', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
    expect(contrastRatio('#16a34a', '#16a34a')).toBeCloseTo(1, 5)
  })
  it('is symmetric', () => {
    expect(contrastRatio('#16a34a', '#ffffff')).toBeCloseTo(contrastRatio('#ffffff', '#16a34a'), 10)
  })
})

describe('tintOver', () => {
  it('composites 10% of the colour over the surface', () => {
    // A 10% tint is much closer to the surface than to the colour.
    const tint = tintOver('#000000', '#ffffff')
    expect(parseHex(tint)[0]).toBe(230)
  })
})

describe('readableOnTint', () => {
  // These are the exact chips axe measured, with the ratios it reported.
  const FAILING = {
    healthy: '#16a34a',
    pin: '#a855f7',
    stand: '#0891b2',
    hose: '#d97706',
    handle: '#db2777',
    empty: '#dc2626',
  }

  it('lifts every failing category chip to AA', () => {
    for (const [name, color] of Object.entries(FAILING)) {
      const text = readableOnTint(color)
      const bg = tintOver(color)
      expect(contrastRatio(text, bg), `${name} (${color} → ${text})`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('leaves a colour that already passes exactly as it is', () => {
    // Near-black on its own near-white tint is already far past 4.5.
    expect(readableOnTint('#1b1610')).toBe('#1b1610')
  })

  it('keeps the hue, so a green chip still reads as green', () => {
    const [r, g, b] = parseHex(readableOnTint('#16a34a'))
    expect(g).toBeGreaterThan(r)
    expect(g).toBeGreaterThan(b)
  })

  it('keeps distinct colours distinct', () => {
    const results = Object.values(FAILING).map((c) => readableOnTint(c))
    expect(new Set(results).size).toBe(results.length)
  })

  it('passes a non-colour straight through rather than throwing', () => {
    expect(readableOnTint('currentColor')).toBe('currentColor')
    expect(readableOnTint(undefined)).toBe(undefined)
  })
})

describe('solidBackground', () => {
  // The solid badge writes white text on the fill, and the lighter half of the
  // palette does not carry white at AA.
  it('darkens a fill that white text cannot sit on', () => {
    for (const color of ['#0891b2', '#16a34a', '#f59e0b', '#a855f7']) {
      const bg = solidBackground(color)
      expect(contrastRatio('#ffffff', bg), `${color} → ${bg}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('leaves a fill that already carries white exactly as it is', () => {
    expect(solidBackground('#6f2f24')).toBe('#6f2f24')
  })

  it('keeps the hue', () => {
    const [r, g, b] = parseHex(solidBackground('#0891b2'))
    expect(b).toBeGreaterThan(r)
    expect(g).toBeGreaterThan(r)
  })
})

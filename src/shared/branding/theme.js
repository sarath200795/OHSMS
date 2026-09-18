// ─────────────────────────────────────────────────────────────────────────────
// Organization theme: logo → accents, owner → canvas.
//
// The Liquid Glass kit is a handful of CSS variables (`--canvas`, `--brand-*`).
// An uploaded mark is sampled on the client (never sent anywhere) and those
// variables are rewritten so selections, primary buttons and the page wash
// match the brand. The owner can also pick the page background; that pick is
// stored on the org document next to the logo, which is why every member sees
// the same chrome.
//
// Two reasons the sample is persisted rather than re-run on every page load:
// decoders disagree about a pixel or two, and a member whose logo blob fails
// CORS would otherwise sit on the default teal forever. Runtime sampling is
// only the fallback for a logo uploaded before this field existed.
//
// Contrast: body ink is `#26211a` and does not flip. A navy the owner picks
// is washed toward white until that ink clears AA (`lightCanvas`). Brand-600
// is darkened until white text clears AA (`solidBackground`). A colour that
// already passes is left alone.
// ─────────────────────────────────────────────────────────────────────────────
import {
  contrastRatio,
  lightCanvas,
  mixHex,
  parseHex,
  readableOnTint,
  solidBackground,
  tintOver,
} from '../lib/contrast'

export const DEFAULT_CANVAS = '#f6e3bb'
export const DEFAULT_ACCENT = '#6db3aa'

export const DEFAULT_THEME = {
  accent: DEFAULT_ACCENT,
  canvas: DEFAULT_CANVAS,
  canvasSource: 'default',
}

/** Swatches on the org branding card. Logo-derived wash is appended in the UI. */
export const CANVAS_SWATCHES = [
  { id: 'amber', hex: DEFAULT_CANVAS, label: 'Amber wash' },
  { id: 'cream', hex: '#faf3ea', label: 'Cream' },
  { id: 'paper', hex: '#f4f1ea', label: 'Paper' },
  { id: 'white', hex: '#ffffff', label: 'White' },
  { id: 'mist', hex: '#e8f4f2', label: 'Mist' },
  { id: 'sand', hex: '#f0e6d2', label: 'Sand' },
]

const HEX = /^#([0-9a-fA-F]{6})$/

export function isHexColor(value) {
  return typeof value === 'string' && HEX.test(value.trim())
}

function normHex(value) {
  return isHexColor(value) ? `#${value.trim().replace(/^#/, '').toLowerCase()}` : null
}

function toHex([r, g, b]) {
  return (
    '#' +
    [r, g, b]
      .map((v) =>
        Math.max(0, Math.min(255, Math.round(v)))
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
  )
}

function rgbSpace(hex) {
  const rgb = parseHex(hex)
  return rgb ? rgb.join(' ') : '0 0 0'
}

function rgbComma(hex) {
  const rgb = parseHex(hex)
  return rgb ? rgb.join(', ') : '0, 0, 0'
}

function rgbToHsl(r, g, b) {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h =
    max === r
      ? ((g - b) / d + (g < b ? 6 : 0)) / 6
      : max === g
        ? ((b - r) / d + 2) / 6
        : ((r - g) / d + 4) / 6
  return [h, s, l]
}

/**
 * Read the stored org.theme map. Invalid / missing fields are null so the
 * caller can tell "never set" from "explicitly the kit default" and know
 * whether to sample the logo.
 */
export function readTheme(raw) {
  if (!raw || typeof raw !== 'object') {
    return { accent: null, canvas: null, canvasSource: null }
  }
  const source = raw.canvasSource
  return {
    accent: normHex(raw.accent),
    canvas: normHex(raw.canvas),
    canvasSource: source === 'logo' || source === 'custom' || source === 'default' ? source : null,
  }
}

export function normalizeTheme(raw) {
  const t = readTheme(raw)
  return {
    accent: t.accent || DEFAULT_ACCENT,
    canvas: t.canvas || DEFAULT_CANVAS,
    canvasSource: t.canvasSource || 'default',
  }
}

/**
 * Brand scale from one accent. 400 is the sampled colour (rings, glass tint);
 * 600 is the AA solid for white text; 50–300 are washes; 700+ are ink on tints.
 *
 * 700 is the colour of `.btn-soft` / `text-brand-700`. Those sit on a 14%
 * accent wash over the canvas (and sometimes on white frost). Mixing a fixed
 * 18% toward black was how kit teal produced `#376a63` and failed axe at
 * 4.46:1 on that composite — so 700 is darkened until it clears 4.5:1 on
 * the soft fill, the canvas, and white.
 */
export function brandScale(accent, canvas = DEFAULT_CANVAS) {
  const hex = normHex(accent) || DEFAULT_ACCENT
  const solid = solidBackground(hex)
  const wash = lightCanvas(canvas)
  const seven = inkOnSoft(hex, wash, mixHex(solid, '#000000', 0.18))
  return {
    50: mixHex(hex, '#ffffff', 0.92),
    100: mixHex(hex, '#ffffff', 0.82),
    200: mixHex(hex, '#ffffff', 0.68),
    300: mixHex(hex, '#ffffff', 0.4),
    400: hex,
    500: mixHex(hex, solid, 0.55),
    600: solid,
    700: seven,
    800: mixHex(seven, '#000000', 0.18),
    900: mixHex(seven, '#000000', 0.32),
  }
}

function inkOnSoft(accent, canvas, seed) {
  const surfaces = [tintOver(accent, canvas, 0.14), canvas, '#ffffff']
  const ok = (c) => surfaces.every((bg) => contrastRatio(c, bg) >= 4.5)
  if (ok(seed)) return seed
  for (let t = 0.02; t <= 1; t += 0.02) {
    const candidate = mixHex(seed, '#000000', t)
    if (ok(candidate)) return candidate
  }
  return '#000000'
}

/** Tokens the CSS / Tailwind variables consume. Always contrast-checked. */
export function themeTokens({ accent, canvas } = {}) {
  const wash = lightCanvas(canvas || DEFAULT_CANVAS)
  const brand = brandScale(accent || DEFAULT_ACCENT, wash)
  return {
    accent: brand[400],
    canvas: wash,
    brand,
    inkOnBrand: readableOnTint(brand[400], wash),
  }
}

const VAR_KEYS = [
  '--canvas',
  '--canvas-rgb',
  '--teal',
  '--brand-rgb',
  '--brand-600-rgb-comma',
  '--brand-ink',
  '--brand-50',
  '--brand-50-rgb',
  '--brand-100',
  '--brand-100-rgb',
  '--brand-200',
  '--brand-200-rgb',
  '--brand-300',
  '--brand-300-rgb',
  '--brand-400',
  '--brand-400-rgb',
  '--brand-500',
  '--brand-500-rgb',
  '--brand-600',
  '--brand-600-rgb',
  '--brand-700',
  '--brand-700-rgb',
  '--brand-800',
  '--brand-800-rgb',
  '--brand-900',
  '--brand-900-rgb',
]

export function cssVarsFromTokens(tokens) {
  const t = tokens || themeTokens(DEFAULT_THEME)
  const vars = {
    '--canvas': t.canvas,
    '--canvas-rgb': rgbSpace(t.canvas),
    '--teal': t.brand[400],
    '--brand-rgb': rgbComma(t.brand[400]),
    '--brand-600-rgb-comma': rgbComma(t.brand[600]),
    '--brand-ink': t.inkOnBrand,
  }
  for (const stop of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]) {
    vars[`--brand-${stop}`] = t.brand[stop]
    vars[`--brand-${stop}-rgb`] = rgbSpace(t.brand[stop])
  }
  return vars
}

/**
 * Write (or clear) the kit variables on <html>. Clearing restores the
 * `:root` defaults in index.css — which is what login, the platform console
 * and a signed-out tab should look like.
 */
export function applyOrgTheme(tokens) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (!tokens) {
    for (const key of VAR_KEYS) root.style.removeProperty(key)
    return
  }
  const vars = cssVarsFromTokens(tokens)
  for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value)
}

/**
 * Dominant saturated hue + a light wash from an ImageData.
 *
 * Transparent, near-white and near-black pixels are skipped so a mark on a
 * transparent PNG does not sample as "white" and a drop shadow does not
 * sample as "black". Unsaturated light pixels become the canvas candidate
 * (the cream paper in a logo); saturated pixels vote by hue bucket.
 */
export function extractPaletteFromImageData(imageData) {
  const data = imageData?.data
  if (!data || !data.length) {
    return { accent: DEFAULT_ACCENT, canvasWash: DEFAULT_CANVAS }
  }

  const buckets = new Map()
  let lightR = 0
  let lightG = 0
  let lightB = 0
  let lightN = 0

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const [h, s, l] = rgbToHsl(r, g, b)
    if (l > 0.93 || l < 0.07) continue
    if (s < 0.18) {
      if (l > 0.55) {
        lightR += r
        lightG += g
        lightB += b
        lightN += 1
      }
      continue
    }
    const bucket = Math.round(h * 36) % 36
    const cur = buckets.get(bucket) || { n: 0, r: 0, g: 0, b: 0, s: 0 }
    cur.n += 1
    cur.r += r
    cur.g += g
    cur.b += b
    cur.s += s
    buckets.set(bucket, cur)
  }

  let accent = DEFAULT_ACCENT
  if (buckets.size) {
    const best = [...buckets.values()].sort((a, b) => b.n - a.n || b.s / b.n - a.s / a.n)[0]
    accent = toHex([best.r / best.n, best.g / best.n, best.b / best.n])
  }

  let wash
  if (lightN > 0) {
    wash = toHex([lightR / lightN, lightG / lightN, lightB / lightN])
  } else {
    wash = mixHex(accent, '#ffffff', 0.82)
  }

  return { accent, canvasWash: lightCanvas(wash) }
}

function sampleToImageData(img) {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, size, size)
  return ctx.getImageData(0, 0, size, size)
}

export function extractPaletteFromImage(img) {
  if (!img) return { accent: DEFAULT_ACCENT, canvasWash: DEFAULT_CANVAS }
  const imageData = sampleToImageData(img)
  if (!imageData) return { accent: DEFAULT_ACCENT, canvasWash: DEFAULT_CANVAS }
  return extractPaletteFromImageData(imageData)
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    if (typeof Image === 'undefined') {
      reject(new Error('no Image'))
      return
    }
    const img = new Image()
    if (src && !src.startsWith('blob:') && !src.startsWith('data:')) {
      img.crossOrigin = 'anonymous'
    }
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('logo image failed to load'))
    img.src = src
  })
}

export async function extractPaletteFromSrc(src) {
  if (!src) return { accent: DEFAULT_ACCENT, canvasWash: DEFAULT_CANVAS }
  const img = await loadImage(src)
  return extractPaletteFromImage(img)
}

export async function extractPaletteFromFile(file) {
  const url = URL.createObjectURL(file)
  try {
    return await extractPaletteFromSrc(url)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Merge a partial theme onto the current one, filling contrast-safe defaults. */
export function nextTheme(current, patch) {
  const base = normalizeTheme(current)
  const accent = normHex(patch.accent) || base.accent
  const canvasSource = patch.canvasSource || base.canvasSource
  const canvasRaw = normHex(patch.canvas) || base.canvas
  return {
    accent,
    canvas: lightCanvas(canvasRaw),
    canvasSource,
  }
}

/** True when the stored (or derived) theme differs from the kit defaults. */
export function isCustomTheme(theme) {
  const t = normalizeTheme(theme)
  return t.accent !== DEFAULT_ACCENT || t.canvas !== DEFAULT_CANVAS || t.canvasSource !== 'default'
}

export { lightCanvas, mixHex }

// ─────────────────────────────────────────────────────────────────────────────
// Readable text on a tinted chip.
//
// The app's soft badge is one colour used twice: a 10% tint of it as the fill,
// and the colour itself as the text. That reads beautifully and fails WCAG AA
// for most mid-tone hues — the axe pass measured the green "No Defects
// (Healthy)" chip at 2.63:1 against a 4.5:1 requirement, and the purple, cyan,
// amber, pink and red category chips beside it between 2.57 and 3.71.
//
// It is not a per-chip mistake to be fixed per chip. It is what the pattern
// does, so the fix is a function the pattern calls: keep the hue and the
// saturation, take the lightness down until the text clears 4.5:1 on its own
// tint. The chip still reads as "the green one"; it is now also readable.
//
// Pure and colocated with a test, because the numbers here are the whole point
// and a regression in them is silent.
// ─────────────────────────────────────────────────────────────────────────────

/** #rgb / #rrggbb → [r, g, b]. Returns null for anything else. */
export function parseHex(hex) {
  if (typeof hex !== 'string') return null
  const h = hex.trim().replace(/^#/, '')
  if (h.length === 3) return [...h].map((c) => parseInt(c + c, 16))
  if (h.length === 6) return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  return null
}

const toHex = ([r, g, b]) =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')

const channel = (v) => {
  const s = v / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/** WCAG relative luminance. */
export function luminance(rgb) {
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2])
}

/** WCAG contrast ratio between two colours, 1–21. */
export function contrastRatio(a, b) {
  const [ra, rb] = [parseHex(a), parseHex(b)]
  if (!ra || !rb) return 1
  const [hi, lo] = [luminance(ra), luminance(rb)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * The colour a 10%-alpha tint of `hex` actually renders as, once composited
 * over `surface`. A browser reports the composited value to axe, not the alpha,
 * so this is what the ratio has to be measured against.
 */
export function tintOver(hex, surface = '#f8f1e4', alpha = 0.1) {
  const c = parseHex(hex)
  const s = parseHex(surface)
  if (!c || !s) return surface
  return toHex(c.map((v, i) => v * alpha + s[i] * (1 - alpha)))
}

function toHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h =
    max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6
    : max === g ? ((b - r) / d + 2) / 6
    : ((r - g) / d + 4) / 6
  return [h, s, l]
}

function fromHsl(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12
    const a = s * Math.min(l, 1 - l)
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))
  }
  return toHex([f(0), f(8), f(4)])
}

/**
 * A text colour for `hex` that is readable on `hex`'s own tint.
 *
 * Same hue, same saturation, lightness lowered only as far as it needs to go —
 * so a chip that was "the amber one" is still visibly amber. Returns `hex`
 * unchanged when it already clears the ratio, so colours that were fine are
 * untouched.
 *
 * @param hex      the chip's colour
 * @param surface  what the tint sits on (clay-surface by default)
 * @param target   required ratio; 4.5 is WCAG AA for body text
 */
/**
 * A background for `hex` that white text is readable on.
 *
 * The solid badge is `backgroundColor: color, color: '#fff'`, and for the
 * lighter half of the palette that is white on a mid-tone: the cyan used for
 * the "Stand" defect and the "Modular" extinguisher type measured 3.68:1.
 * Darkening the FILL rather than switching the text to black keeps every badge
 * in the app looking like one component — a set where some badges have white
 * labels and some black reads as two components.
 *
 * Same hue and saturation, lightness lowered only as far as needed, and colours
 * that already pass come back untouched.
 */
export function solidBackground(hex, target = 4.5) {
  const rgb = parseHex(hex)
  if (!rgb) return hex
  if (contrastRatio('#ffffff', hex) >= target) return hex
  const [h, s, l0] = toHsl(rgb)
  for (let l = l0; l >= 0; l -= 0.005) {
    const candidate = fromHsl(h, s, l)
    if (contrastRatio('#ffffff', candidate) >= target) return candidate
  }
  return '#000000'
}

export function readableOnTint(hex, surface = '#f8f1e4', target = 4.5) {
  const rgb = parseHex(hex)
  if (!rgb) return hex
  const bg = tintOver(hex, surface)
  if (contrastRatio(hex, bg) >= target) return hex

  const [h, s, l0] = toHsl(rgb)
  // 0.005 steps: fine enough that the result is never noticeably darker than it
  // had to be, coarse enough to finish in well under a millisecond.
  for (let l = l0; l >= 0; l -= 0.005) {
    const candidate = fromHsl(h, s, l)
    if (contrastRatio(candidate, bg) >= target) return candidate
  }
  return '#000000'
}

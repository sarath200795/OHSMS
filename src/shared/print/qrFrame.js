// One frame for every QR that ends up on paper.
//
// The LOTO sheet's table rule and the permit's QR box were a kraft hairline
// (#e8dcc8 / #e2e8f0, about 0.5pt). On white paper that prints as no border.
// The fire-label "border" was a Tailwind ring, which is a box-shadow, and the
// print stylesheet sets box-shadow: none so shadows don't muddy the sheet —
// which removed the only frame those labels had.
//
// This ink is the logo black (#26211a). The weight is a solid rule, the same
// physical size on a point page and a millimetre page, well above a hairline.

export const QR_FRAME_INK = '#26211a'
export const QR_FRAME_RGB = [38, 33, 26]

// 1.5pt ≈ 0.53mm. 0.55mm is that same rule on a page whose unit is millimetres
// (the tag sheet, and the A4 label print stylesheet).
export const QR_STROKE_PT = 1.5
export const QR_STROKE_MM = 0.55

/**
 * Box around a QR that does not already include a quiet zone.
 * `padding` is that zone and stays inside the stroke — a rule drawn on the
 * modules makes the code unscannable.
 */
export function qrFrameStyle(padding = 8) {
  return {
    background: '#ffffff',
    border: `2px solid ${QR_FRAME_INK}`,
    padding,
    lineHeight: 0,
    boxSizing: 'content-box',
    // A block box stretches to the column and the border becomes a wide bar
    // with the code in one corner. Hug the QR so the frame stays a box.
    display: 'inline-block',
    width: 'fit-content',
    maxWidth: '100%',
    verticalAlign: 'top',
  }
}

/**
 * Stroke only, for a code that already carries its quiet zone (qrcode.react
 * `includeMargin` is 4 modules). content-box keeps the stroke outside that
 * zone instead of eating it under border-box.
 */
export function qrCodeBorderStyle() {
  return {
    border: `2px solid ${QR_FRAME_INK}`,
    background: '#ffffff',
    boxSizing: 'content-box',
  }
}

/** Print-stylesheet fragment for a QR image. Same ink and weight as the box. */
export const QR_PRINT_CODE_RULE = `border: ${QR_STROKE_MM}mm solid ${QR_FRAME_INK} !important; box-sizing: content-box !important; background: #ffffff !important;`

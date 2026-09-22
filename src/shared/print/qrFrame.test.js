import { describe, it, expect } from 'vitest'
import {
  QR_FRAME_INK,
  QR_FRAME_RGB,
  QR_STROKE_PT,
  QR_STROKE_MM,
  QR_PRINT_CODE_RULE,
  qrFrameStyle,
  qrCodeBorderStyle,
} from './qrFrame'

// The border that shipped was a kraft hairline, and on a printed page it
// looked like the QR had no frame. These pin the replacement: dark, solid,
// and heavier than a hairline, with the quiet zone inside the stroke.
describe('printed QR frame', () => {
  it('is a solid dark rule, not a light hairline', () => {
    expect(QR_FRAME_INK).toBe('#26211a')
    expect(QR_FRAME_RGB).toEqual([38, 33, 26])
    expect(QR_STROKE_PT).toBeGreaterThanOrEqual(1)
    expect(QR_STROKE_MM).toBeGreaterThanOrEqual(0.4)

    const box = qrFrameStyle()
    expect(box.border).toBe('2px solid #26211a')
    expect(box.background).toBe('#ffffff')
    expect(box.padding).toBeGreaterThanOrEqual(4)
  })

  it('keeps padding inside the stroke so the quiet zone is not the border', () => {
    const box = qrFrameStyle(8)
    expect(box.padding).toBe(8)
    expect(box.boxSizing).toBe('content-box')
    expect(String(box.border).startsWith('2px solid')).toBe(true)
  })

  it('draws the stroke outside a code that already has its own margin', () => {
    const edge = qrCodeBorderStyle()
    expect(edge.border).toBe('2px solid #26211a')
    expect(edge.padding).toBeUndefined()
    expect(edge.boxSizing).toBe('content-box')
    expect(QR_PRINT_CODE_RULE).toContain('0.55mm solid #26211a')
    expect(QR_PRINT_CODE_RULE).toContain('content-box')
  })
})

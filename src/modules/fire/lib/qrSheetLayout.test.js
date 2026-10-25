import { describe, it, expect } from 'vitest'
import { QR_STROKE_MM } from '../../../shared/print/qrFrame'
import {
  CARD_H,
  CARD_W,
  COLS,
  GUTTER,
  INNER_H,
  INNER_W,
  LABELS_PER_PAGE,
  PAGE_H,
  PAGE_W,
  QR_SIZE,
  ROWS,
  labelContentBox,
  labelOrigin,
  qrSheetCss,
} from './qrSheetLayout'

describe('A4 QR sheet', () => {
  it('is fifteen labels, three across and five down', () => {
    expect(COLS).toBe(3)
    expect(ROWS).toBe(5)
    expect(LABELS_PER_PAGE).toBe(15)
    expect(PAGE_W).toBe(210)
    expect(PAGE_H).toBe(297)
  })

  it('uses one gutter for the page edge and the gap between cards', () => {
    const first = labelOrigin(0)
    const nextCol = labelOrigin(1)
    const nextRow = labelOrigin(COLS)
    const last = labelOrigin(LABELS_PER_PAGE - 1)

    expect(first.x).toBeCloseTo(GUTTER, 5)
    expect(first.y).toBeCloseTo(GUTTER, 5)
    expect(nextCol.x - (first.x + CARD_W)).toBeCloseTo(GUTTER, 5)
    expect(nextRow.y - (first.y + CARD_H)).toBeCloseTo(GUTTER, 5)
    expect(PAGE_W - (last.x + CARD_W)).toBeCloseTo(GUTTER, 5)
    expect(PAGE_H - (last.y + CARD_H)).toBeCloseTo(GUTTER, 5)

    for (let slot = 0; slot < LABELS_PER_PAGE; slot += 1) {
      const origin = labelOrigin(slot)
      expect(origin.x + CARD_W).toBeLessThanOrEqual(PAGE_W - GUTTER + 0.01)
      expect(origin.y + CARD_H).toBeLessThanOrEqual(PAGE_H - GUTTER + 0.01)
    }
  })

  it('keeps the identifying lines inside the card, under a code that still scans', () => {
    const box = labelContentBox()
    let ty = box.textTop
    const baselines = []
    for (let i = 0; i < box.titleLines; i += 1) {
      baselines.push(ty)
      ty += box.titleStep
    }
    for (let i = 0; i < box.metaLines; i += 1) {
      baselines.push(ty)
      ty += box.metaStep
    }
    // detail, site, location — three meta lines, and the last one has to be
    // the location. A card that fits only two of them is the old 12-up sheet.
    expect(box.metaLines).toBe(3)
    expect(baselines.at(-1)).toBeCloseTo(box.lastBaseline, 5)
    expect(box.lastBaseline).toBeLessThanOrEqual(box.limit)
    expect(box.limit).toBeLessThan(CARD_H)

    const strokeTop = box.qrTop - QR_STROKE_MM / 2
    const strokeBottom = box.qrTop + QR_SIZE + QR_STROKE_MM / 2
    expect(strokeTop).toBeGreaterThan(box.headerBaseline)
    expect(box.textTop).toBeGreaterThan(strokeBottom)

    // 41 modules is a normal public URL at ECC H; 53 is a long host. The PNG
    // adds one quiet-zone module on each side. Half a millimetre is the floor
    // a phone still reads off paper.
    expect(QR_SIZE / (41 + 2)).toBeGreaterThan(0.6)
    expect(QR_SIZE / (53 + 2)).toBeGreaterThanOrEqual(0.5)
  })

  it('describes that same grid to the print stylesheet', () => {
    const css = qrSheetCss()
    const print = css.slice(css.indexOf('@media print'))
    expect(print).toContain('margin: 0')
    expect(print).toContain(`repeat(${COLS}, 62mm)`)
    expect(print).toContain(`repeat(${ROWS}, 52.2mm)`)
    expect(print).toContain(`${QR_SIZE}mm`)
    expect(print).toContain(`${GUTTER}mm`)
    expect(print).toContain(`${INNER_W}mm`)
    expect(print).toContain(`${INNER_H}mm`)
    expect(INNER_W).toBeCloseTo(CARD_W * COLS + GUTTER * (COLS - 1), 5)
    expect(INNER_H).toBeCloseTo(CARD_H * ROWS + GUTTER * (ROWS - 1), 5)
  })
})

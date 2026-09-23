import { describe, it, expect } from 'vitest'
import { renderTextPdf } from './pdfDoc.js'

describe('renderTextPdf', () => {
  it('writes a PDF whose text is readable and whose parentheses cannot close the string', () => {
    const buf = renderTextPdf([
      { kind: 'title', text: 'Hello (world)' },
      { kind: 'body', text: 'Line one' },
    ])
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
    const raw = buf.toString('latin1')
    expect(raw).toContain('Hello \\(world\\)')
    expect(raw).toContain('Line one')
    const start = Number(raw.match(/startxref\n(\d+)/)[1])
    expect(raw.slice(start, start + 4)).toBe('xref')
    expect(raw.trimEnd().endsWith('%%EOF')).toBe(true)
  })

  it('continues onto a second page instead of drawing off the bottom', () => {
    const blocks = Array.from({ length: 80 }, (_, i) => ({
      kind: 'body',
      text: `Row ${i} of the report`,
    }))
    const raw = renderTextPdf(blocks).toString('latin1')
    expect(raw.match(/\/Type \/Page /g).length).toBeGreaterThan(1)
    expect(raw).toContain('Row 0 of the report')
    expect(raw).toContain('Row 79 of the report')
  })
})

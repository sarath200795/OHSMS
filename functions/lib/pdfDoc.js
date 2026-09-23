// A text PDF, with the standard Helvetica faces and no embedded font.
//
// The reports this mail attaches are HTML the browser prints (react-to-print,
// window.print). Nothing in the app writes that print to Storage, and a
// function has no document to print. This is the page those same sections are
// written onto. Streams are left uncompressed on purpose: a sealed envelope
// that slipped into a line is visible in the bytes, and the tests read them.

const PAGE_W = 595
const PAGE_H = 842
const MARGIN = 48

// WinAnsi is not Latin-1 in the 0x80–0x9F band. The characters the reports
// actually use are mapped onto the bytes Helvetica already has, so an em dash
// does not become a missing-glyph box and does not pull in a font file.
const WINANSI = new Map([
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2026, 0x85],
])

const STYLES = {
  kicker: { font: 'F1', size: 9, gap: 2 },
  title: { font: 'F2', size: 16, gap: 8 },
  section: { font: 'F2', size: 12, gap: 4 },
  body: { font: 'F1', size: 10, gap: 1 },
}

function encodeByte(code) {
  if (WINANSI.has(code)) return WINANSI.get(code)
  if (code >= 32 && code <= 255) return code
  return 0x3f
}

function pdfLiteral(text) {
  let out = '('
  for (const ch of String(text ?? '')) {
    const code = ch.codePointAt(0)
    if (code === 10 || code === 13) continue
    const byte = encodeByte(code)
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += `\\${String.fromCharCode(byte)}`
    else if (byte < 32 || byte > 126) out += `\\${byte.toString(8).padStart(3, '0')}`
    else out += String.fromCharCode(byte)
  }
  return `${out})`
}

function wrapLine(text, width) {
  const words = String(text).split(/\s+/).filter(Boolean)
  if (!words.length) return ['']
  const lines = []
  let cur = ''
  const pushPiece = (piece) => {
    const next = cur ? `${cur} ${piece}` : piece
    if (cur && next.length > width) {
      lines.push(cur)
      cur = piece
    } else {
      cur = next
    }
  }
  for (const word of words) {
    if (word.length <= width) {
      pushPiece(word)
      continue
    }
    for (let i = 0; i < word.length; i += width) pushPiece(word.slice(i, i + width))
  }
  if (cur) lines.push(cur)
  return lines
}

function layout(blocks) {
  const pages = []
  let commands = []
  let y = PAGE_H - MARGIN
  let used = false

  const start = () => {
    commands = []
    y = PAGE_H - MARGIN
    used = false
  }
  const finish = () => {
    if (!used) return
    pages.push(`BT\n${commands.join('\n')}\nET`)
  }
  start()

  const draw = (text, font, size, gapAfter) => {
    const width = Math.max(20, Math.floor((PAGE_W - 2 * MARGIN) / (size * 0.5)))
    const lines = String(text)
      .split('\n')
      .flatMap((line) => wrapLine(line, width))
    for (const line of lines.length ? lines : ['']) {
      if (y - (size + 3) < MARGIN) {
        finish()
        start()
      }
      const baseline = y - size
      commands.push(`/${font} ${size} Tf`)
      commands.push(`1 0 0 1 ${MARGIN} ${baseline.toFixed(2)} Tm`)
      commands.push(`${pdfLiteral(line)} Tj`)
      y = baseline - 3
      used = true
    }
    y -= gapAfter
  }

  for (const block of blocks) {
    if (!block) continue
    if (block.kind === 'gap') {
      y -= 8
      continue
    }
    const spec = STYLES[block.kind] || STYLES.body
    draw(block.text || '', spec.font, spec.size, spec.gap)
  }
  finish()
  if (!pages.length) pages.push('BT\n/F1 10 Tf\n1 0 0 1 48 780 Tm\n( ) Tj\nET')
  return pages
}

function serialize(objects) {
  let out = '%PDF-1.4\n'
  const offsets = []
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(out))
    out += `${i + 1} 0 obj\n${obj}\nendobj\n`
  })
  const startxref = Buffer.byteLength(out)
  let xref = `xref\n0 ${objects.length + 1}\n`
  xref += '0000000000 65535 f \n'
  for (const offset of offsets) xref += `${String(offset).padStart(10, '0')} 00000 n \n`
  out += xref
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

/**
 * @param blocks [{ kind: 'kicker'|'title'|'section'|'body'|'gap', text? }]
 * @returns Buffer beginning with %PDF
 */
export function renderTextPdf(blocks) {
  const pageStreams = layout(Array.isArray(blocks) ? blocks : [])
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ]
  const pageIds = []
  for (const stream of pageStreams) {
    const length = Buffer.byteLength(stream)
    const contentId = objects.length + 1
    objects.push(`<< /Length ${length} >>\nstream\n${stream}\nendstream`)
    const pageId = objects.length + 1
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
        `/Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`
    )
    pageIds.push(pageId)
  }
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`
  return serialize(objects)
}

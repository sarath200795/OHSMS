// QR label sheet (PDF) for Fire Alarm panels and AEDs.
//
// Extinguishers print their labels through the Print QR page (three cards per
// A4 row, framed QR, ID / detail / site underneath). FAS panels and AEDs get the
// same card as a downloadable PDF, so a register can hand a whole site's labels
// to a printer without a browser print dialog.
//
// Every code encodes publicQrUrl(token) — the same /qr/:token landing route the
// per-row QR dialog and the extinguisher labels use — so a label printed here
// scans exactly like one printed anywhere else.
import QRCode from 'qrcode'
import { publicQrUrl } from './qr'
import { QR_FRAME_RGB, QR_STROKE_MM } from '../../../shared/print/qrFrame'

/** Per-kind copy: card header, and how an asset is named on its label. */
const KINDS = {
  fas: {
    header: 'FIRE ALARM',
    noun: 'fire alarm panel',
    id: (a) => a.deviceId || a.deviceType || 'FAS',
    detail: (a) => [a.deviceType, a.zone].filter(Boolean).join(' · '),
    file: 'fire-marshal-fas-qr-labels',
  },
  aed: {
    header: 'AED',
    noun: 'AED',
    id: (a) => a.assetId || 'AED',
    detail: (a) => [a.brand, a.model].filter(Boolean).join(' '),
    file: 'fire-marshal-aed-qr-labels',
  },
}

export const QR_LABEL_KINDS = Object.keys(KINDS)

/**
 * Turn register rows into label descriptions.
 *
 * Rows without a qrToken are returned in `skipped` rather than given a made-up
 * code: a label that encodes nothing scannable is worse than no label. (FAS
 * only mints tokens for Control Panels, so detectors and hooters land here.)
 */
export function buildQrLabels(kind, rows) {
  const cfg = KINDS[kind]
  if (!cfg) throw new Error(`Unknown QR label kind: ${kind}`)
  const labels = []
  const skipped = []
  for (const a of rows || []) {
    if (!a || !a.qrToken) {
      if (a) skipped.push(a)
      continue
    }
    labels.push({
      id: a.id,
      url: publicQrUrl(a.qrToken),
      header: cfg.header,
      title: String(cfg.id(a)),
      detail: cfg.detail(a),
      site: a.centerName || '',
      location: a.location || '',
    })
  }
  return { labels, skipped }
}

/** File name for a kind on a given day (YYYY-MM-DD). */
export function qrLabelFilename(kind, date = new Date()) {
  const cfg = KINDS[kind]
  return `${cfg.file}-${date.toISOString().slice(0, 10)}.pdf`
}

// ── Layout (A4 portrait, millimetres) — same 3-across grid as the print page ──
const PAGE_W = 210
const PAGE_H = 297
const MARGIN = 12
const COLS = 3
const GAP_X = 8
const GAP_Y = 6
const CARD_W = (PAGE_W - MARGIN * 2 - GAP_X * (COLS - 1)) / COLS
const CARD_H = 62
const ROWS = Math.floor((PAGE_H - MARGIN * 2 + GAP_Y) / (CARD_H + GAP_Y))
export const LABELS_PER_PAGE = COLS * ROWS
const QR_SIZE = 34
// Labels are rendered in slices, yielding to the event loop between slices, so
// a few hundred codes do not freeze the tab and the progress count can repaint.
export const CHUNK_SIZE = 24

const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0))

async function qrPng(url) {
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: 'H',
    margin: 1,
    scale: 6,
    color: { dark: '#000000', light: '#ffffff' },
  })
}

/** At most `max` wrapped lines of `text`, ellipsised if it had to be cut. */
function clampLines(doc, text, width, max) {
  if (!text) return []
  const lines = doc.splitTextToSize(String(text), width)
  if (lines.length <= max) return lines
  const kept = lines.slice(0, max)
  kept[max - 1] = `${kept[max - 1].replace(/\s+\S*$/, '').slice(0, 40)}…`
  return kept
}

function drawLabel(doc, label, png, x, y) {
  const cx = x + CARD_W / 2
  doc.setDrawColor(...QR_FRAME_RGB)
  doc.setLineWidth(QR_STROKE_MM * 0.75)
  doc.roundedRect(x, y, CARD_W, CARD_H, 2, 2, 'S')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(180, 90, 20)
  doc.text(label.header, cx, y + 5.5, { align: 'center' })

  // Frame is shifted out by half its stroke so the ink sits outside the quiet
  // zone the PNG already carries — a rule on the modules stops the code scanning.
  const qx = cx - QR_SIZE / 2
  const qy = y + 8
  doc.addImage(png, 'PNG', qx, qy, QR_SIZE, QR_SIZE)
  doc.setLineWidth(QR_STROKE_MM)
  const half = QR_STROKE_MM / 2
  doc.rect(qx - half, qy - half, QR_SIZE + QR_STROKE_MM, QR_SIZE + QR_STROKE_MM, 'S')

  const textW = CARD_W - 6
  let ty = qy + QR_SIZE + 6
  doc.setTextColor(38, 33, 26)
  doc.setFontSize(10)
  for (const line of clampLines(doc, label.title, textW, 2)) {
    doc.text(line, cx, ty, { align: 'center' })
    ty += 4.2
  }
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(90, 85, 78)
  const rest = [label.detail, label.site, label.location].filter(Boolean)
  for (const text of rest) {
    for (const line of clampLines(doc, text, textW, 1)) {
      if (ty > y + CARD_H - 1.5) return
      doc.text(line, cx, ty, { align: 'center' })
      ty += 3.4
    }
  }
}

/**
 * Build the PDF for `labels` (see buildQrLabels). Resolves to the jsPDF document.
 * `onProgress(done, total)` is called after every slice.
 */
export async function buildQrLabelPdf(labels, { onProgress, chunkSize = CHUNK_SIZE } = {}) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  const total = labels.length
  let done = 0
  for (let start = 0; start < total; start += chunkSize) {
    const slice = labels.slice(start, start + chunkSize)
    const pngs = await Promise.all(slice.map((l) => qrPng(l.url)))
    slice.forEach((label, i) => {
      const n = start + i
      const slot = n % LABELS_PER_PAGE
      if (n > 0 && slot === 0) doc.addPage()
      const col = slot % COLS
      const row = Math.floor(slot / COLS)
      drawLabel(doc, label, pngs[i], MARGIN + col * (CARD_W + GAP_X), MARGIN + row * (CARD_H + GAP_Y))
    })
    done += slice.length
    if (onProgress) onProgress(done, total)
    if (done < total) await yieldToBrowser()
  }
  return doc
}

/** Build and download the label sheet. Returns { exported, skipped }. */
export async function exportQrLabelPdf(kind, rows, opts = {}) {
  const { labels, skipped } = buildQrLabels(kind, rows)
  if (!labels.length) return { exported: 0, skipped: skipped.length }
  const doc = await buildQrLabelPdf(labels, opts)
  doc.save(opts.filename || qrLabelFilename(kind))
  return { exported: labels.length, skipped: skipped.length }
}

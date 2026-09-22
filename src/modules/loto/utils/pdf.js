import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import { qrDataUrl } from './qr'
import { numberIsolationPoints, procedureScanUrl, tagScanUrl } from './codes'
import { pointDevicesLabel } from '../constants/energySources'
import { QR_FRAME_RGB, QR_STROKE_MM, QR_STROKE_PT } from '../../../shared/print/qrFrame'

function imageFormat(dataUrl) {
  const m = /^data:image\/(\w+)/.exec(dataUrl || '')
  const f = (m?.[1] || 'png').toUpperCase()
  return f === 'JPG' ? 'JPEG' : f
}

function hexToRgb(hex) {
  const h = (hex || '#000000').replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function fmtDate(ts) {
  if (!ts) return '—'
  let d
  if (typeof ts.toDate === 'function') d = ts.toDate()
  else if (ts.seconds) d = new Date(ts.seconds * 1000)
  else d = new Date(ts)
  if (Number.isNaN(d?.getTime?.())) return '—'
  return d.toLocaleDateString()
}

const STEEL = [38, 33, 26] // #26211a logo ink
const HAZARD = [199, 127, 24] // #c77f18 logo amber
const LIGHT = [250, 243, 234] // #faf3ea cream paper
const BORDER = [232, 220, 200] // #e8dcc8 kraft rule

/**
 * Frame a QR image.
 *
 * The PNG from qrDataUrl already includes its quiet zone (one module of
 * margin). jsPDF centres a stroke on the path, so a rect on the image edge
 * covers the outer half of that zone and the code stops scanning. The path
 * is shifted out by half the stroke width: the ink sits fully outside the
 * zone. Weight comes from qrFrame — the kraft table rule is a hairline and
 * printed as no border.
 */
function drawFramedQr(doc, qr, x, y, size, stroke) {
  if (!qr) return
  const prevWidth = doc.getLineWidth()
  doc.addImage(qr, 'PNG', x, y, size, size)
  doc.setDrawColor(...QR_FRAME_RGB)
  doc.setLineWidth(stroke)
  const half = stroke / 2
  doc.rect(x - half, y - half, size + stroke, size + stroke, 'S')
  doc.setLineWidth(prevWidth)
}

// splitTextToSize breaks on spaces and, for a token longer than the line
// (a procedure code is one word), on characters. maxWidth on doc.text does
// the same, but only if the width actually stops before the QR — 180pt from
// the value column ran through the frame.
function wrapToWidth(doc, text, maxWidth) {
  const width = Math.max(12, maxWidth)
  const lines = doc.splitTextToSize(String(text ?? '—'), width)
  return lines.length ? lines : ['—']
}

// US-Letter in points.
const PAGE_W = 612
const PAGE_H = 792
const M = 36

/**
 * Generate the "Lockout/Tagout Posted Procedure" PDF, matching the reference
 * template: header info block, application-process strip, a lockout-steps
 * table (colored energy cells + isolation photos), and an OSHA procedure page.
 */
async function resolveImageSrc(src) {
  if (!src || String(src).startsWith('data:')) return src || null
  try {
    const blob = await (await fetch(src)).blob()
    return await new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(r.result)
      r.onerror = reject
      r.readAsDataURL(blob)
    })
  } catch {
    return null // a missing photo degrades to the '—' cell, not a broken PDF
  }
}

export async function generateProcedurePdf(procedure, photos = {}) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const points = numberIsolationPoints(procedure.isolationPoints || [])
  const qr = await qrDataUrl(procedureScanUrl(procedure.id), { scale: 8 })
  // Photos may be inline data: URLs (legacy) or cloud https URLs. jsPDF's
  // addImage only takes image data, so remote ones are fetched down first —
  // Firebase download URLs answer simple GETs with open CORS.
  const photoData = await Promise.all(
    points.map((p) => resolveImageSrc(photos[p.key] || p.photo || null))
  )

  // Energy tally e.g. "Electrical-02, Mechanical-01"
  const tally = {}
  points.forEach((p) => {
    const k = p.energyLabel.replace(' Energy', '')
    tally[k] = (tally[k] || 0) + 1
  })
  const energySummary =
    Object.entries(tally)
      .map(([k, n]) => `${k}-${String(n).padStart(2, '0')}`)
      .join(', ') || '—'

  // The header grows when a long procedure code wraps beside the QR.
  // A fixed start buried that second line under the process strip.
  let y = drawPostedHeader(doc, procedure, points, energySummary, qr)

  // ---- Lockout Application Process strip ----
  doc.setFillColor(...STEEL)
  doc.rect(M, y, PAGE_W - M * 2, 16, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('LOCKOUT APPLICATION PROCESS', M + 6, y + 11)
  y += 16
  doc.setFillColor(...LIGHT)
  doc.setDrawColor(...BORDER)
  doc.rect(M, y, PAGE_W - M * 2, 26, 'FD')
  doc.setTextColor(40, 40, 40)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(
    '1. Notify affected associates.   2. Identify hazardous energy source.   3. Isolate equipment.   4. Shut down machinery.   5. Apply lockout devices/locks & tags.   6. Control or release stored energy.   7. Verify isolation.',
    M + 6,
    y + 11,
    { maxWidth: PAGE_W - M * 2 - 12 }
  )
  y += 34

  // ---- Lockout Steps table ----
  const body = points.map((p, i) => ({
    step: String(i + 1),
    energy: `${p.pointId}\n${p.energyLabel.replace(' Energy', '')}${
      p.rating ? `\n${p.rating}` : ''
    }\n${pointDevicesLabel(p)}`,
    action: `${p.isolationDetails || '—'}${p.hazard ? `\n\nHazard: ${p.hazard}` : ''}`,
    info: photoData[i] ? '' : '—',
    verification: p.verification || '—',
  }))

  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [
      {
        step: 'Step #',
        energy: 'Energy Source',
        action: 'Action',
        info: 'Info',
        verification: 'Verification',
      },
    ],
    body,
    columns: [
      { header: 'Step #', dataKey: 'step' },
      { header: 'Energy Source', dataKey: 'energy' },
      { header: 'Action', dataKey: 'action' },
      { header: 'Info', dataKey: 'info' },
      { header: 'Verification', dataKey: 'verification' },
    ],
    styles: { fontSize: 8, cellPadding: 4, valign: 'top', lineColor: BORDER, lineWidth: 0.5 },
    headStyles: {
      fillColor: STEEL,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'center',
    },
    columnStyles: {
      step: { cellWidth: 34, halign: 'center', valign: 'middle' },
      energy: { cellWidth: 92, halign: 'center', fontStyle: 'bold' },
      info: { cellWidth: 104, halign: 'center' },
    },
    didParseCell: (data) => {
      if (data.section !== 'body') return
      const p = points[data.row.index]
      if (!p) return
      if (data.column.dataKey === 'energy') {
        data.cell.styles.fillColor = hexToRgb(p.color)
        data.cell.styles.textColor = hexToRgb(p.textColor)
      }
      if (data.column.dataKey === 'info' && photoData[data.row.index]) {
        data.cell.styles.minCellHeight = 86
      }
    },
    didDrawCell: (data) => {
      if (data.section !== 'body' || data.column.dataKey !== 'info') return
      const img = photoData[data.row.index]
      if (!img) return
      const pad = 4
      const x = data.cell.x + pad
      const yy = data.cell.y + pad
      const w = data.cell.width - pad * 2
      const h = data.cell.height - pad * 2
      try {
        doc.addImage(img, imageFormat(img), x, yy, w, h)
      } catch {
        /* ignore unsupported image */
      }
    },
  })

  // ---- OSHA boilerplate page ----
  addOshaPage(doc)

  // ---- Footers ----
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFontSize(7)
    doc.setTextColor(150, 150, 150)
    doc.text(
      `${procedure.procedureCode || ''}  ·  Generated ${new Date().toLocaleDateString()}`,
      M,
      PAGE_H - 18
    )
    doc.text(`Page ${i} of ${pages}`, PAGE_W - M, PAGE_H - 18, { align: 'right' })
  }

  doc.save(`LOTO_${procedure.procedureCode || procedure.id}_R${procedure.revision ?? 0}.pdf`)
}

function drawPostedHeader(doc, procedure, points, energySummary, qr) {
  // Title bar
  doc.setFillColor(...STEEL)
  doc.rect(0, 0, PAGE_W, 32, 'F')
  doc.setFillColor(...HAZARD)
  doc.rect(0, 32, PAGE_W, 2, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.text('Lockout / Tagout Posted Procedure', M, 21)

  // QR top-right. The value column stops a gutter short of this frame:
  // the procedure code has no spaces, so a width that reaches the frame
  // draws the tail through the modules.
  const qrSize = 54
  const qrX = PAGE_W - M - qrSize
  const qrY = 40
  drawFramedQr(doc, qr, qrX, qrY, qrSize, QR_STROKE_PT)
  const frameLeft = qrX - QR_STROKE_PT / 2
  const frameBottom = qrY + qrSize + QR_STROKE_PT / 2
  const gutter = 8
  const labelW = 92
  const rightX = 300

  // Left info block
  const left = [
    ['Facility', procedure.orgName || '—'],
    ['Description', procedure.equipment || '—'],
    ['Location', procedure.site || '—'],
    ['Types of Energies', energySummary],
  ]
  // Right info block
  const right = [
    ['ID #', procedure.procedureCode || '—'],
    ['Revision', `R${procedure.revision ?? 0}`],
    ['Created', fmtDate(procedure.createdAt)],
    ['Revised', fmtDate(procedure.updatedAt)],
    ['Lockout Points', String(points.length)],
  ]
  const drawPairs = (rows, x, startY, valueWidth) => {
    const lineH = 11
    let y = startY
    doc.setFontSize(9)
    rows.forEach((r) => {
      doc.setFont('helvetica', 'normal')
      const lines = wrapToWidth(doc, r[1], valueWidth)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...STEEL)
      doc.text(`${r[0]}:`, x, y)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(60, 60, 60)
      lines.forEach((line, i) => {
        doc.text(line, x + labelW, y + i * lineH)
      })
      y += Math.max(13, lines.length * lineH + 2)
    })
    return y
  }
  const leftBottom = drawPairs(left, M, 50, rightX - gutter - (M + labelW))
  const rightBottom = drawPairs(right, rightX, 50, frameLeft - gutter - (rightX + labelW))

  // Modification note sits under the columns and under the QR, so a wrapped
  // code does not land on this line and this line does not land on the code.
  let y = Math.max(leftBottom, rightBottom, frameBottom) + 12
  doc.setFontSize(7)
  doc.setTextColor(120, 120, 120)
  const note =
    'Any machine modification must be reflected in this procedure. Contact Maintenance to update.'
  const noteLines = wrapToWidth(doc, note, PAGE_W - M * 2)
  noteLines.forEach((line, i) => doc.text(line, M, y + i * 9))
  y += noteLines.length * 9 + 2
  doc.setDrawColor(...BORDER)
  doc.line(M, y, PAGE_W - M, y)
  return y + 8
}

function addOshaPage(doc) {
  doc.addPage()
  doc.setFillColor(...STEEL)
  doc.rect(0, 0, PAGE_W, 30, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text('Lockout / Tagout Procedure', M, 20)

  let y = 46
  const para = (title, text) => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...STEEL)
    doc.text(title, M, y)
    y += 12
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(60, 60, 60)
    const lines = doc.splitTextToSize(text, PAGE_W - M * 2)
    doc.text(lines, M, y)
    y += lines.length * 11 + 8
  }
  para(
    'Purpose:',
    'To protect authorized employees against unexpected or unplanned activation of equipment or energy while servicing equipment.'
  )
  para(
    'Scope:',
    'Utilize this procedure for all scheduled PM shutdowns, any maintenance task that requires you to place your body in harm’s way of the equipment, or if you have to leave the area while the equipment is in service.'
  )
  para(
    'Enforcement:',
    'Failure to properly follow the lockout-tagout procedure may result in corrective action.'
  )

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...STEEL)
  doc.text('Shutdown, Lock, Tag & Test Sequence', M, y)
  autoTable(doc, {
    startY: y + 4,
    margin: { left: M, right: M },
    head: [['#', 'Step', 'Description']],
    body: [
      [
        '1',
        'Notify Employees',
        'Notify all affected employees that servicing or maintenance is required and that the machine must be shut down and locked out.',
      ],
      [
        '2',
        'Review Lockout Procedure',
        'Refer to the procedure to identify the type and magnitude of energy, understand the hazards, and know the control methods.',
      ],
      [
        '3',
        'Perform Machine Stop',
        'If operating, shut down by the normal stopping procedure (stop button, open switch, close valve, etc.).',
      ],
      [
        '4',
        'Isolate Energy',
        'Operate the energy-isolating device(s) so the equipment is isolated from the energy source(s).',
      ],
      [
        '5',
        'Lockout Energy',
        'Lock out and tag out the energy-isolating device(s) with assigned individual lock(s) and tag(s).',
      ],
      [
        '6',
        'Dissipate Energy',
        'Stored or residual energy (capacitors, springs, elevated members, hydraulic/pneumatic pressure, etc.) must be dissipated or restrained.',
      ],
      [
        '7',
        'Attempt Restart',
        'Verify isolation by operating normal controls. Caution: return controls to neutral/off after verifying.',
      ],
    ],
    styles: { fontSize: 8, cellPadding: 4, lineColor: BORDER, lineWidth: 0.5 },
    headStyles: { fillColor: STEEL, textColor: [255, 255, 255] },
    columnStyles: {
      0: { cellWidth: 24, halign: 'center' },
      1: { cellWidth: 120, fontStyle: 'bold' },
    },
  })

  let y2 = doc.lastAutoTable.finalY + 16
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...STEEL)
  doc.text('Restore to Service Sequence', M, y2)
  autoTable(doc, {
    startY: y2 + 4,
    margin: { left: M, right: M },
    head: [['#', 'Step', 'Description']],
    body: [
      [
        '1',
        'Check Machine',
        'Ensure nonessential items are removed and components are operationally intact.',
      ],
      ['2', 'Check Area', 'Ensure all employees are safely positioned or removed from the area.'],
      ['3', 'Verify Machine', 'Verify that the controls are in neutral.'],
      [
        '4',
        'Remove Lockout',
        'Remove locks, tags and lockout devices and re-energize the equipment.',
      ],
      [
        '5',
        'Notify Employees',
        'Notify affected employees that servicing is complete and the equipment is ready for use.',
      ],
    ],
    styles: { fontSize: 8, cellPadding: 4, lineColor: BORDER, lineWidth: 0.5 },
    headStyles: { fillColor: STEEL, textColor: [255, 255, 255] },
    columnStyles: {
      0: { cellWidth: 24, halign: 'center' },
      1: { cellWidth: 120, fontStyle: 'bold' },
    },
  })

  doc.setFontSize(7)
  doc.setTextColor(120, 120, 120)
  doc.text(
    'Reference: OSHA 29 CFR 1910.147, Appendix A — Typical minimal lockout procedures.',
    M,
    doc.lastAutoTable.finalY + 16
  )
}

const lockFmt = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

/**
 * LOTO Register PDF — a snapshot of lock state across equipment, one row per
 * isolation point, with applied/removed timestamps. Grouped per equipment.
 */
export function generateRegisterPdf(procedures = []) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' })
  const W = 792
  doc.setFillColor(...STEEL)
  doc.rect(0, 0, W, 30, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text('LOTO Register', M, 20)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(`Generated ${new Date().toLocaleString()}`, W - M, 20, { align: 'right' })

  const body = []
  procedures.forEach((proc) => {
    const points = numberIsolationPoints(proc.isolationPoints || [])
    const eqStatus =
      proc.lockSummary?.status === 'locked'
        ? 'EQUIPMENT LOCKED'
        : proc.lockSummary?.status === 'partial'
          ? 'PARTIAL'
          : 'UNLOCKED'
    points.forEach((p, i) => {
      const ls = p.lockState || {}
      const lockDesc = ls.locked
        ? [
            ls.lockType ? (ls.lockType === 'department' ? 'Dept' : 'Personal') : '',
            ls.techLockNo ? `#${ls.techLockNo}` : '',
          ]
            .filter(Boolean)
            .join(' ')
        : '—'
      body.push([
        i === 0 ? `${proc.equipment}\n${proc.site || ''}\n[${eqStatus}]` : '',
        p.pointId,
        p.energyLabel.replace(' Energy', ''),
        ls.locked ? 'LOCKED' : 'Unlocked',
        ls.locked ? ls.techName || ls.lockedByName || '—' : '—',
        lockDesc || '—',
        lockFmt(ls.lockedAt),
        lockFmt(ls.unlockedAt),
      ])
    })
  })

  autoTable(doc, {
    startY: 40,
    margin: { left: M, right: M },
    head: [
      [
        'Equipment / Site',
        'Point',
        'Energy',
        'Status',
        'Technician',
        'Lock',
        'Locked At',
        'Unlocked At',
      ],
    ],
    body: body.length ? body : [['No procedures', '', '', '', '', '', '', '']],
    styles: { fontSize: 8, cellPadding: 4, lineColor: BORDER, lineWidth: 0.5, valign: 'top' },
    headStyles: { fillColor: STEEL, textColor: [255, 255, 255] },
    columnStyles: {
      0: { cellWidth: 140, fontStyle: 'bold' },
      1: { cellWidth: 38, halign: 'center' },
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 3) {
        if (data.cell.raw === 'LOCKED') {
          data.cell.styles.textColor = [226, 59, 46]
          data.cell.styles.fontStyle = 'bold'
        }
      }
    },
  })

  doc.save(`LOTO_Register_${new Date().toISOString().slice(0, 10)}.pdf`)
}

const tsFmt = (ts) => {
  if (!ts) return '—'
  const d = ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

/** LOTO Activity Log PDF — every lock/unlock event, newest first. */
export function generateActivityLogPdf(events = []) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' })
  const W = 792
  doc.setFillColor(...STEEL)
  doc.rect(0, 0, W, 30, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text('LOTO Activity Log', M, 20)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(`Generated ${new Date().toLocaleString()}`, W - M, 20, { align: 'right' })

  const body = events.map((e) => [
    tsFmt(e.at),
    e.equipment || '',
    e.site || '',
    e.pointId || '',
    (e.energy || '').replace(' Energy', ''),
    e.action === 'group_join'
      ? 'GROUP LOCK'
      : e.action === 'group_leave'
        ? 'Group removed'
        : e.action === 'lock'
          ? 'LOCKED'
          : 'Unlocked',
    e.byName || '',
  ])

  autoTable(doc, {
    startY: 40,
    margin: { left: M, right: M },
    head: [['Time', 'Equipment', 'Site', 'Point', 'Energy', 'Action', 'By']],
    body: body.length ? body : [['No activity recorded', '', '', '', '', '', '']],
    styles: { fontSize: 8, cellPadding: 4, lineColor: BORDER, lineWidth: 0.5 },
    headStyles: { fillColor: STEEL, textColor: [255, 255, 255] },
    columnStyles: { 0: { cellWidth: 120 }, 3: { cellWidth: 44, halign: 'center' } },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 5 && data.cell.raw === 'LOCKED') {
        data.cell.styles.textColor = [226, 59, 46]
        data.cell.styles.fontStyle = 'bold'
      }
    },
  })

  doc.save(`LOTO_ActivityLog_${new Date().toISOString().slice(0, 10)}.pdf`)
}

/**
 * Energy-tag sheet: one color-coded tag per isolation point with point ID, a QR
 * for that point, LOTO hardware and equipment name.
 */
export async function generateTagsPdf(procedure) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageW = 210
  const pageH = 297
  const margin = 12
  const gap = 8
  const cols = 2
  const tagW = (pageW - margin * 2 - gap) / cols
  const tagH = 56

  const points = numberIsolationPoints(procedure.isolationPoints || [])

  // One QR per tag, resolving to THAT point's live state — not a single
  // procedure QR stamped on every tag, which is what this did and why a scanned
  // tag opened the procedure. A tag hangs on one specific valve or breaker, and
  // the question the person holding it is asking is "is THIS point still
  // isolated" — which only the operation page answers.
  //
  // Points have carried a `key` since they were introduced, and revising a
  // procedure backfills one, but a procedure written before that and never
  // revised has none. Those fall back to the procedure QR: a tag that opens the
  // procedure is the old behaviour and still useful, whereas /t/<id>/undefined
  // would print a code that resolves to nothing.
  const qrs = await Promise.all(
    points.map((p) =>
      qrDataUrl(p.key ? tagScanUrl(procedure.id, p.key) : procedureScanUrl(procedure.id), {
        scale: 8,
      })
    )
  )

  let col = 0
  let y = margin
  points.forEach((p, i) => {
    const x = margin + col * (tagW + gap)
    if (y + tagH > pageH - margin) {
      doc.addPage()
      y = margin
      col = 0
    }
    drawTag(doc, x, y, tagW, tagH, p, procedure, qrs[i])
    col += 1
    if (col >= cols) {
      col = 0
      y += tagH + gap
    }
  })

  doc.save(`LOTO_TAGS_${procedure.procedureCode || procedure.id}.pdf`)
}

function drawTag(doc, x, y, w, h, p, procedure, qr) {
  const [r, g, b] = hexToRgb(p.color)
  const [tr, tg, tb] = hexToRgb(p.textColor)

  doc.setDrawColor(40, 40, 40)
  doc.setLineWidth(0.5)
  doc.roundedRect(x, y, w, h, 2, 2, 'S')

  const bandH = 14
  doc.setFillColor(r, g, b)
  doc.roundedRect(x, y, w, bandH, 2, 2, 'F')
  doc.rect(x, y + bandH - 4, w, 4, 'F')
  doc.setTextColor(tr, tg, tb)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('DANGER · DO NOT OPERATE', x + 4, y + 6)
  doc.setFontSize(7)
  doc.text((p.energyLabel || '').toUpperCase(), x + 4, y + 11)

  const qrSize = 22
  const qrPad = 4
  const qrX = x + w - qrSize - qrPad
  const qrY = y + h - qrSize - qrPad
  // Text lives in the column left of the frame. The procedure code used to
  // start at the QR's left edge and run right, through the modules and off
  // the tag. Hardware used a width that reached the same place.
  const textX = x + 5
  const gutter = 2
  const frameLeft = qrX - QR_STROKE_MM / 2
  const textW = frameLeft - gutter - textX

  doc.setTextColor(20, 20, 20)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(22)
  const idLines = wrapToWidth(doc, p.pointId, textW)
  doc.text(idLines, textX, y + bandH + 12)

  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(40, 40, 40)
  doc.text('Equipment:', textX, y + bandH + 20)
  doc.setFont('helvetica', 'bold')
  const equipLines = wrapToWidth(doc, procedure.equipment || '—', textW)
  doc.text(equipLines, textX, y + bandH + 24)
  doc.setFont('helvetica', 'normal')
  const hardwareY = y + bandH + 24 + equipLines.length * 3.4 + 1.2
  const hwLines = wrapToWidth(doc, `Hardware: ${pointDevicesLabel(p)}`, textW)
  doc.text(hwLines, textX, hardwareY)

  if (procedure.procedureCode) {
    doc.setFontSize(6)
    doc.setTextColor(110, 110, 110)
    const codeLines = wrapToWidth(doc, procedure.procedureCode, textW)
    const lineH = 2.5
    // A single line fits in the gap under the frame. A wrapped code is taller
    // than that gap, so it stays in the left column — still short of the QR —
    // rather than climbing back into the modules.
    const frameBottom = qrY + qrSize + QR_STROKE_MM / 2
    const afterHardware = hardwareY + hwLines.length * 3.2 + 1
    const limit = y + h - 1.2
    let codeY = codeLines.length === 1 ? frameBottom + 2.8 : afterHardware
    if (codeY < afterHardware) codeY = afterHardware
    const last = codeY + (codeLines.length - 1) * lineH
    if (last > limit) codeY -= last - limit
    codeLines.forEach((line, i) => doc.text(line, textX, codeY + i * lineH))
  }

  drawFramedQr(doc, qr, qrX, qrY, qrSize, QR_STROKE_MM)
}

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { qrDataUrl } from './qr'
import { numberIsolationPoints, procedureScanUrl } from './codes'
import { pointDevicesLabel } from '../constants/energySources'

function imageFormat(dataUrl) {
  const m = /^data:image\/(\w+)/.exec(dataUrl || '')
  const f = (m?.[1] || 'png').toUpperCase()
  return f === 'JPG' ? 'JPEG' : f
}

function hexToRgb(hex) {
  const h = (hex || '#000000').replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
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

const STEEL = [27, 36, 53]
const HAZARD = [245, 168, 0]
const LIGHT = [245, 247, 250]
const BORDER = [200, 206, 214]

// US-Letter in points.
const PAGE_W = 612
const PAGE_H = 792
const M = 36

/**
 * Generate the "Lockout/Tagout Posted Procedure" PDF, matching the reference
 * template: header info block, application-process strip, a lockout-steps
 * table (colored energy cells + isolation photos), and an OSHA procedure page.
 */
export async function generateProcedurePdf(procedure, photos = {}) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const points = numberIsolationPoints(procedure.isolationPoints || [])
  const qr = await qrDataUrl(procedureScanUrl(procedure.id), { scale: 8 })
  // Photos are data URLs from Firestore (no Storage). Fall back to legacy photoUrl.
  const photoData = points.map((p) => photos[p.key] || p.photo || null)

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

  drawPostedHeader(doc, procedure, points, energySummary, qr)

  // ---- Lockout Application Process strip ----
  let y = 150
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
    { maxWidth: PAGE_W - M * 2 - 12 },
  )
  y += 34

  // ---- Lockout Steps table ----
  const body = points.map((p, i) => ({
    step: String(i + 1),
    energy: `${p.pointId}\n${p.energyLabel.replace(' Energy', '')}${
      p.rating ? `\n${p.rating}` : ''
    }\n${pointDevicesLabel(p)}`,
    action: `${p.isolationDetails || '—'}${
      p.hazard ? `\n\nHazard: ${p.hazard}` : ''
    }`,
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
    headStyles: { fillColor: STEEL, textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
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
      PAGE_H - 18,
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

  // QR top-right
  const qrSize = 54
  if (qr) doc.addImage(qr, 'PNG', PAGE_W - M - qrSize, 40, qrSize, qrSize)

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
  doc.setFontSize(9)
  const drawPairs = (rows, x, startY) => {
    rows.forEach((r, i) => {
      const ry = startY + i * 13
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...STEEL)
      doc.text(`${r[0]}:`, x, ry)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(60, 60, 60)
      doc.text(String(r[1]), x + 92, ry, { maxWidth: 180 })
    })
  }
  drawPairs(left, M, 50)
  drawPairs(right, 300, 50)

  // Modification note
  doc.setFontSize(7)
  doc.setTextColor(120, 120, 120)
  doc.text(
    'Any machine modification must be reflected in this procedure. Contact Maintenance to update.',
    M,
    140,
  )
  doc.setDrawColor(...BORDER)
  doc.line(M, 144, PAGE_W - M, 144)
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
    'To protect authorized employees against unexpected or unplanned activation of equipment or energy while servicing equipment.',
  )
  para(
    'Scope:',
    'Utilize this procedure for all scheduled PM shutdowns, any maintenance task that requires you to place your body in harm’s way of the equipment, or if you have to leave the area while the equipment is in service.',
  )
  para(
    'Enforcement:',
    'Failure to properly follow the lockout-tagout procedure may result in corrective action.',
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
      ['1', 'Notify Employees', 'Notify all affected employees that servicing or maintenance is required and that the machine must be shut down and locked out.'],
      ['2', 'Review Lockout Procedure', 'Refer to the procedure to identify the type and magnitude of energy, understand the hazards, and know the control methods.'],
      ['3', 'Perform Machine Stop', 'If operating, shut down by the normal stopping procedure (stop button, open switch, close valve, etc.).'],
      ['4', 'Isolate Energy', 'Operate the energy-isolating device(s) so the equipment is isolated from the energy source(s).'],
      ['5', 'Lockout Energy', 'Lock out and tag out the energy-isolating device(s) with assigned individual lock(s) and tag(s).'],
      ['6', 'Dissipate Energy', 'Stored or residual energy (capacitors, springs, elevated members, hydraulic/pneumatic pressure, etc.) must be dissipated or restrained.'],
      ['7', 'Attempt Restart', 'Verify isolation by operating normal controls. Caution: return controls to neutral/off after verifying.'],
    ],
    styles: { fontSize: 8, cellPadding: 4, lineColor: BORDER, lineWidth: 0.5 },
    headStyles: { fillColor: STEEL, textColor: [255, 255, 255] },
    columnStyles: { 0: { cellWidth: 24, halign: 'center' }, 1: { cellWidth: 120, fontStyle: 'bold' } },
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
      ['1', 'Check Machine', 'Ensure nonessential items are removed and components are operationally intact.'],
      ['2', 'Check Area', 'Ensure all employees are safely positioned or removed from the area.'],
      ['3', 'Verify Machine', 'Verify that the controls are in neutral.'],
      ['4', 'Remove Lockout', 'Remove locks, tags and lockout devices and re-energize the equipment.'],
      ['5', 'Notify Employees', 'Notify affected employees that servicing is complete and the equipment is ready for use.'],
    ],
    styles: { fontSize: 8, cellPadding: 4, lineColor: BORDER, lineWidth: 0.5 },
    headStyles: { fillColor: STEEL, textColor: [255, 255, 255] },
    columnStyles: { 0: { cellWidth: 24, halign: 'center' }, 1: { cellWidth: 120, fontStyle: 'bold' } },
  })

  doc.setFontSize(7)
  doc.setTextColor(120, 120, 120)
  doc.text(
    'Reference: OSHA 29 CFR 1910.147, Appendix A — Typical minimal lockout procedures.',
    M,
    doc.lastAutoTable.finalY + 16,
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
    head: [['Equipment / Site', 'Point', 'Energy', 'Status', 'Technician', 'Lock', 'Locked At', 'Unlocked At']],
    body: body.length ? body : [['No procedures', '', '', '', '', '', '', '']],
    styles: { fontSize: 8, cellPadding: 4, lineColor: BORDER, lineWidth: 0.5, valign: 'top' },
    headStyles: { fillColor: STEEL, textColor: [255, 255, 255] },
    columnStyles: { 0: { cellWidth: 140, fontStyle: 'bold' }, 1: { cellWidth: 38, halign: 'center' } },
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
 * Energy-tag sheet: one color-coded tag per isolation point with point ID,
 * procedure QR, LOTO hardware and equipment name.
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
  const qr = await qrDataUrl(procedureScanUrl(procedure.id), { scale: 8 })

  let col = 0
  let y = margin
  points.forEach((p) => {
    const x = margin + col * (tagW + gap)
    if (y + tagH > pageH - margin) {
      doc.addPage()
      y = margin
      col = 0
    }
    drawTag(doc, x, y, tagW, tagH, p, procedure, qr)
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

  doc.setTextColor(20, 20, 20)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(22)
  doc.text(p.pointId, x + 5, y + bandH + 14)

  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(40, 40, 40)
  doc.text('Equipment:', x + 5, y + bandH + 22)
  doc.setFont('helvetica', 'bold')
  doc.text(doc.splitTextToSize(procedure.equipment || '—', w - 38), x + 5, y + bandH + 27)
  doc.setFont('helvetica', 'normal')
  doc.text(
    doc.splitTextToSize(`Hardware: ${pointDevicesLabel(p)}`, w - 10),
    x + 5,
    y + bandH + 36,
  )

  const qrSize = 22
  if (qr) doc.addImage(qr, 'PNG', x + w - qrSize - 4, y + h - qrSize - 4, qrSize, qrSize)
  doc.setFontSize(5.5)
  doc.setTextColor(110, 110, 110)
  doc.text(procedure.procedureCode || '', x + w - qrSize - 4, y + h - 2)
}

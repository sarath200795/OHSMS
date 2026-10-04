// ─────────────────────────────────────────────────────────────────────────────
// The printed LOTO permit.
//
// One page per permit (two when there are many points): the job, the window,
// who agreed, each isolation point with its lock and the time its tag was
// scanned, the extensions, and how the permit ended. The controlling standard
// is cited in the header and the declaration.
//
// Drawn from permitSummary so it says exactly what the screen and the
// spreadsheet say. The QR opens the permit in the app — never a copy of its
// contents — so a printout that outlives a return still shows the live status.
// ─────────────────────────────────────────────────────────────────────────────
import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import { qrDataUrl } from './qr'
import { permitSummary } from './permitExport'
import { LOTO_STANDARD, LOTO_STANDARD_TITLE } from '../constants/permits'
import { QR_FRAME_RGB, QR_STROKE_PT } from '../../../shared/print/qrFrame'

const PAGE_W = 612
const PAGE_H = 792
const M = 36
const STEEL = [38, 33, 26]
const HAZARD = [199, 127, 24]
const LIGHT = [250, 243, 234]
const BORDER = [232, 220, 200]

/** Absolute link encoded in the permit's QR. */
export function permitScanUrl(permitNo) {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/loto/permits/${encodeURIComponent(permitNo)}`
}

export const permitPdfName = (permitNo) => `LOTO_Permit_${permitNo || 'permit'}.pdf`

const DECLARATION =
  `Issued under ${LOTO_STANDARD} — ${LOTO_STANDARD_TITLE}. Energy-isolating devices were locked ` +
  'and tagged by the authorized employees named on this permit, stored energy was released or ' +
  'restrained, and isolation was verified before work began. Each lock is removed only by the ' +
  'employee who applied it; if that employee is unavailable, only an administrator may remove it, ' +
  'after confirming the equipment is clear and the lock owner will be told before they resume work. ' +
  'Equipment is re-energised only after the pre-energise checklist is complete.'

/**
 * Build and download the permit PDF. `events` (optional) names who completed
 * the isolation. `orgName` is printed as the facility.
 */
export async function generatePermitPdf(permit, { events = [], orgName = '' } = {}) {
  const s = permitSummary(permit, events)
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const qr = await qrDataUrl(permitScanUrl(s.permitNo), { scale: 8 })

  doc.setFillColor(...STEEL)
  doc.rect(0, 0, PAGE_W, 34, 'F')
  doc.setFillColor(...HAZARD)
  doc.rect(0, 34, PAGE_W, 2, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.text('Lockout / Tagout Permit', M, 22)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text(`${LOTO_STANDARD}`, PAGE_W - M, 22, { align: 'right' })

  // QR top-right, framed outside its quiet zone (see utils/pdf.js drawFramedQr).
  const qrSize = 58
  const qrX = PAGE_W - M - qrSize
  const qrY = 46
  doc.addImage(qr, 'PNG', qrX, qrY, qrSize, qrSize)
  doc.setDrawColor(...QR_FRAME_RGB)
  doc.setLineWidth(QR_STROKE_PT)
  doc.rect(
    qrX - QR_STROKE_PT / 2,
    qrY - QR_STROKE_PT / 2,
    qrSize + QR_STROKE_PT,
    qrSize + QR_STROKE_PT,
    'S'
  )

  const labelW = 92
  const valueW = qrX - 14 - (M + labelW) - 8
  const line = (y, label, value) => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...STEEL)
    doc.text(label, M, y)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(40, 40, 40)
    const lines = doc.splitTextToSize(String(value || '—'), Math.max(40, valueW))
    doc.text(lines, M + labelW, y)
    return y + Math.max(1, lines.length) * 10.5 + 3
  }
  let y = 54
  y = line(y, 'Permit no.', s.permitNo)
  y = line(y, 'Status', s.statusLabel)
  y = line(y, 'Facility', orgName)
  y = line(y, 'Equipment', s.equipment)
  y = line(y, 'Site', [s.site, s.region, s.entity].filter(Boolean).join(' · '))
  y = Math.max(y, qrY + qrSize + 8)
  y = line(y, 'Work type', s.workType)
  y = line(y, 'Job', s.job)
  if (s.workOrder) y = line(y, 'Work order', s.workOrder)
  y = line(y, 'LOTO procedure', s.procedure)
  y = line(y, 'Devices', s.devices)
  y = line(
    y,
    'Shift window',
    `${s.windowStart} → ${s.windowEnd}${s.shift ? `  (shift ${s.shift})` : ''}`
  )
  y = line(y, 'Requested', `${s.requestedBy || '—'}  ·  ${s.requestedAt || '—'}`)
  y = line(
    y,
    'Approved',
    s.approvedBy
      ? `${s.approvedBy}  ·  ${s.approvedAt}${s.selfApproved ? '  (self-approved: no other administrator)' : ''}`
      : '—'
  )
  if (s.selfApproved && s.selfApprovalReason) y = line(y, 'Self-approval', s.selfApprovalReason)
  if (s.isolatedAt) {
    y = line(
      y,
      'Isolation complete',
      `${s.isolatedAt}${s.isolatedBy ? `  ·  ${s.isolatedBy}` : ''}`
    )
  }

  // ---- People ----
  const people = []
  s.internal.forEach((n) => people.push([n, 'Internal', '']))
  s.vendors.forEach((v) => people.push([v.name, `Contractor — ${v.company}`, v.contact]))
  autoTable(doc, {
    startY: y + 4,
    margin: { left: M, right: M },
    head: [['Personnel on the job', 'Employer', 'Contact']],
    body: people.length ? people : [['—', '', '']],
    styles: { fontSize: 8, cellPadding: 3, lineColor: BORDER, lineWidth: 0.5 },
    headStyles: { fillColor: STEEL, textColor: [255, 255, 255] },
  })

  // ---- Isolation points ----
  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 10,
    margin: { left: M, right: M },
    head: [['Point', 'Energy', 'Lock', 'Owner', 'Tag scanned', 'Lock removed']],
    body: s.points.length
      ? s.points.map((p) => [
          p.pointId,
          p.energy,
          [p.lockNo && `#${p.lockNo}`, p.lockType].filter(Boolean).join(' '),
          p.lockOwner || '—',
          p.scannedAt ? `${p.scannedAt}${p.scanMethod ? ` (${p.scanMethod})` : ''}` : '—',
          p.returnedAt || '—',
        ])
      : [['No isolation points (area / tag-only permit)', '', '', '', '', '']],
    styles: { fontSize: 8, cellPadding: 3, lineColor: BORDER, lineWidth: 0.5 },
    headStyles: { fillColor: STEEL, textColor: [255, 255, 255] },
    columnStyles: { 0: { cellWidth: 44, fontStyle: 'bold' } },
  })

  if (s.extensions.length) {
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 10,
      margin: { left: M, right: M },
      head: [['Extended by', 'At', 'From', 'To', 'Reason']],
      body: s.extensions.map((x) => [x.by, x.at, x.from, x.to, x.reason]),
      styles: { fontSize: 8, cellPadding: 3, lineColor: BORDER, lineWidth: 0.5 },
      headStyles: { fillColor: STEEL, textColor: [255, 255, 255] },
    })
  }

  if (s.checklist) {
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 10,
      margin: { left: M, right: M },
      head: [['Pre-energise checklist', 'Done']],
      body: [
        ...s.checklist.map((c) => [c.label, c.done ? 'Yes' : 'No']),
        ['Returned by', `${s.returnedBy || '—'}  ·  ${s.closedAt || '—'}`],
      ],
      styles: { fontSize: 8, cellPadding: 3, lineColor: BORDER, lineWidth: 0.5 },
      headStyles: { fillColor: STEEL, textColor: [255, 255, 255] },
      columnStyles: { 1: { cellWidth: 150 } },
    })
  }

  if (s.emergency) {
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 10,
      margin: { left: M, right: M },
      head: [['Emergency removal by administrator', '']],
      body: [
        ['Removed by', `${s.emergency.by || '—'}  ·  ${s.emergency.at || '—'}`],
        ['Reason', s.emergency.reason || '—'],
        ...s.emergency.attestations.map((a) => [a.label, a.done ? 'Attested' : 'Not attested']),
      ],
      styles: { fontSize: 8, cellPadding: 3, lineColor: BORDER, lineWidth: 0.5 },
      headStyles: { fillColor: [160, 40, 30], textColor: [255, 255, 255] },
      columnStyles: { 1: { cellWidth: 150 } },
    })
  }

  if (!s.checklist && !s.emergency && s.closedAt) {
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 10,
      margin: { left: M, right: M },
      head: [['Closed', '']],
      body: [[s.statusLabel, `${s.closedAt}${s.closureNote ? `  ·  ${s.closureNote}` : ''}`]],
      styles: { fontSize: 8, cellPadding: 3, lineColor: BORDER, lineWidth: 0.5 },
      headStyles: { fillColor: STEEL, textColor: [255, 255, 255] },
    })
  }

  // ---- Declaration ----
  let dy = doc.lastAutoTable.finalY + 14
  const lines = doc.splitTextToSize(DECLARATION, PAGE_W - M * 2 - 12)
  const boxH = lines.length * 10 + 12
  if (dy + boxH > PAGE_H - 40) {
    doc.addPage()
    dy = M
  }
  doc.setFillColor(...LIGHT)
  doc.setDrawColor(...BORDER)
  doc.rect(M, dy, PAGE_W - M * 2, boxH, 'FD')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(60, 60, 60)
  doc.text(lines, M + 6, dy + 12)

  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFontSize(7)
    doc.setTextColor(150, 150, 150)
    doc.text(`${s.permitNo}  ·  Generated ${new Date().toLocaleString()}`, M, PAGE_H - 18)
    doc.text(`Page ${i} of ${pages}`, PAGE_W - M, PAGE_H - 18, { align: 'right' })
  }

  doc.save(permitPdfName(s.permitNo))
}

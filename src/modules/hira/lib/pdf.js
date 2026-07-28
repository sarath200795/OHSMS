// ─────────────────────────────────────────────────────────────────────────────
// Export a risk assessment to a PDF that mirrors the ISO-45001 HIRA document:
// landscape, a document-control header, an assessment team line, and one table
// per activity with columns Category/Type · Hazard Event · R1 · Current Controls
// · R2 · Additional Actions (CAPA). Text-based (selectable). Reuses app risk logic.
// ─────────────────────────────────────────────────────────────────────────────
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { initialRisk, residualRisk } from './raStats'
import { categoryLabel } from './constants'

const BRAND = [37, 99, 235] // #2563eb
const INK = [28, 34, 48] // #1c2230
const MARGIN = 12

function hexToRgb(hex) {
  const n = (hex || '#64748b').replace('#', '')
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)]
}

const memberName = (members, id) => members?.find((m) => m.id === id)?.name || '—'

function controlsText(controls, members, withOwner = false, withMeta = false) {
  if (!controls?.length) return '—'
  return controls
    .map((c) => {
      let s = `[${c.hierarchy}] ${c.description || ''}`.trim()
      if (withOwner) {
        const owner = memberName(members, c.responsibleMemberId)
        if (owner && owner !== '—') s += ` (Owner: ${owner})`
      }
      if (withMeta) {
        const bits = []
        if (c.status && c.status !== 'Implemented') bits.push(c.status)
        if (c.dueDate) bits.push(`due ${c.dueDate}`)
        if (bits.length) s += ` — ${bits.join(', ')}`
      }
      return s
    })
    .join('\n')
}

function refIdOf(a) {
  if (a.refId) return a.refId
  const slug = (a.siteName || 'SITE').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 6) || 'SITE'
  return `HIRA-${slug}-${(a.id || '').slice(0, 6).toUpperCase()}`
}

export function exportAssessmentPdf(assessment, generatedAt = new Date()) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const members = assessment.members || []
  const refId = refIdOf(assessment)

  // ── Header band ──
  doc.setFillColor(...BRAND)
  doc.rect(0, 0, pageW, 16, 'F')
  doc.setTextColor(255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text('HAZARD IDENTIFICATION & RISK ASSESSMENT', MARGIN, 10)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('HIRA — ISO 45001 OHSMS', pageW - MARGIN, 10, { align: 'right' })

  // ── Document control block ──
  autoTable(doc, {
    startY: 20,
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 1.6 },
    body: [
      ['Ref ID', refId, 'Assessment Name', assessment.name || '—', 'Status', assessment.status || 'ACTIVE'],
      ['Date', assessment.assessmentDate || '—', 'Site / Location', [assessment.siteName, assessment.location].filter(Boolean).join(' / ') || '—', 'Prepared by', assessment.createdByName || '—'],
    ],
    columnStyles: {
      0: { fontStyle: 'bold', fillColor: [243, 244, 246], cellWidth: 24 },
      2: { fontStyle: 'bold', fillColor: [243, 244, 246], cellWidth: 34 },
      4: { fontStyle: 'bold', fillColor: [243, 244, 246], cellWidth: 26 },
    },
    margin: { left: MARGIN, right: MARGIN },
  })
  let y = doc.lastAutoTable.finalY + 4

  // ── Assessment team ──
  if (members.length) {
    const sorted = [...members].sort((a, b) => (a.type === 'internal' ? -1 : 1) - (b.type === 'internal' ? -1 : 1))
    const team = sorted.map((m) => `${m.name}${m.role ? ` (${m.role})` : ''}`).join(' · ')
    doc.setTextColor(...INK)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.text('ASSESSMENT TEAM:', MARGIN, y)
    doc.setFont('helvetica', 'normal')
    const lines = doc.splitTextToSize(team, pageW - MARGIN * 2 - 32)
    doc.text(lines, MARGIN + 32, y)
    y += Math.max(lines.length * 4, 5) + 2
  }

  const COLS = [
    { header: 'Category / Type', width: 40 },
    { header: 'Hazard Event', width: 64 },
    { header: 'R1', width: 12 },
    { header: 'Current Controls', width: 56 },
    { header: 'R2', width: 12 },
    { header: 'Additional Actions (CAPA)', width: 85 },
  ]

  const activities = assessment.activities || []
  if (!activities.length) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(9)
    doc.setTextColor(120)
    doc.text('No activities recorded.', MARGIN, y + 2)
  }

  activities.forEach((act, ai) => {
    // Activity heading (avoid orphan at page bottom).
    if (y + 16 > pageH - 14) { doc.addPage(); y = 20 }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...BRAND)
    const nature = act.nature ? ` [${String(act.nature).toUpperCase()}]` : ''
    doc.text(`ACTIVITY ${ai + 1}: ${(act.title || 'Untitled').toUpperCase()}${nature}`, MARGIN, y + 4)
    y += 6

    const body = []
    const rowMeta = []
    for (const h of act.hazards || []) {
      const init = initialRisk(h)
      const resid = residualRisk(h)
      body.push([
        `${categoryLabel(h.hazardCategory) || '—'}\n${h.hazardType || ''}`.trim(),
        h.description || h.whoMightBeHarmed || h.hazardType || '—',
        init ? String(init.score) : '—',
        controlsText(h.controls, members),
        resid ? String(resid.score) : '—',
        [controlsText(h.additionalControls, members, true, true), h.alarp ? '— Residual accepted (ALARP)' : '']
          .filter((s) => s && s !== '—')
          .join('\n') || (h.alarp ? 'Residual accepted (ALARP)' : '—'),
      ])
      rowMeta.push({ r1: init ? hexToRgb(init.color) : null, r2: resid ? hexToRgb(resid.color) : null })
    }
    if (!body.length) {
      body.push(['—', 'No hazards recorded', '—', '—', '—', '—'])
      rowMeta.push({})
    }

    autoTable(doc, {
      startY: y,
      head: [COLS.map((c) => c.header)],
      body,
      styles: { fontSize: 8, cellPadding: 1.5, valign: 'top', overflow: 'linebreak', lineColor: [220, 220, 220], lineWidth: 0.1 },
      headStyles: { fillColor: INK, textColor: 255, fontSize: 8, halign: 'left' },
      columnStyles: COLS.reduce((acc, c, i) => {
        acc[i] = { cellWidth: c.width }
        if (i === 2 || i === 4) acc[i].halign = 'center'
        return acc
      }, {}),
      margin: { left: MARGIN, right: MARGIN },
      didParseCell: (data) => {
        if (data.section !== 'body') return
        const meta = rowMeta[data.row.index]
        if (!meta) return
        if (data.column.index === 2 && meta.r1) {
          data.cell.styles.fillColor = meta.r1
          data.cell.styles.textColor = [255, 255, 255]
          data.cell.styles.fontStyle = 'bold'
        }
        if (data.column.index === 4 && meta.r2) {
          data.cell.styles.fillColor = meta.r2
          data.cell.styles.textColor = [255, 255, 255]
          data.cell.styles.fontStyle = 'bold'
        }
      },
    })
    y = doc.lastAutoTable.finalY + 5
  })

  // ── Footer on every page ──
  const pages = doc.internal.getNumberOfPages()
  const stamp = `${refId}   ·   Generated ${generatedAt.toISOString().slice(0, 10)}`
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(120)
    doc.text(stamp, MARGIN, pageH - 6)
    doc.text(`Page ${i} of ${pages}`, pageW - MARGIN, pageH - 6, { align: 'right' })
  }

  const safe = (assessment.name || 'risk-assessment').replace(/[^\w-]+/g, '_').slice(0, 60)
  doc.save(`${safe}.pdf`)
}

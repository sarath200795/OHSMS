// ─────────────────────────────────────────────────────────────────────────────
// One flattened view of a permit, for everything that leaves the screen: the
// PDF, the spreadsheet and the dashboard counts.
//
// Kept apart from the drawing code so the three agree by construction — the
// printed permit, the register in Excel and the numbers on the dashboard all
// read the same `permitSummary`, and a test can check what a permit says
// without parsing a PDF.
//
// Pure: no Firestore, no DOM. Sealed fields arrive already opened (the permit
// service decrypts on subscribe), so this never touches key material.
// ─────────────────────────────────────────────────────────────────────────────
import {
  CLOSED_STATUSES,
  EMERGENCY_ATTESTATIONS,
  OPEN_STATUSES,
  PERMIT_STATUS,
  PERMIT_STATUS_META,
  RETURN_CHECKS,
  workTypeLabel,
} from '../constants/permits'
import { deviceLabel, energySourceByKey } from '../constants/energySources'
import { permitClock, toMs } from './permitWindow'

const clean = (v) => (typeof v === 'string' ? v.trim() : '')

/** "04 Oct 2026, 14:05" in the viewer's zone, or '' when there is no instant. */
export function fmtMoment(value) {
  const ms = toMs(value)
  if (!Number.isFinite(ms)) return ''
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export const statusLabel = (status) => PERMIT_STATUS_META[status]?.label || status || ''

const energyName = (p) =>
  energySourceByKey(p.energySource)?.label || p.energyLabel || p.energySource || ''

/**
 * Everything a printed or exported permit shows. `events` (optional) lets the
 * isolation row name who completed the scans — the permit itself stores only a
 * uid there.
 */
export function permitSummary(permit, events = []) {
  const p = permit || {}
  const scans = p.isolation?.scans || {}
  const returns = p.returns || {}
  const locks = new Map((p.locks || []).map((l) => [l.pointKey, l]))
  const started = events.find((e) => e.type === 'started')

  const points = (p.isolationPoints || []).map((pt) => {
    const lock = locks.get(pt.key) || {}
    const scan = scans[pt.key] || null
    const back = returns[pt.key] || null
    return {
      pointId: pt.pointId || pt.key,
      energy: energyName(pt),
      devices: (pt.devices || []).map(deviceLabel).join(', '),
      lockNo: lock.lockNo || '',
      lockType: lock.lockType === 'department' ? 'Department' : lock.lockType ? 'Personal' : '',
      lockOwner: lock.techName || '',
      scannedAt: scan ? fmtMoment(scan.at) : '',
      scanMethod: scan ? (scan.method === 'camera' ? 'Camera' : 'Manual code') : '',
      returnedAt: back ? fmtMoment(back.at) : '',
    }
  })

  const checksDone = p.returnChecks || null
  return {
    permitNo: p.permitNo || p.id || '',
    status: p.status || '',
    statusLabel: statusLabel(p.status),
    workType: workTypeLabel(p.workType),
    job: clean(p.reason),
    workOrder: clean(p.workOrder),
    equipment: clean(p.equipment),
    site: clean(p.site),
    region: clean(p.region),
    entity: clean(p.entity),
    procedure: p.procedureCode ? `${p.procedureCode} · rev ${p.procedureRevision ?? 0}` : '',
    devices: (p.devices || []).map(deviceLabel).join(', '),
    pointCount: Number.isFinite(p.pointCount) ? p.pointCount : points.length,
    shift: p.shift && p.shift !== 'custom' ? p.shift : '',
    windowStart: fmtMoment(p.windowStart),
    windowEnd: fmtMoment(p.windowEnd),
    requestedBy: clean(p.requestedByName),
    requestedAt: fmtMoment(p.requestedAt),
    approvedBy: clean(p.approval?.byName),
    approvedAt: fmtMoment(p.approval?.at),
    approvalNote: clean(p.approval?.note),
    selfApproved: p.approval?.selfApproved === true,
    selfApprovalReason: clean(p.approval?.selfApprovalReason),
    isolatedBy: clean(started?.byName),
    isolatedAt: fmtMoment(p.isolation?.at || p.startedAt),
    internal: (p.internalPersonnel || []).map((x) => clean(x.name)).filter(Boolean),
    vendors: (p.vendorWorkers || []).map((v) => ({
      name: clean(v.name),
      company: clean(v.company),
      contact: clean(v.contact),
    })),
    extensions: (p.extensions || []).map((x) => ({
      at: fmtMoment(x.at),
      by: clean(x.byName),
      from: fmtMoment(x.from),
      to: fmtMoment(x.to),
      reason: clean(x.reason),
    })),
    points,
    // Pre-energise checklist as answered; null until the permit is returned.
    checklist: checksDone
      ? RETURN_CHECKS.map((c) => ({ label: c.label, done: checksDone[c.key] === true }))
      : null,
    returnedBy: p.status === PERMIT_STATUS.RETURNED ? clean(p.closure?.byName) : '',
    closedAt: fmtMoment(p.closedAt),
    closureNote: clean(p.closure?.note),
    emergency: p.emergency
      ? {
          by: clean(p.emergency.byName),
          at: fmtMoment(p.emergency.at),
          reason: clean(p.emergency.reason),
          attestations: EMERGENCY_ATTESTATIONS.map((a) => ({
            label: a.label,
            done: p.emergency.attest?.[a.key] === true,
          })),
        }
      : null,
  }
}

// ── Spreadsheet ──────────────────────────────────────────────────────────────

// A spreadsheet cell that starts with = + - @ is a formula to Excel and Sheets
// when the file is round-tripped through CSV or pasted, and the text here is
// typed by requesters and contractors. A leading tab is the same neutralisation
// shared/lib/csv.js uses; numbers are left alone.
const FORMULA_LEAD = /^[=+\-@\t\r]/
export function safeCell(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number' || typeof value === 'boolean') return value
  const raw = String(value)
  return FORMULA_LEAD.test(raw) ? `\t${raw}` : raw
}

const PERMIT_COLUMNS = [
  ['permitNo', 'Permit'],
  ['statusLabel', 'Status'],
  ['workType', 'Work type'],
  ['equipment', 'Equipment'],
  ['site', 'Site'],
  ['entity', 'Entity'],
  ['procedure', 'LOTO procedure'],
  ['pointCount', 'Isolation points'],
  ['devices', 'Lock-out devices'],
  ['job', 'Job'],
  ['workOrder', 'Work order'],
  ['shift', 'Shift'],
  ['windowStart', 'Window start'],
  ['windowEnd', 'Window end'],
  ['clock', 'Clock'],
  ['requestedBy', 'Requested by'],
  ['requestedAt', 'Requested at'],
  ['approvedBy', 'Approved by'],
  ['approvedAt', 'Approved at'],
  ['selfApproved', 'Self-approved'],
  ['isolatedAt', 'Isolation complete'],
  ['internal', 'Internal personnel'],
  ['vendors', 'Contractors'],
  ['extensionsCount', 'Extensions'],
  ['closedAt', 'Closed at'],
  ['returnedBy', 'Returned by'],
  ['emergencyBy', 'Emergency removal by'],
  ['emergencyReason', 'Emergency reason'],
]

const POINT_COLUMNS = [
  ['permitNo', 'Permit'],
  ['equipment', 'Equipment'],
  ['pointId', 'Point'],
  ['energy', 'Energy'],
  ['devices', 'Devices'],
  ['lockNo', 'Lock no.'],
  ['lockType', 'Lock type'],
  ['lockOwner', 'Lock owner'],
  ['scannedAt', 'Tag scanned'],
  ['scanMethod', 'Scan method'],
  ['returnedAt', 'Lock removed'],
]

const CLOCK_TEXT = { upcoming: 'Not started', running: 'In window', due: 'Due', overdue: 'Overdue' }

/** Rows for the "Permits" sheet: one per permit. */
export function permitSheetRows(permits = [], nowMs = Date.now()) {
  return permits.map((permit) => {
    const s = permitSummary(permit)
    const clock = permitClock(permit, nowMs)
    const row = {
      ...s,
      clock: clock ? CLOCK_TEXT[clock.state] || '' : '',
      selfApproved: s.selfApproved ? 'Yes' : '',
      internal: s.internal.join('; '),
      vendors: s.vendors.map((v) => `${v.name} (${v.company})`).join('; '),
      extensionsCount: s.extensions.length,
      emergencyBy: s.emergency?.by || '',
      emergencyReason: s.emergency?.reason || '',
    }
    return Object.fromEntries(PERMIT_COLUMNS.map(([k, h]) => [h, safeCell(row[k])]))
  })
}

/** Rows for the "Isolation points" sheet: one per point of every permit. */
export function pointSheetRows(permits = []) {
  const rows = []
  for (const permit of permits) {
    const s = permitSummary(permit)
    for (const pt of s.points) {
      const row = { ...pt, permitNo: s.permitNo, equipment: s.equipment }
      rows.push(Object.fromEntries(POINT_COLUMNS.map(([k, h]) => [h, safeCell(row[k])])))
    }
  }
  return rows
}

export const PERMIT_HEADERS = PERMIT_COLUMNS.map((c) => c[1])
export const POINT_HEADERS = POINT_COLUMNS.map((c) => c[1])

// ── Dashboard ────────────────────────────────────────────────────────────────

/**
 * The counts on the dashboard. "Overdue" and "due" use the same clock as the
 * badge on each row (server flags first), so the tile and the list cannot
 * disagree. A closed permit is never overdue.
 */
export function dashboardStats(permits = [], nowMs = Date.now()) {
  const stats = {
    open: 0,
    awaiting: 0,
    active: 0,
    due: 0,
    overdue: 0,
    closed: 0,
    emergency: 0,
    total: permits.length,
  }
  for (const permit of permits) {
    if (OPEN_STATUSES.includes(permit.status)) {
      stats.open += 1
      if (permit.status === PERMIT_STATUS.REQUESTED) stats.awaiting += 1
      if (permit.status === PERMIT_STATUS.ACTIVE) stats.active += 1
      const clock = permitClock(permit, nowMs)
      if (clock?.state === 'overdue') stats.overdue += 1
      else if (clock?.state === 'due') stats.due += 1
    } else if (CLOSED_STATUSES.includes(permit.status)) {
      stats.closed += 1
      if (permit.status === PERMIT_STATUS.EMERGENCY_REMOVED) stats.emergency += 1
    }
  }
  return stats
}

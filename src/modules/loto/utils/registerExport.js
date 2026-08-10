import { numberIsolationPoints } from './codes'

const fmt = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString()
}

/** Flatten procedures into one row per isolation point for the register export. */
export function buildRegisterRows(procedures = []) {
  const rows = []
  procedures.forEach((proc) => {
    const points = numberIsolationPoints(proc.isolationPoints || [])
    const equipmentStatus =
      proc.lockSummary?.status === 'locked'
        ? 'Equipment Locked'
        : proc.lockSummary?.status === 'partial'
        ? 'Partially Locked'
        : 'Unlocked'
    points.forEach((p) => {
      const ls = p.lockState || {}
      rows.push({
        equipment: proc.equipment || '',
        site: proc.site || '',
        code: proc.procedureCode || '',
        equipmentStatus,
        point: p.pointId,
        energy: p.energyLabel,
        rating: p.rating || '',
        pointStatus: ls.locked ? 'Locked' : 'Unlocked',
        technician: ls.techName || '',
        lockType: ls.lockType ? (ls.lockType === 'department' ? 'Department' : 'Personal') : '',
        lockNo: ls.techLockNo || '',
        lockedBy: ls.lockedByName || '',
        lockedAt: fmt(ls.lockedAt),
        unlockedBy: ls.unlockedByName || '',
        unlockedAt: fmt(ls.unlockedAt),
      })
    })
  })
  return rows
}

const COLUMNS = [
  ['equipment', 'Equipment'],
  ['site', 'Site'],
  ['code', 'Procedure Code'],
  ['equipmentStatus', 'Equipment Status'],
  ['point', 'Point'],
  ['energy', 'Energy'],
  ['rating', 'Rating'],
  ['pointStatus', 'Point Status'],
  ['technician', 'Technician'],
  ['lockType', 'Lock Type'],
  ['lockNo', 'Lock No.'],
  ['lockedBy', 'Locked By'],
  ['lockedAt', 'Locked At'],
  ['unlockedBy', 'Unlocked By'],
  ['unlockedAt', 'Unlocked At'],
]

// Shared with every other export so the formula neutralisation is in one place
// — an isolation register carries technician names and free-text notes, both of
// which are typed by the people the register is about.
import { csvCell } from '../../../shared/lib/csv'

const tsFmt = (ts) => {
  if (!ts) return ''
  const d = ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString()
}

const EVENT_COLUMNS = [
  ['at', 'Time'],
  ['equipment', 'Equipment'],
  ['site', 'Site'],
  ['procedureCode', 'Procedure Code'],
  ['pointId', 'Point'],
  ['energy', 'Energy'],
  ['action', 'Action'],
  ['byName', 'By'],
]

/** Build and download the LOTO activity log (every lock/unlock event) as CSV. */
export function downloadEventsCsv(events = []) {
  const header = EVENT_COLUMNS.map((c) => c[1]).join(',')
  const lines = events.map((e) =>
    EVENT_COLUMNS.map((c) => {
      if (c[0] === 'at') return csvCell(tsFmt(e.at))
      if (c[0] === 'action') {
        const label =
          e.action === 'group_join'
            ? 'Group lock'
            : e.action === 'group_leave'
              ? 'Group removed'
              : e.action === 'lock'
                ? 'Locked'
                : 'Unlocked'
        return csvCell(label)
      }
      return csvCell(e[c[0]])
    }).join(','),
  )
  const csv = [header, ...lines].join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `LOTO_ActivityLog_${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** Build and download the LOTO register as a CSV file. */
export function downloadRegisterCsv(procedures) {
  const rows = buildRegisterRows(procedures)
  const header = COLUMNS.map((c) => c[1]).join(',')
  const lines = rows.map((r) => COLUMNS.map((c) => csvCell(r[c[0]])).join(','))
  const csv = [header, ...lines].join('\n')
  // BOM so Excel reads UTF-8 correctly.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `LOTO_Register_${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

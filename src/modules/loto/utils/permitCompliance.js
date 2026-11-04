// Seven-day permit compliance and the filtered records CSV.
//
// Counts only permits still in the list. The one-year purge has already
// deleted anything older, so a percentage cannot resurrect it.
import { safeCell } from './permitExport'
import { toMs } from './permitWindow'

const DAY = 24 * 60 * 60 * 1000
const CLOSED = ['returned', 'rejected', 'withdrawn', 'emergency_removed']

function startOfLocalDay(nowMs) {
  const d = new Date(nowMs)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function pct(part, whole) {
  if (!whole) return 0
  return Math.round((part / whole) * 100)
}

export function complianceStats(permits = [], locks = [], nowMs = Date.now()) {
  const week = nowMs - 7 * DAY
  const closedWeek = permits.filter((p) => CLOSED.includes(p.status) && toMs(p.closedAt) >= week)
  const onTime = closedWeek.filter((p) => p.status === 'returned' && toMs(p.closedAt) <= toMs(p.windowEnd)).length
  const late = closedWeek.filter((p) => p.status === 'returned' && toMs(p.closedAt) > toMs(p.windowEnd)).length
  const emergency = closedWeek.filter((p) => p.status === 'emergency_removed').length
  const denom = onTime + late + emergency
  const issued = locks.filter((l) => l.serviceStatus === 'issued').length
  return {
    onTimePct: pct(onTime, denom),
    latePct: pct(late, denom),
    emergencyPct: pct(emergency, denom),
    closedToday: permits.filter((p) => CLOSED.includes(p.status) && toMs(p.closedAt) >= startOfLocalDay(nowMs)).length,
    issued,
    totalLocks: locks.length,
    waiting: permits.filter((p) => p.status === 'requested').length,
    overdue: permits.filter((p) => p.status === 'active' && toMs(p.windowEnd) < nowMs).length,
  }
}

export function filterActivity(events = [], { q = '', action = '', fromMs = 0 } = {}) {
  const needle = q.trim().toLowerCase()
  return events.filter((e) => {
    const at = toMs(e.at)
    if (fromMs && !(at >= fromMs)) return false
    if (action && e.action !== action && e.type !== action) return false
    if (!needle) return true
    const hay = [e.action, e.type, e.byName, e.note, e.permitNo, e.equipment, e.detail].join(' ').toLowerCase()
    return hay.includes(needle)
  })
}

export function recordsCsv(permits = []) {
  const headers = ['Permit', 'Status', 'Equipment', 'Closed', 'Window end']
  const lines = [headers.join(',')]
  for (const p of permits) {
    lines.push([
      safeCell(p.permitNo || p.id),
      safeCell(p.status),
      safeCell(p.equipment),
      safeCell(p.closedAt ? new Date(toMs(p.closedAt)).toISOString() : ''),
      safeCell(p.windowEnd ? new Date(toMs(p.windowEnd)).toISOString() : ''),
    ].join(','))
  }
  return lines.join('\r\n')
}

export function alertCopy(stats) {
  const parts = []
  if (stats.overdue) parts.push(`${stats.overdue} overdue`)
  if (stats.waiting) parts.push(`${stats.waiting} waiting for approval`)
  return parts.join(', ')
}

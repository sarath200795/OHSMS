// ─────────────────────────────────────────────────────────────────────────────
// Training & Certifications — pure domain helpers (no Firestore).
// A record's expiry = completion date + the course's validity months.
// Status: expired < today ≤ expiring (≤30d) < valid; '' expiry = never expires.
// ─────────────────────────────────────────────────────────────────────────────

export const EXPIRING_WINDOW_DAYS = 30

export function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** completedOn (YYYY-MM-DD) + months → YYYY-MM-DD; '' when no expiry applies. */
export function computeExpiry(completedOn, validityMonths) {
  const months = Number(validityMonths) || 0
  if (!completedOn || months <= 0) return ''
  const [y, m, d] = completedOn.split('-').map(Number)
  if (!y || !m || !d) return ''
  const base = new Date(y, m - 1 + months, d)
  // Clamp month-end overflow (e.g. 31 Jan + 1m → 28 Feb, not 3 Mar).
  if (base.getDate() !== d) base.setDate(0)
  return todayISO(base)
}

/** 'valid' | 'expiring' | 'expired' | 'none' (never expires). */
export function recordStatus(expiresOn, today = todayISO()) {
  if (!expiresOn) return 'none'
  if (expiresOn < today) return 'expired'
  const soon = new Date(today)
  soon.setDate(soon.getDate() + EXPIRING_WINDOW_DAYS)
  return expiresOn <= todayISO(soon) ? 'expiring' : 'valid'
}

export const STATUS_META = {
  valid: { label: 'Valid', tone: 'green', color: '#16a34a' },
  expiring: { label: 'Expiring soon', tone: 'amber', color: '#d97706' },
  expired: { label: 'Expired', tone: 'red', color: '#dc2626' },
  none: { label: 'No expiry', tone: 'gray', color: '#8a7660' },
}

/** Counts for the dashboard tiles. */
export function summarize(records = [], today = todayISO()) {
  const s = { total: records.length, valid: 0, expiring: 0, expired: 0, none: 0 }
  for (const r of records) s[recordStatus(r.expiresOn, today)] += 1
  return s
}

/**
 * Keep only each employee's LATEST record per course (by completedOn) — the one
 * that decides their current certification status. Returns Map "uid:courseId" → record.
 */
export function latestByEmployeeCourse(records = []) {
  const map = new Map()
  for (const r of records) {
    if (!r.employeeUid || !r.courseId) continue
    const key = `${r.employeeUid}:${r.courseId}`
    const prev = map.get(key)
    if (!prev || (r.completedOn || '') > (prev.completedOn || '')) map.set(key, r)
  }
  return map
}

// ── Assignments (LMS) ─────────────────────────────────────────────────────────

export const ASSIGNMENT_DUE_SOON_DAYS = 7

/** 'overdue' | 'due_soon' (≤7d) | 'open' — for an OPEN assignment's due date. */
export function assignmentStatus(dueDate, today = todayISO()) {
  if (!dueDate) return 'open'
  if (dueDate < today) return 'overdue'
  const soon = new Date(today)
  soon.setDate(soon.getDate() + ASSIGNMENT_DUE_SOON_DAYS)
  return dueDate <= todayISO(soon) ? 'due_soon' : 'open'
}

export const ASSIGNMENT_META = {
  open: { label: 'Assigned', tone: 'gray', color: '#8a7660' },
  due_soon: { label: 'Due soon', tone: 'amber', color: '#d97706' },
  overdue: { label: 'Overdue', tone: 'red', color: '#dc2626' },
}

/** Counts over OPEN (status 'assigned') assignments. */
export function summarizeAssignments(assignments = [], today = todayISO()) {
  const open = assignments.filter((a) => a.status === 'assigned')
  const s = { open: open.length, due_soon: 0, overdue: 0 }
  for (const a of open) {
    const st = assignmentStatus(a.dueDate, today)
    if (st !== 'open') s[st] += 1
  }
  return s
}

/**
 * Per-employee course cells: one row per employee, with each course's current
 * status ('missing' when the employee has no record for it).
 */
export function buildMatrix(users = [], courses = [], records = [], today = todayISO()) {
  const latest = latestByEmployeeCourse(records)
  return users.map((u) => ({
    uid: u.uid,
    name: u.name || u.email || 'Unknown',
    cells: courses.map((c) => {
      const rec = latest.get(`${u.uid}:${c.id}`)
      return { courseId: c.id, status: rec ? recordStatus(rec.expiresOn, today) : 'missing', record: rec || null }
    }),
  }))
}

// ── Status report (CSV export) ────────────────────────────────────────────────

export const REPORT_COLUMNS = [
  { key: 'employee', label: 'Employee' },
  { key: 'email', label: 'Email' },
  { key: 'department', label: 'Department' },
  { key: 'course', label: 'Course' },
  { key: 'category', label: 'Category' },
  { key: 'mandatory', label: 'Mandatory' },
  { key: 'status', label: 'Status' },
  { key: 'completedOn', label: 'Completed On' },
  { key: 'expiresOn', label: 'Expires On' },
  { key: 'assignmentDue', label: 'Assignment Due' },
  { key: 'completedInRange', label: 'Completed In Period' },
]

/**
 * Full employee × course training-status report AS OF `to` (records after that
 * date are ignored, expiry judged against it), with a completed-in-[from..to]
 * flag. Every combination is included — completed or not.
 */
export function buildStatusReport(users = [], courses = [], records = [], assignments = [], { from = '', to = todayISO() } = {}) {
  // Latest record per employee+course completed on or before the as-of date.
  const latest = new Map()
  for (const r of records) {
    if (!r.employeeUid || !r.courseId) continue
    if ((r.completedOn || '') > to) continue
    const key = `${r.employeeUid}:${r.courseId}`
    const prev = latest.get(key)
    if (!prev || (r.completedOn || '') > (prev.completedOn || '')) latest.set(key, r)
  }
  // Earliest-due open assignment per employee+course.
  const open = new Map()
  for (const a of assignments) {
    if (a.status !== 'assigned') continue
    const key = `${a.employeeUid}:${a.courseId}`
    const prev = open.get(key)
    if (!prev || (a.dueDate || '9999') < (prev.dueDate || '9999')) open.set(key, a)
  }
  // Single pass for the completed-in-period flag (keeps the report O(n) at
  // thousands of employees instead of re-scanning records per row).
  const inRange = new Set()
  for (const r of records) {
    const d = r.completedOn || ''
    if (d >= (from || '0000-00-00') && d <= to) inRange.add(`${r.employeeUid}:${r.courseId}`)
  }
  const rows = []
  for (const u of users) {
    for (const c of courses) {
      const key = `${u.uid}:${c.id}`
      const rec = latest.get(key)
      const asn = open.get(key)
      let status
      if (rec) {
        const st = recordStatus(rec.expiresOn, to)
        status = st === 'none' ? 'Completed' : st === 'valid' ? 'Valid' : st === 'expiring' ? 'Expiring soon' : 'Expired'
      } else if (asn) {
        status = asn.dueDate && asn.dueDate < to ? 'Assignment overdue' : 'Assigned — not completed'
      } else {
        status = 'Not trained'
      }
      rows.push({
        employee: u.name || u.email || 'Unknown',
        email: u.email || '',
        department: u.department || u.dept || '',
        course: c.name,
        category: c.category || '',
        mandatory: c.mandatory ? 'Yes' : 'No',
        status,
        completedOn: rec?.completedOn || '',
        expiresOn: rec?.expiresOn || '',
        assignmentDue: asn?.dueDate || '',
        completedInRange: inRange.has(key) ? 'Yes' : 'No',
      })
    }
  }
  return rows
}

/** Minimal CSV serializer — quotes fields containing commas, quotes or newlines. */
export function toCsv(rows, columns = REPORT_COLUMNS) {
  const esc = (v) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const head = columns.map((c) => esc(c.label)).join(',')
  const body = rows.map((r) => columns.map((c) => esc(r[c.key])).join(',')).join('\n')
  return `${head}\n${body}\n`
}

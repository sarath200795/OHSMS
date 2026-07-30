// ─────────────────────────────────────────────────────────────────────────────
// "Is this mine?" — the only question the portal asks that the admin modules
// never had to.
//
// Every module was built to show an HSE lead everything in the org, so nothing
// upstream filters to one person. Both helpers here are pure, because the
// matching is the part that can quietly be wrong: an action attributed to the
// wrong person is invisible to whoever should be doing it.
// ─────────────────────────────────────────────────────────────────────────────
import { recordStatus, STATUS_META } from '../../modules/training/lib/status'

const norm = (s) => String(s ?? '').trim().toLowerCase()

/**
 * Does this action belong to `profile`?
 *
 * Owners are free text across the source modules — some records store a uid,
 * most store whatever name was typed into the owner field. Matching on uid
 * alone would return almost nothing, so the name is a legitimate fallback; it
 * is compared whole rather than by substring, because "Ravi" must not claim
 * "Ravi Kumar"'s work and vice versa.
 */
export function isMine(action, profile) {
  if (!action || !profile) return false
  const owner = action.owner
  if (!owner) return false
  if (typeof owner === 'object') {
    if (owner.uid && profile.uid) return owner.uid === profile.uid
    return norm(owner.name) === norm(profile.name)
  }
  const o = norm(owner)
  if (!o) return false
  return (
    (profile.uid && o === norm(profile.uid)) ||
    (profile.name && o === norm(profile.name)) ||
    (profile.email && o === norm(profile.email))
  )
}

/**
 * The signed-in person's actions, overdue first, then by due date.
 *
 * Undated actions sort last rather than first: an action with no date is not
 * more urgent than one due tomorrow, and empty strings would otherwise sort
 * ahead of every real date.
 */
export function myActions(actions = [], profile) {
  return actions
    .filter((a) => isMine(a, profile))
    .sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1
      if (!a.due && !b.due) return 0
      if (!a.due) return 1
      if (!b.due) return -1
      return a.due < b.due ? -1 : 1
    })
}

/**
 * Progress per course for one person, from their assignments and records.
 *
 * An assignment that is still open reads 0%; a completed one reads 100% and
 * then takes its colour from whether the certificate is still in date, because
 * "completed" and "valid" are different things and only the second one means
 * the person may do the work today.
 */
export function courseProgress(assignments = [], courses = [], profile) {
  if (!profile?.uid) return []
  const byId = new Map((courses || []).map((c) => [c.id, c]))

  return (assignments || [])
    .filter((a) => a.employeeUid === profile.uid && a.status !== 'cancelled')
    .map((a) => {
      const course = byId.get(a.courseId)
      const done = a.status === 'completed'
      const expiry = a.expiresOn || ''
      const state = done ? recordStatus(expiry) : 'pending'
      const meta = STATUS_META[state]
      return {
        key: a.id || `${a.courseId}:${a.employeeUid}`,
        courseId: a.courseId,
        name: a.courseName || course?.name || 'Course',
        category: a.category || course?.category || 'Other',
        due: a.dueDate || '',
        pct: done ? 100 : 0,
        done,
        state,
        status: done ? (meta?.label ?? 'Completed') : a.dueDate ? `Due ${a.dueDate}` : 'Not started',
        color: done ? (meta?.color ?? '#16a34a') : '#8a7660',
      }
    })
    // Outstanding work first — the reason someone opens this screen.
    .sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1
      if (!a.due && !b.due) return 0
      if (!a.due) return 1
      if (!b.due) return -1
      return a.due < b.due ? -1 : 1
    })
}

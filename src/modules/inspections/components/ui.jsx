// Inspections module UI surface.
//
// These primitives used to be a near-verbatim copy of the same components in
// four other modules, each drifting on its own. They now come straight from the
// shared kit, so a fix made once — the modal focus trap, say — reaches every
// module instead of one.
//
// The branded full-screen loader that used to live here is gone too:
// ModuleLoading replaced it, and keeping a second one meant two answers to
// 'what does this app look like while it is loading'.
//
// StatusPill stays, because it is the one thing here that is genuinely local:
// it maps THIS module's inspection vocabulary — Pending, Completed, Cancelled,
// PASS, FAIL — to colours, and no other module has those states.

export { Spinner, Badge, EmptyState, Modal, PageHeader } from '../../../shared/ui'

// ── Status pill (inspection statuses) ────────────────────────────────────────
const STATUS_PILL = {
  Pending: 'bg-amber-100 text-amber-700',
  Completed: 'bg-emerald-100 text-emerald-700',
  Cancelled: 'bg-ink-100 text-ink-500',
  Active: 'bg-emerald-100 text-emerald-700',
  Draft: 'bg-ink-100 text-ink-500',
  Inactive: 'bg-ink-100 text-ink-400',
  PASS: 'bg-emerald-100 text-emerald-700',
  FAIL: 'bg-red-100 text-red-700',
}

export function StatusPill({ status }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest ${STATUS_PILL[status] || STATUS_PILL.Draft}`}>
      {status}
    </span>
  )
}

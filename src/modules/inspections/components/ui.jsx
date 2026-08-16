// Inspections module UI surface. Primitives come from the shared kit; the
// full-screen loader and the inspection status pill are local.
import { motion } from 'framer-motion'
import { Spinner } from '../../../shared/ui'

export { Spinner, Badge, EmptyState, Modal, PageHeader } from '../../../shared/ui'

export function FullScreenLoader({ label = 'Loading…' }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-clay-bg text-ink-500">
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-brand-500 text-white shadow-glow">
        <Spinner size={28} className="text-white" />
      </div>
      <motion.p
        className="text-sm font-medium"
        animate={{ opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
      >
        {label}
      </motion.p>
    </div>
  )
}

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

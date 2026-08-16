// Permit-to-work module UI surface. Primitives come from the shared kit; only
// the permit-branded full-screen loader is local.
import { motion } from 'framer-motion'
import { ShieldCheck } from 'lucide-react'

export { Spinner, Badge, EmptyState, Modal, PageHeader, Field } from '../../../shared/ui'

export function FullScreenLoader({ label = 'Loading…' }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-clay-bg text-ink-500">
      <motion.div
        className="grid h-20 w-20 place-items-center rounded-3xl bg-brand-500 text-white shadow-glow animate-pulseRing"
        animate={{ scale: [1, 1.05, 1] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
      >
        <ShieldCheck size={36} />
      </motion.div>
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

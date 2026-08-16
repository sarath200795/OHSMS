// Fire module UI surface.
//
// The primitives below used to be a near-verbatim copy of the same five
// components in four other modules, each drifting on its own. They now come
// straight from the shared kit, so a fix made once — the modal focus trap, say
// — reaches every module instead of one. Only the fire-branded full-screen
// loader is genuinely local, and it stays here.
import { motion } from 'framer-motion'
import ExtinguishAnimation from './ExtinguishAnimation'

export { Spinner, Badge, EmptyState, Modal, PageHeader } from '../../../shared/ui'

export function FullScreenLoader({ label = 'Loading…' }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-clay-bg text-ink-500">
      <ExtinguishAnimation size={170} />
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

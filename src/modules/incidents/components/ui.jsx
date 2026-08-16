// Incidents module UI surface. Primitives come from the shared kit (see the
// note in src/shared/ui/index.jsx); only the incident-branded full-screen
// loader is local to this module.
import { motion } from 'framer-motion'
import IncidentLoader from './IncidentLoader'

export { Spinner, Badge, EmptyState, Modal, PageHeader } from '../../../shared/ui'

export function FullScreenLoader({ label = 'Loading…' }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-clay-bg text-ink-500">
      <IncidentLoader size={170} />
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

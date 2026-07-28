import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { useEffect } from 'react'
import IncidentLoader from './IncidentLoader'

// ── Loading spinner ─────────────────────────────────────────────────────────
export function Spinner({ size = 24, className = '' }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      style={{ width: size, height: size }}
      aria-label="Loading"
    />
  )
}

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

// ── Pill badge with a dot color ───────────────────────────────────────────────
export function Badge({ color = '#64748b', children, soft = true, className = '' }) {
  return (
    <span
      className={`chip ${className}`}
      style={
        soft
          ? { backgroundColor: `${color}1a`, color }
          : { backgroundColor: color, color: '#fff' }
      }
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {children}
    </span>
  )
}

// ── Empty state ────────────────────────────────────────────────────────────────
export function EmptyState({ icon: Icon, title, hint, action }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center gap-3 rounded-3xl bg-clay-surface/60 px-6 py-16 text-center shadow-clay-inset"
    >
      {Icon && (
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-clay-surface text-ink-400 shadow-clay-inset">
          <Icon size={26} />
        </div>
      )}
      <h3 className="text-lg font-bold text-ink-800">{title}</h3>
      {hint && <p className="max-w-sm text-sm text-ink-500">{hint}</p>}
      {action}
    </motion.div>
  )
}

// ── Modal ────────────────────────────────────────────────────────────────────
export function Modal({ open, onClose, title, children, maxWidth = 'max-w-lg' }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose?.()
    }
    if (open) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-ink-950/40 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            className={`card relative z-10 w-full ${maxWidth} overflow-hidden`}
            initial={{ scale: 0.94, opacity: 0, y: 16 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: 8 }}
            transition={{ type: 'spring', stiffness: 300, damping: 26 }}
          >
            <div className="flex items-center justify-between border-b border-clay-200/60 px-5 py-4">
              <h3 className="text-base font-bold text-ink-900">{title}</h3>
              <button onClick={onClose} className="rounded-xl p-1.5 text-ink-400 shadow-clay-sm transition hover:bg-clay-100 active:shadow-clay-pressed hover:text-ink-700">
                <X size={18} />
              </button>
            </div>
            <div className="px-5 py-5">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ── Section header ─────────────────────────────────────────────────────────────
export function PageHeader({ title, subtitle, icon: Icon, children, tourId }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      data-tour={tourId}
      className="mb-6 flex flex-wrap items-center justify-between gap-4"
    >
      <div className="flex items-center gap-3">
        {Icon && (
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand-500 text-white shadow-glow">
            <Icon size={22} />
          </div>
        )}
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink-900">{title}</h1>
          {subtitle && <p className="text-sm text-ink-500">{subtitle}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </motion.div>
  )
}

import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { useEffect } from 'react'

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

// Branded loader: a magnifying glass scanning across the HIRA shield.
// Blue shield on white; the magnifier cycles yellow → green → red → amber.
const MAG_COLORS = ['#eab308', '#16a34a', '#dc2626', '#f59e0b', '#eab308']
const MAG_FILLS = [
  'rgba(234,179,8,0.18)',
  'rgba(22,163,74,0.18)',
  'rgba(220,38,38,0.18)',
  'rgba(245,158,11,0.18)',
  'rgba(234,179,8,0.18)',
]
const SWEEP_TIMES = [0, 0.22, 0.44, 0.66, 0.85, 1]

export function MagnifierLoader({ size = 96 }) {
  const sweep = {
    x: [-4, 4, 4, -4, 0, -4],
    y: [-4, -4, 1, 1, 5, -4],
    rotate: [-12, 8, 8, -12, 2, -12],
  }
  const sweepT = { duration: 3.4, ease: 'easeInOut', repeat: Infinity, times: SWEEP_TIMES }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="Loading">
      {/* blue shield on a white background */}
      <path
        d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
        fill="#ffffff"
        stroke="#2563eb"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M12 5.2v13.2" stroke="#bfdbfe" strokeWidth="0.8" strokeLinecap="round" />
      {/* magnifier scanning across the shield, colour cycling through risk colours */}
      <motion.g
        strokeWidth="1.9"
        strokeLinecap="round"
        initial={{ stroke: MAG_COLORS[0] }}
        animate={{ ...sweep, stroke: MAG_COLORS }}
        transition={{ x: sweepT, y: sweepT, rotate: sweepT, stroke: { duration: 3.2, ease: 'linear', repeat: Infinity } }}
        style={{ transformOrigin: '11px 10px' }}
      >
        {/* lens glint pulses and tints with the cycling colour */}
        <motion.circle
          cx="10.6"
          cy="9.8"
          r="2.8"
          initial={{ fill: MAG_FILLS[0] }}
          animate={{ scale: [1, 1.15, 1], fill: MAG_FILLS }}
          transition={{ scale: { duration: 1.2, ease: 'easeInOut', repeat: Infinity }, fill: { duration: 3.2, ease: 'linear', repeat: Infinity } }}
          style={{ transformOrigin: '10.6px 9.8px' }}
        />
        <path d="m12.8 12 2.7 2.7" />
      </motion.g>
    </svg>
  )
}

export function FullScreenLoader({ label = 'Loading…' }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-clay-bg text-ink-500">
      <MagnifierLoader size={96} />
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

// ── Skeleton placeholder (loading state) ─────────────────────────────────────
export function Skeleton({ className = '' }) {
  return <div className={`animate-pulse rounded-lg bg-clay-200/70 ${className}`} />
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
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: soft ? color : '#fff' }} />
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
          exit={{ opacity: 0, transition: { duration: 0.12, ease: [0.23, 1, 0.32, 1] } }}
        >
          <div className="absolute inset-0 bg-ink-950/40 backdrop-blur-sm" onClick={onClose} />
          {/* Modals stay centered (not origin-aware); enter on a spring, exit
              faster on a tween — slow where the user decides, fast on response. */}
          <motion.div
            className={`card relative z-10 w-full ${maxWidth} overflow-hidden`}
            initial={{ scale: 0.94, opacity: 0, y: 16 }}
            animate={{ scale: 1, opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 26 } }}
            exit={{ scale: 0.96, opacity: 0, y: 8, transition: { duration: 0.14, ease: [0.23, 1, 0.32, 1] } }}
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
export function PageHeader({ title, subtitle, icon: Icon, children, tour }) {
  return (
    <motion.div
      data-tour={tour}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
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

// HIRA module UI surface. Primitives come from the shared kit; the branded
// magnifier loader is local.
import { motion } from 'framer-motion'

export { Spinner, Badge, EmptyState, Modal, PageHeader, Skeleton } from '../../../shared/ui'

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

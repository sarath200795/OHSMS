import { motion } from 'framer-motion'

/**
 * Branded loading animation: the committee mark (people + table) holds steady in
 * brand green while the two discussion-bubble "callouts" pop in one after the
 * other — yellow first, then red — hold, fade, and loop. Used for lazy-route
 * Suspense fallbacks and data-loading states.
 */
const bubbleStyle = { transformBox: 'fill-box', transformOrigin: 'center' }
const DUR = 2.2

export default function LogoLoader({ size = 96, label }) {
  return (
    <div className="flex flex-col items-center gap-4">
      <svg viewBox="0 0 64 64" width={size} height={size} className="text-brand-600" fill="currentColor" aria-hidden="true">
        {/* people + table (static, brand green) */}
        <circle cx="32" cy="33" r="5.2" />
        <circle cx="19" cy="35.5" r="4.4" />
        <circle cx="45" cy="35.5" r="4.4" />
        <circle cx="9.5" cy="39.5" r="3.9" />
        <circle cx="54.5" cy="39.5" r="3.9" />
        <path d="M23.5 45a8.5 8.5 0 0 1 17 0z" />
        <path d="M11.5 47.5a7.4 7.4 0 0 1 14.8 0z" />
        <path d="M37.7 47.5a7.4 7.4 0 0 1 14.8 0z" />
        <path d="M2.6 51a7 7 0 0 1 14 0z" />
        <path d="M47.4 51a7 7 0 0 1 14 0z" />
        <path d="M6 47.5c7.5 6.7 16.4 9.8 26 9.8s18.5-3.1 26-9.8c1.5 2.9 1.5 5.8 0 7.8-7.2 6-16.6 8.9-26 8.9s-18.8-2.9-26-8.9c-1.5-2-1.5-4.9 0-7.8z" />
        <circle cx="32" cy="43.5" r="6.3" />
        <rect x="24.3" y="50.5" width="15.4" height="12.5" rx="3.2" />

        {/* callout bubble 1 — yellow, pops first */}
        <motion.path
          fill="#facc15"
          style={bubbleStyle}
          d="M25 4c-7.2 0-13 4.2-13 9.4 0 3 1.9 5.6 4.9 7.3-.5 1.6-1.5 3-3 4.2 2.7-.2 5-1 6.9-2.3 1.3.3 2.7.5 4.2.5 7.2 0 13-4.2 13-9.7C38 8.2 32.2 4 25 4z"
          initial={{ opacity: 0, scale: 0.4 }}
          animate={{ opacity: [0, 1, 1, 0, 0], scale: [0.4, 1, 1, 0.9, 0.4] }}
          transition={{ duration: DUR, times: [0, 0.12, 0.75, 0.9, 1], repeat: Infinity, ease: 'easeInOut' }}
        />
        {/* callout bubble 2 — red, pops after */}
        <motion.path
          fill="#ef4444"
          style={bubbleStyle}
          d="M46 15.5c-5 0-9 3-9 6.8 0 2 1.1 3.8 3 5-.4 1.2-1.1 2.2-2.1 3 1.9-.1 3.5-.7 4.8-1.7.9.2 1.9.3 3 .3 5 0 9-3 9-6.7s-4-6.7-9-6.7z"
          initial={{ opacity: 0, scale: 0.4 }}
          animate={{ opacity: [0, 0, 1, 1, 0, 0], scale: [0.4, 0.4, 1, 1, 0.9, 0.4] }}
          transition={{ duration: DUR, times: [0, 0.22, 0.34, 0.75, 0.9, 1], repeat: Infinity, ease: 'easeInOut' }}
        />
      </svg>
      {label && (
        <motion.p
          className="text-sm font-semibold text-ink-500"
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
        >
          {label}
        </motion.p>
      )}
    </div>
  )
}

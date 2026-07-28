import { motion } from 'framer-motion'

/**
 * Themed loader: a fire extinguisher sprays foam at a flame, which flares up
 * then shrinks and gets extinguished — looping. Pure SVG + Framer Motion.
 *
 * The whole cycle runs on `D` seconds; sub-animations share that timeline so
 * the spray, the shrinking flame and the puff of smoke stay in sync.
 */
const D = 3.2 // full loop duration (s)

export default function ExtinguishAnimation({ size = 160 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      role="img"
      aria-label="Fire extinguisher putting out a fire"
      style={{ overflow: 'visible' }}
    >
      <defs>
        <linearGradient id="ex-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff6b6b" />
          <stop offset="0.5" stopColor="#f73838" />
          <stop offset="1" stopColor="#bd1414" />
        </linearGradient>
        <linearGradient id="ex-flame" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#bd1414" />
          <stop offset="0.45" stopColor="#f73838" />
          <stop offset="0.8" stopColor="#ff9f40" />
          <stop offset="1" stopColor="#ffd166" />
        </linearGradient>
      </defs>

      {/* ── FLAME (right) — flares, then shrinks to nothing, then returns ── */}
      <motion.g
        style={{ transformOrigin: '150px 150px' }}
        animate={{
          scale: [1, 1.15, 0.15, 0.15, 1],
          opacity: [1, 1, 0.15, 0, 1],
        }}
        transition={{ duration: D, times: [0, 0.25, 0.62, 0.8, 1], repeat: Infinity, ease: 'easeInOut' }}
      >
        {/* flame body */}
        <motion.path
          d="M150 152
             c-16 0 -26 -12 -26 -27
             c0 -16 12 -22 8 -38
             c12 6 10 16 14 20
             c4 -6 3 -14 2 -22
             c10 8 22 22 22 40
             c0 16 -10 27 -20 27 z"
          fill="url(#ex-flame)"
          animate={{ scaleY: [1, 1.12, 1], scaleX: [1, 0.94, 1] }}
          transition={{ duration: 0.5, repeat: Infinity, ease: 'easeInOut' }}
          style={{ transformOrigin: '150px 150px' }}
        />
        {/* inner flame */}
        <motion.path
          d="M150 150 c-8 0 -13 -7 -13 -15 c0 -9 7 -13 6 -22 c9 6 12 16 12 22 c0 0 5 -6 4 -12 c6 6 7 14 7 19 c0 9 -8 8 -16 8 z"
          fill="#ffe08a"
          animate={{ opacity: [0.7, 1, 0.7] }}
          transition={{ duration: 0.4, repeat: Infinity, ease: 'easeInOut' }}
        />
      </motion.g>

      {/* ── SMOKE PUFF — rises once the flame is out ── */}
      {[0, 1, 2].map((i) => (
        <motion.circle
          key={i}
          cx={150 + (i - 1) * 8}
          cy={120}
          r={6 + i}
          fill="#9aa3b2"
          animate={{ opacity: [0, 0, 0.5, 0], y: [0, 0, -28 - i * 6, -44 - i * 6], scale: [0.4, 0.4, 1.2, 1.6] }}
          transition={{ duration: D, times: [0, 0.62, 0.78, 0.95], repeat: Infinity, ease: 'easeOut' }}
        />
      ))}

      {/* ── FOAM SPRAY — bursts from the nozzle toward the flame ── */}
      <motion.g
        animate={{ opacity: [0, 1, 1, 0, 0] }}
        transition={{ duration: D, times: [0.1, 0.2, 0.55, 0.62, 1], repeat: Infinity }}
      >
        {[...Array(9)].map((_, i) => {
          const spreadY = (i - 4) * 5
          return (
            <motion.circle
              key={i}
              cx={74}
              cy={96}
              r={3 + (i % 3)}
              fill="#cfe8ff"
              animate={{
                cx: [74, 132],
                cy: [96, 140 + spreadY],
                opacity: [0, 0.9, 0],
                scale: [0.5, 1.3, 0.6],
              }}
              transition={{
                duration: 0.7,
                repeat: Infinity,
                repeatDelay: D - 0.7,
                delay: 0.18 + (i % 3) * 0.06,
                ease: 'easeOut',
              }}
            />
          )
        })}
      </motion.g>

      {/* ── FIRE EXTINGUISHER (left) — slight recoil while spraying ── */}
      <motion.g
        animate={{ rotate: [0, -6, -6, 0, 0], x: [0, -3, -3, 0, 0] }}
        transition={{ duration: D, times: [0.1, 0.2, 0.55, 0.62, 1], repeat: Infinity, ease: 'easeInOut' }}
        style={{ transformOrigin: '60px 130px' }}
      >
        {/* body */}
        <rect x="42" y="96" width="40" height="74" rx="16" fill="url(#ex-body)" />
        <rect x="42" y="96" width="40" height="74" rx="16" fill="#000" opacity="0.06" />
        {/* label band */}
        <rect x="42" y="120" width="40" height="20" fill="#fff" opacity="0.85" />
        <rect x="48" y="126" width="28" height="3.5" rx="1.75" fill="#bd1414" />
        <rect x="48" y="132" width="20" height="3" rx="1.5" fill="#f59e0b" />
        {/* neck */}
        <rect x="56" y="86" width="12" height="14" rx="3" fill="#9aa3b2" />
        {/* handle / lever */}
        <rect x="50" y="74" width="30" height="8" rx="4" fill="#1c2230" />
        <rect x="54" y="64" width="6" height="14" rx="3" fill="#1c2230" />
        {/* hose to nozzle */}
        <path d="M68 88 q22 0 18 10 t-12 8" fill="none" stroke="#1c2230" strokeWidth="5" strokeLinecap="round" />
        {/* nozzle tip */}
        <circle cx="74" cy="96" r="5" fill="#1c2230" />
      </motion.g>
    </svg>
  )
}

import { motion } from 'framer-motion'

// One full cycle: the padlock + DANGER tag lift OFF the hasp (lockout removed),
// hang clear for a beat, then drop back down and the shackle snaps shut on the
// hasp again (lockout applied) — looping. Used for lazy-loading / route
// transitions. Original LOTO artwork: a red safety padlock + "DO NOT OPERATE"
// tag clipped to a disconnect switch shown in the OFF position.
const DUR = 2.6

// Whole lock+tag group: applied → lift away (removed) → return → applied.
const liftY = [0, 0, -32, -32, 0, 0]
const liftTimes = [0, 0.3, 0.46, 0.6, 0.82, 1]

// Shackle opens just before the lift and snaps shut as the lock lands.
const shackleY = [0, -8, -8, -8, 0, 0]
const shackleTimes = [0, 0.22, 0.3, 0.62, 0.8, 1]

// Soft glow pulse at the moment the lock re-seats (applied).
const glow = [0, 0, 0, 0, 0.45, 0]
const glowTimes = [0, 0.5, 0.7, 0.78, 0.86, 1]

const loop = { duration: DUR, repeat: Infinity, ease: 'easeInOut' }

export default function LockLoader({ size = 84, label }) {
  return (
    <div className="flex flex-col items-center gap-4">
      <svg
        width={size}
        height={(size * 134) / 120}
        viewBox="0 -10 120 134"
        fill="none"
        role="img"
        aria-label="Applying lockout"
      >
        {/* Disconnect switch shown OFF (static — the hasp stays when the lock lifts) */}
        <rect x="4" y="40" width="42" height="74" rx="8" fill="#d7dbe0" stroke="#9aa3af" strokeWidth="2.5" />
        {/* OFF indicator */}
        <rect x="9" y="48" width="32" height="15" rx="7.5" fill="#e5484d" />
        <text x="25" y="59.5" textAnchor="middle" fontSize="9" fontWeight="800" fill="#fff" fontFamily="system-ui, sans-serif">
          OFF
        </text>
        {/* toggle, flipped down to OFF */}
        <rect x="18" y="74" width="14" height="30" rx="5" fill="#8a92a0" stroke="#6b7280" strokeWidth="2" />
        {/* lockout hasp loop on the switch */}
        <circle cx="46" cy="26" r="11" fill="none" stroke="#d98324" strokeWidth="6.5" />

        {/* glow that pulses when the lock re-seats */}
        <motion.circle
          cx="46"
          cy="58"
          r="26"
          fill="#e5484d"
          animate={{ opacity: glow }}
          transition={{ ...loop, times: glowTimes }}
        />

        {/* Lock + tag — lifts off the hasp, then returns and locks */}
        <motion.g animate={{ y: liftY }} transition={{ ...loop, times: liftTimes }}>
          {/* DANGER · DO NOT OPERATE tag hanging from the shackle */}
          <path d="M52 30 C 60 38, 60 48, 66 56" stroke="#5b5750" strokeWidth="2" fill="none" strokeLinecap="round" />
          <g>
            <rect x="61" y="54" width="44" height="48" rx="5" fill="#fdf6ec" stroke="#c9b89a" strokeWidth="2" />
            <circle cx="70" cy="61" r="2.6" fill="none" stroke="#c9b89a" strokeWidth="1.6" />
            {/* red header */}
            <path d="M61 59 a5 5 0 0 1 5-5 h33 a5 5 0 0 1 5 5 v6 h-43 z" fill="#e5484d" />
            <text x="83" y="64" textAnchor="middle" fontSize="7.5" fontWeight="800" fill="#fff" fontFamily="system-ui, sans-serif">
              DANGER
            </text>
            {/* body lines */}
            <rect x="67" y="72" width="32" height="3" rx="1.5" fill="#7c726a" />
            <rect x="67" y="79" width="32" height="3" rx="1.5" fill="#bcae9c" />
            <rect x="67" y="86" width="24" height="3" rx="1.5" fill="#bcae9c" />
            <rect x="67" y="93" width="28" height="3" rx="1.5" fill="#bcae9c" />
          </g>

          {/* shackle — opens then snaps shut on the hasp */}
          <motion.path
            d="M36 50 V34 a10 10 0 0 1 20 0 V50"
            fill="none"
            stroke="#9aa3af"
            strokeWidth="6.5"
            strokeLinecap="round"
            animate={{ y: shackleY }}
            transition={{ duration: DUR, times: shackleTimes, repeat: Infinity, ease: [0.34, 1.7, 0.5, 1] }}
          />
          {/* padlock body */}
          <rect x="31" y="48" width="30" height="28" rx="6" fill="#e5484d" stroke="#b91c1c" strokeWidth="2.5" />
          {/* keyhole */}
          <circle cx="46" cy="59" r="3.2" fill="#fff" />
          <rect x="44.6" y="59" width="2.8" height="8" rx="1.4" fill="#fff" />
        </motion.g>
      </svg>
      {label && <span className="text-sm font-medium text-steel-400">{label}</span>}
    </div>
  )
}

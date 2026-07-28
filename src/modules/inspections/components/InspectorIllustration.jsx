import { motion, useReducedMotion } from 'framer-motion'

// ─────────────────────────────────────────────────────────────────────────────
// Animated brand illustration: a site inspector who "takes out" the clipboard,
// after which each surrounding element (crane, building, tape measures, cone,
// decorative dots) pops in one after another. Built as an SVG so it stays crisp
// and theme-able; magenta dots tie it to the app's brand.
// ─────────────────────────────────────────────────────────────────────────────

// The reveal order is driven by an explicit `custom` index per element (not DOM
// order), so the figure can appear FIRST while still being painted on TOP of
// the props behind it. Sequence: figure → pad → crane → building → tapes → cone
// → dots, one after another.
const BASE_DELAY = 0.3
const STEP = 0.18
const delayFor = (i) => BASE_DELAY + i * STEP

const container = { hidden: {}, show: {} }

// The figure settles in first.
const figure = {
  hidden: { opacity: 0, y: 16 },
  show: (i) => ({ opacity: 1, y: 0, transition: { delay: delayFor(i), type: 'spring', stiffness: 200, damping: 18 } }),
}
// Then the clipboard + pen + forearms rise into the hands ("take out the pad").
const pad = {
  hidden: { opacity: 0, y: 50, rotate: -10 },
  show: (i) => ({ opacity: 1, y: 0, rotate: 0, transition: { delay: delayFor(i), type: 'spring', stiffness: 170, damping: 15 } }),
}
// Every surrounding prop then pops with a springy scale, one after another.
const popUp = {
  hidden: { opacity: 0, scale: 0.4 },
  show: (i) => ({ opacity: 1, scale: 1, transition: { delay: delayFor(i), type: 'spring', stiffness: 260, damping: 16 } }),
}

// Scale around each group's own centre, not the SVG origin.
const origin = { transformBox: 'fill-box', transformOrigin: 'center' }

export default function InspectorIllustration({ className = '' }) {
  const reduce = useReducedMotion()

  return (
    <motion.svg
      viewBox="0 0 600 360"
      className={className}
      role="img"
      aria-label="Site inspector with a clipboard, surrounded by construction elements"
      variants={container}
      initial={reduce ? false : 'hidden'}
      animate="show"
    >
      {/* ── Crane (top-left) ─────────────────────────────────────────── */}
      <motion.g variants={popUp} custom={2} style={origin}>
        <rect x="56" y="188" width="42" height="12" rx="3" fill="#c2410c" />
        <rect x="71" y="74" width="12" height="118" fill="#ef8c42" />
        <rect x="71" y="74" width="12" height="118" fill="none" stroke="#fff" strokeWidth="1.4" strokeDasharray="10 8" opacity="0.5" />
        <rect x="44" y="66" width="156" height="10" rx="3" fill="#ef8c42" />
        <rect x="58" y="52" width="26" height="16" rx="3" fill="#374151" />
        <path d="M77 52 L67 66 L90 66 Z" fill="#4b5563" />
        <line x1="172" y1="76" x2="172" y2="104" stroke="#374151" strokeWidth="2.5" />
        <rect x="162" y="104" width="20" height="16" rx="3" fill="#fbbf24" stroke="#d97706" strokeWidth="2" />
      </motion.g>

      {/* ── Building (right) ─────────────────────────────────────────── */}
      <motion.g variants={popUp} custom={3} style={origin}>
        <rect x="450" y="112" width="96" height="12" rx="3" fill="#e2e8f0" />
        <rect x="456" y="124" width="84" height="108" rx="4" fill="#ffffff" stroke="#cbd5e1" strokeWidth="3" />
        {[0, 1, 2, 3].map((r) =>
          [0, 1, 2].map((c) => (
            <rect key={`${r}-${c}`} x={467 + c * 23} y={136 + r * 22} width="14" height="14" rx="2" fill="#bfdbfe" />
          ))
        )}
        <rect x="490" y="210" width="16" height="22" rx="2" fill="#93c5fd" />
      </motion.g>

      {/* ── Tape measure (top-right) ─────────────────────────────────── */}
      <motion.g variants={popUp} custom={4} style={origin}>
        <rect x="500" y="60" width="26" height="10" rx="3" fill="#fde68a" stroke="#f59e0b" strokeWidth="2" />
        <circle cx="492" cy="64" r="20" fill="#fbbf24" stroke="#d97706" strokeWidth="3" />
        <circle cx="492" cy="64" r="7" fill="#f59e0b" />
      </motion.g>

      {/* ── Tape measure (left-mid) ──────────────────────────────────── */}
      <motion.g variants={popUp} custom={5} style={origin}>
        <rect x="60" y="248" width="22" height="9" rx="3" fill="#fde68a" stroke="#f59e0b" strokeWidth="2" />
        <circle cx="96" cy="252" r="17" fill="#fbbf24" stroke="#d97706" strokeWidth="3" />
        <circle cx="96" cy="252" r="6" fill="#f59e0b" />
      </motion.g>

      {/* ── Traffic cone (bottom-right) ──────────────────────────────── */}
      <motion.g variants={popUp} custom={6} style={origin}>
        <rect x="438" y="312" width="76" height="13" rx="6" fill="#ea580c" />
        <path d="M476 248 L504 312 L448 312 Z" fill="#f97316" />
        <path d="M468 282 L484 282 L490 296 L462 296 Z" fill="#ffffff" />
        <path d="M474 266 L478 266 L472 280 L468 280 Z" fill="#ffffff" opacity="0.9" />
        <rect x="470" y="242" width="12" height="9" rx="3" fill="#ea580c" />
      </motion.g>

      {/* ── The inspector (figure, no pad yet) ───────────────────────── */}
      <motion.g variants={figure} custom={0} style={origin}>
        {/* hair / back of head */}
        <path d="M262 150 q42 -50 92 -6 q5 26 -3 44 q-46 -26 -86 -6 Z" fill="#4b2e23" />
        {/* neck */}
        <rect x="286" y="190" width="34" height="30" rx="11" fill="#e8a87c" />
        {/* face */}
        <ellipse cx="304" cy="166" rx="40" ry="42" fill="#f3c39e" />
        <circle cx="266" cy="172" r="7" fill="#e8a87c" />
        {/* simple features */}
        <circle cx="298" cy="164" r="3.2" fill="#3f2a20" />
        <circle cx="322" cy="164" r="3.2" fill="#3f2a20" />
        <path d="M312 176 q4 5 9 1" fill="none" stroke="#c98a64" strokeWidth="2.5" strokeLinecap="round" />
        {/* hard hat */}
        <ellipse cx="304" cy="132" rx="70" ry="13" fill="#f0a020" />
        <path d="M236 132 C238 90 370 90 372 132 Z" fill="#f6b03a" />
        <path d="M236 132 C238 122 370 122 372 132 Z" fill="#e0901a" opacity="0.6" />
        <ellipse cx="304" cy="98" rx="11" ry="6" fill="#e0901a" />
        {/* torso: blue shirt base */}
        <path d="M244 332 C240 268 256 236 304 236 C352 236 368 268 364 332 Z" fill="#33a0e0" />
        {/* hi-vis vest */}
        <path d="M268 332 C266 262 280 240 304 240 C328 240 342 262 340 332 Z" fill="#f59e0b" />
        {/* vest opening showing shirt */}
        <path d="M304 244 L292 332 L316 332 Z" fill="#33a0e0" />
        {/* reflective stripes */}
        <path d="M276 300 L332 300 L332 312 L276 312 Z" fill="#eef2f7" opacity="0.85" />
        <path d="M280 256 L284 332 L276 332 L272 258 Z" fill="#eef2f7" opacity="0.7" />
        <path d="M328 256 L332 258 L336 332 L324 332 Z" fill="#eef2f7" opacity="0.7" />
        {/* upper-arm shoulder caps (blue) */}
        <path d="M250 250 q-16 8 -14 40 l18 4 q2 -28 8 -40 Z" fill="#2f95d4" />
        <path d="M358 250 q16 8 14 40 l-18 4 q-2 -28 -8 -40 Z" fill="#2f95d4" />
      </motion.g>

      {/* ── The pad: forearms + hands + clipboard + pen (rises in) ─────── */}
      <motion.g variants={pad} custom={1} style={origin}>
        {/* forearms reaching toward the board */}
        <path d="M252 286 L286 300 L280 318 L244 304 Z" fill="#33a0e0" />
        <path d="M356 286 L324 300 L330 318 L364 304 Z" fill="#33a0e0" />
        {/* clipboard (tilted) */}
        <g transform="rotate(-7 304 300)">
          <rect x="262" y="270" width="92" height="64" rx="9" fill="#27313f" />
          <rect x="270" y="277" width="76" height="50" rx="4" fill="#ffffff" />
          <rect x="299" y="265" width="22" height="11" rx="3" fill="#9aa3af" />
          <rect x="278" y="289" width="44" height="4.5" rx="2" fill="#d4dbe4" />
          <rect x="278" y="300" width="58" height="4.5" rx="2" fill="#d4dbe4" />
          <rect x="278" y="311" width="34" height="4.5" rx="2" fill="#d4dbe4" />
          <path d="M325 305 l5 6 l11 -13" fill="none" stroke="#d946ef" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        {/* hands */}
        <circle cx="280" cy="312" r="9" fill="#f3c39e" />
        <circle cx="330" cy="312" r="9" fill="#f3c39e" />
        {/* pen */}
        <g transform="rotate(38 332 304)">
          <rect x="328" y="286" width="7" height="30" rx="3" fill="#1f2937" />
          <path d="M328 316 L335 316 L331.5 324 Z" fill="#d946ef" />
        </g>
      </motion.g>

      {/* ── Decorative dots (appear last, in two waves) ──────────────── */}
      <motion.g variants={popUp} custom={7} style={origin}>
        <circle cx="150" cy="248" r="6" fill="#d946ef" />
        <circle cx="206" cy="110" r="5" fill="#38bdf8" />
        <rect x="186" y="150" width="11" height="11" rx="3" fill="#d946ef" transform="rotate(20 191 155)" />
        <circle cx="420" cy="84" r="5" fill="#fbbf24" />
      </motion.g>
      <motion.g variants={popUp} custom={8} style={origin}>
        <circle cx="548" cy="258" r="6" fill="#d946ef" />
        <circle cx="408" cy="300" r="5" fill="#38bdf8" />
        <rect x="120" y="120" width="10" height="10" rx="3" fill="#fbbf24" transform="rotate(15 125 125)" />
        <path d="M430 150 a14 14 0 1 1 -10 -13" fill="none" stroke="#38bdf8" strokeWidth="3" strokeLinecap="round" />
      </motion.g>
    </motion.svg>
  )
}

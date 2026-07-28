import { useEffect, useMemo, useRef, useState, lazy, Suspense, Component } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence, useReducedMotion, useMotionValue, animate } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { useTutorial } from '../context/TutorialContext'
import { useOrgProcedures, useOrgEvents } from '../hooks/useOrgProcedures'
import { useSites } from '../hooks/useSites'
import { useTechnicians } from '../hooks/useTechnicians'
import { useLocks } from '../hooks/useLocks'
import { LOCK_STATUS } from '../constants/procedures'
import { pageGuide, suggestedQuestions, answer, askAI, buildAIContext } from '../lib/assistant'

// The 3D mascot is heavy (three.js) — load it only when needed.
const Character3D = lazy(() => import('./Character3D'))

// Falls back to the 2D SVG Sam if WebGL / three fails to load.
class AvatarBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { /* swallow — fallback handles it */ }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

// ── Inline icons (HECP convention; avoids a lucide-react dependency) ─────────
const Ico = ({ d, size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>
)
const IconX = <Ico size={15} d={<path d="M18 6 6 18M6 6l12 12" />} />
const IconSend = <Ico d={<><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4Z" /></>} />
const IconSparkles = <Ico size={13} d={<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10z" />} />
const IconBulb = <Ico size={13} d={<><path d="M9 18h6M10 22h4" /><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1h6c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z" /></>} />
const IconMove = <Ico size={12} d={<><path d="M12 2v20M2 12h20M5 9l-3 3 3 3M19 9l3 3-3 3M9 5l3-3 3 3M9 19l3 3 3-3" /></>} />
const IconEyeOff = <Ico size={12} d={<><path d="M9.9 4.2A9 9 0 0 1 12 4c7 0 10 8 10 8a13 13 0 0 1-1.7 2.7M6.6 6.6A13 13 0 0 0 2 12s3 8 10 8a9 9 0 0 0 3.7-.8M1 1l22 22" /></>} />
const IconChat = <Ico size={15} d={<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.9-.9L3 21l1.9-4.1A8.4 8.4 0 1 1 21 11.5z" />} />

const lsx = {
  get: (k) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } },
}
const loop = (d) => ({ duration: d, repeat: Infinity, ease: 'easeInOut' })
const IDLE_SLEEP_MS = 3 * 60 * 1000

const SKIN = '#e8b48f', SKIN_D = '#c98b62', HAT = '#f4b400', HAT_D = '#c98a00'
const VEST = '#2563eb', VEST_D = '#1e40af', STRIPE = '#fde047', TROUSER = '#1e3a8a', SHOE = '#0b1220'

// ── Safety Manager "Sam": hard hat + hi-vis vest, two-segment arms ───────────
export function Character({ mode = 'idle', reduced = false }) {
  const walking = mode === 'walk'
  const sleeping = mode === 'sleep'

  const legL = reduced ? { rotate: 0 } : walking ? { rotate: [0, 24, 0, -24, 0] } : { rotate: 0 }
  const legR = reduced ? { rotate: 0 } : walking ? { rotate: [0, -24, 0, 24, 0] } : { rotate: 0 }
  const legT = walking ? loop(0.6) : { duration: 0.3 }

  let uAL = { rotate: 0 }, fAL = { rotate: 0 }, uALT = { duration: 0.4 }, fALT = { duration: 0.4 }
  let uAR = { rotate: 0 }, fAR = { rotate: 0 }, uART = { duration: 0.4 }, fART = { duration: 0.4 }
  let head = { rotate: 0 }, headT = { duration: 0.4 }

  if (reduced) {
    if (mode === 'write') { uAL = { rotate: -52 }; fAL = { rotate: -78 }; uAR = { rotate: -44 }; fAR = { rotate: -66 }; head = { rotate: 8 } }
    else if (mode === 'think') { uAR = { rotate: -42 }; fAR = { rotate: -95 }; head = { rotate: -6 } }
    else if (sleeping) head = { rotate: 12 }
  } else if (sleeping) {
    uAL = { rotate: 4 }; uAR = { rotate: -4 }; head = { rotate: 12 }
  } else if (walking) {
    uAL = { rotate: [0, -18, 0, 18, 0] }; uALT = loop(0.6)
    uAR = { rotate: [0, 18, 0, -18, 0] }; uART = loop(0.6)
  } else if (mode === 'write') {
    uAL = { rotate: -52 }; fAL = { rotate: -78 }
    uAR = { rotate: -44 }; fAR = { rotate: [-62, -72, -62] }; fART = loop(0.5); head = { rotate: 8 }
  } else if (mode === 'think') {
    uAR = { rotate: -42 }; fAR = { rotate: -95 }; head = { rotate: -6 }
  } else if (mode === 'scratch') {
    uAR = { rotate: -150 }; fAR = { rotate: [-34, -52, -34] }; fART = loop(0.4); head = { rotate: -4 }
  } else if (mode === 'wave') {
    uAR = { rotate: -150 }; fAR = { rotate: [-12, 22, -12] }; fART = loop(0.5)
  } else {
    uAL = { rotate: [0, 3, 0] }; uALT = loop(3.2)
    uAR = { rotate: [0, -3, 0] }; uART = loop(3.2)
    if (mode === 'search') { uAR = { rotate: -34 }; fAR = { rotate: -34 }; head = { rotate: [-9, 9, -9] }; headT = loop(1.6) }
  }

  const bob = reduced ? { y: 0 } : walking ? { y: [0, -2, 0] } : { y: [0, -1.2, 0] }
  const bobT = walking ? loop(0.6) : loop(sleeping ? 3.6 : 2.8)
  const blink = reduced ? undefined : { scaleY: [1, 1, 0.1, 1] }
  const blinkT = reduced ? undefined : { duration: 0.32, times: [0, 0.85, 0.92, 1], repeat: Infinity, repeatDelay: 3 }

  const Arm = ({ shoulder, elbow, upper, fore, uT, fT, withPen }) => (
    <motion.g style={{ transformOrigin: `${shoulder[0]}px ${shoulder[1]}px` }} animate={upper} transition={uT}>
      <rect x={shoulder[0] - 2.75} y={shoulder[1]} width="5.5" height={elbow[1] - shoulder[1]} rx="2.7" fill={VEST} stroke={VEST_D} strokeWidth="0.7" />
      <motion.g style={{ transformOrigin: `${elbow[0]}px ${elbow[1]}px` }} animate={fore} transition={fT}>
        <rect x={elbow[0] - 2.75} y={elbow[1]} width="5.5" height="14" rx="2.7" fill={VEST} stroke={VEST_D} strokeWidth="0.7" />
        <circle cx={elbow[0]} cy={elbow[1] + 16} r="3" fill={SKIN} stroke={SKIN_D} strokeWidth="0.6" />
        {withPen && <line x1={elbow[0] + 1} y1={elbow[1] + 14} x2={elbow[0] + 4} y2={elbow[1] + 19} stroke="#0b1220" strokeWidth="1.6" strokeLinecap="round" />}
      </motion.g>
    </motion.g>
  )

  return (
    <svg width="62" height="116" viewBox="0 0 64 120" fill="none" aria-hidden="true">
      <motion.g animate={bob} transition={bobT}>
        <motion.g style={{ transformOrigin: '28px 74px' }} animate={legL} transition={legT}>
          <rect x="24.5" y="74" width="6.5" height="32" rx="2.4" fill={TROUSER} />
          <rect x="22.5" y="104" width="11" height="6.5" rx="3" fill={SHOE} />
        </motion.g>
        <motion.g style={{ transformOrigin: '36px 74px' }} animate={legR} transition={legT}>
          <rect x="33" y="74" width="6.5" height="32" rx="2.4" fill="#172e6b" />
          <rect x="30.5" y="104" width="11" height="6.5" rx="3" fill={SHOE} />
        </motion.g>

        <rect x="22" y="33" width="20" height="42" rx="6" fill="#e7eef8" />
        <path d="M23 41h7l2 5 2-5h7v33a3 3 0 0 1-3 3H26a3 3 0 0 1-3-3z" fill={VEST} stroke={VEST_D} strokeWidth="0.8" />
        <rect x="25" y="58" width="14" height="2.6" fill={STRIPE} />
        <rect x="27.5" y="44" width="2.4" height="31" fill={STRIPE} />
        <rect x="34.1" y="44" width="2.4" height="31" fill={STRIPE} />
        <rect x="29" y="29" width="6" height="6" fill={SKIN} />

        <Arm shoulder={[24, 39]} elbow={[24, 54]} upper={uAL} fore={fAL} uT={uALT} fT={fALT} />

        {mode === 'write' && (
          <g transform="rotate(-8 33 60)">
            <rect x="24" y="50" width="19" height="24" rx="2" fill="#c8d2e0" stroke="#94a3b8" strokeWidth="0.8" />
            <rect x="26" y="53" width="15" height="19" rx="1" fill="#fff" />
            <rect x="30" y="48.5" width="7" height="3" rx="1" fill="#94a3b8" />
            <rect x="28" y="57" width="11" height="1.2" rx="0.6" fill="#cbd5e1" />
            <rect x="28" y="61" width="11" height="1.2" rx="0.6" fill="#cbd5e1" />
            <rect x="28" y="65" width="8" height="1.2" rx="0.6" fill="#cbd5e1" />
          </g>
        )}

        <Arm shoulder={[40, 39]} elbow={[40, 54]} upper={uAR} fore={fAR} uT={uART} fT={fART} withPen={mode === 'write'} />

        <motion.g style={{ transformOrigin: '32px 31px' }} animate={head} transition={headT}>
          <circle cx="23.5" cy="23" r="2" fill={SKIN} stroke={SKIN_D} strokeWidth="0.5" />
          <circle cx="40.5" cy="23" r="2" fill={SKIN} stroke={SKIN_D} strokeWidth="0.5" />
          <circle cx="32" cy="22" r="9.2" fill={SKIN} stroke={SKIN_D} strokeWidth="0.6" />
          <path d="M23.5 20c0-3 2-5 4-5l-1 6z" fill="#4a3526" />
          <path d="M40.5 20c0-3-2-5-4-5l1 6z" fill="#4a3526" />
          {sleeping ? (
            <>
              <path d="M27 22.4q1.6 1.4 3.2 0" stroke={SKIN_D} strokeWidth="0.9" strokeLinecap="round" fill="none" />
              <path d="M33.8 22.4q1.6 1.4 3.2 0" stroke={SKIN_D} strokeWidth="0.9" strokeLinecap="round" fill="none" />
            </>
          ) : (
            <motion.g style={{ transformOrigin: '32px 22px' }} animate={blink} transition={blinkT}>
              <circle cx="28.6" cy="22" r="1.5" fill="#fff" /><circle cx="29" cy="22.2" r="0.9" fill="#1f2937" />
              <circle cx="35.4" cy="22" r="1.5" fill="#fff" /><circle cx="35.8" cy="22.2" r="0.9" fill="#1f2937" />
            </motion.g>
          )}
          <path d="M27 18.6c1-0.6 2.4-0.6 3.4 0" stroke="#4a3526" strokeWidth="0.8" strokeLinecap="round" />
          <path d="M34 18.6c1-0.6 2.4-0.6 3.4 0" stroke="#4a3526" strokeWidth="0.8" strokeLinecap="round" />
          {!sleeping && <path d="M29 26.5c1.6 1.4 4.4 1.4 6 0" stroke={SKIN_D} strokeWidth="0.9" strokeLinecap="round" fill="none" />}
          <path d="M21 17a11 9.5 0 0 1 22 0z" fill={HAT} />
          <rect x="19" y="15.6" width="26" height="2.8" rx="1.4" fill={HAT_D} />
          <rect x="31" y="8.6" width="2" height="7" fill={HAT_D} />
        </motion.g>

        {mode === 'think' && !reduced && (
          <motion.g initial={{ opacity: 0 }} animate={{ opacity: [0.2, 1, 0.2] }} transition={loop(1.4)}>
            <circle cx="46" cy="16" r="1.4" fill="#94a3b8" /><circle cx="50" cy="11" r="2" fill="#94a3b8" /><circle cx="54" cy="6" r="2.6" fill="#94a3b8" />
          </motion.g>
        )}

        {sleeping && !reduced && (
          <motion.g initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0], y: [0, -10] }} transition={loop(2.2)} fill="#94a3b8" fontFamily="sans-serif" fontWeight="800">
            <text x="44" y="14" fontSize="6">z</text>
            <text x="48" y="9" fontSize="8">Z</text>
          </motion.g>
        )}
      </motion.g>
    </svg>
  )
}

function Bubble({ from, children }) {
  const mine = from === 'user'
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] whitespace-pre-line rounded-2xl px-3 py-2 text-sm ${mine ? 'bg-hazard text-ink' : 'bg-clay text-steel-100'}`}>{children}</div>
    </div>
  )
}

export default function Assistant() {
  const location = useLocation()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { active: tourActive } = useTutorial()
  const { procedures } = useOrgProcedures()
  const { events } = useOrgEvents()
  const { sites } = useSites()
  const { technicians } = useTechnicians()
  const { locks } = useLocks()
  const reduced = useReducedMotion()
  const uid = profile?.id || 'anon'

  const [enabled, setEnabled] = useState(() => lsx.get(`hecp:bot:enabled:${uid}`) !== '0')
  const [open, setOpen] = useState(false)
  const [tip, setTip] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [asking, setAsking] = useState(false)
  const scrollRef = useRef(null)

  const [mode, setMode] = useState('idle')
  const [facing, setFacing] = useState(-1)
  const [asleep, setAsleep] = useState(false)
  const [pinned, setPinned] = useState(() => lsx.get(`hecp:bot:pinned:${uid}`) === '1')

  const savedPos = useMemo(() => { try { return JSON.parse(lsx.get(`hecp:bot:pos:${uid}`) || 'null') } catch { return null } }, [uid])
  const mx = useMotionValue(savedPos?.x ?? 80)
  const my = useMotionValue(savedPos?.y ?? 0)
  const lastRef = useRef(Date.now())
  const asleepRef = useRef(false)
  const greetedRef = useRef(false)
  useEffect(() => { asleepRef.current = asleep }, [asleep])

  const guide = useMemo(() => pageGuide(location.pathname), [location.pathname])
  const chips = useMemo(() => suggestedQuestions(location.pathname), [location.pathname])
  const attention = useMemo(
    () => procedures.filter((p) => p.lockSummary?.status === LOCK_STATUS.PARTIAL).length,
    [procedures],
  )
  const ctx = { procedures, events, sites, technicians, locks, pathname: location.pathname }
  const writingPage = location.pathname.includes('/procedures/new') || location.pathname.includes('/revise')
  const homeX = () => Math.max(20, (typeof window !== 'undefined' ? window.innerWidth : 1000) - 96)

  // Idle → sleep after 3 minutes of no activity; any activity wakes Sam.
  useEffect(() => {
    const bump = () => { lastRef.current = Date.now(); if (asleepRef.current) setAsleep(false) }
    const evs = ['mousemove', 'keydown', 'scroll', 'click', 'touchstart']
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }))
    const iv = setInterval(() => { if (Date.now() - lastRef.current > IDLE_SLEEP_MS) setAsleep(true) }, 15000)
    return () => { evs.forEach((e) => window.removeEventListener(e, bump)); clearInterval(iv) }
  }, [])

  // Movement / pose state machine.
  useEffect(() => {
    if (!enabled) return undefined
    if (asleep) { setMode('sleep'); return undefined }
    if (open || tip) {
      if (!pinned) { setFacing(-1); animate(mx, homeX(), { duration: 0.7, ease: 'linear' }); animate(my, 0, { duration: 0.4 }) }
      setMode(open ? 'wave' : 'idle')
      return undefined
    }
    if (writingPage) {
      if (!pinned) { setFacing(1); animate(mx, 46, { duration: 0.7, ease: 'linear' }); animate(my, 0, { duration: 0.4 }) }
      setMode('write')
      return undefined
    }
    if (reduced || pinned) { setMode('idle'); return undefined }
    // roam
    let alive = true
    let t
    let anim
    const rand = (a, b) => a + Math.random() * (b - a)
    const step = () => {
      if (!alive) return
      const from = mx.get()
      const maxX = Math.max(90, (window.innerWidth || 1000) - 120)
      const target = Math.round(rand(20, maxX))
      const dur = Math.min(6, Math.max(1.2, Math.abs(target - from) / 110))
      setFacing(target >= from ? 1 : -1)
      setMode('walk')
      anim = animate(mx, target, { duration: dur, ease: 'linear' })
      t = setTimeout(() => {
        if (!alive) return
        setMode(['idle', 'search', 'think', 'scratch', 'wave'][Math.floor(Math.random() * 5)])
        t = setTimeout(step, rand(3200, 6000))
      }, dur * 1000 + 150)
    }
    t = setTimeout(step, 1400)
    return () => { alive = false; clearTimeout(t); if (anim?.stop) anim.stop() }
  }, [enabled, asleep, open, tip, writingPage, reduced, pinned, mx, my])

  // Greeting (once per page load) → then per-page tips.
  useEffect(() => {
    if (!enabled || open) return undefined
    if (!greetedRef.current) {
      greetedRef.current = true
      const t = setTimeout(() => {
        setTip({ greeting: true, title: "Hi, I'm Sam 👷", text: 'Tap me anytime to ask about your procedures, locks, approvals and sites.' })
      }, 1200)
      const t2 = setTimeout(() => setTip((cur) => (cur?.greeting ? null : cur)), 9000)
      return () => { clearTimeout(t); clearTimeout(t2) }
    }
    const seenKey = `hecp:bot:tip:${uid}:${guide.title}`
    if (lsx.get(seenKey) !== '1') { const t = setTimeout(() => setTip({ title: guide.title, text: guide.tips[0] }), 900); return () => clearTimeout(t) }
    return undefined
  }, [location.pathname, open, uid, guide, enabled])

  const dismissTip = () => {
    if (tip && !tip.greeting) lsx.set(`hecp:bot:tip:${uid}:${guide.title}`, '1')
    setTip(null)
  }
  const openPanel = () => {
    if (tip && !tip.greeting) lsx.set(`hecp:bot:tip:${uid}:${guide.title}`, '1')
    setTip(null); setOpen(true); lastRef.current = Date.now(); setAsleep(false)
  }
  const onDragEnd = () => {
    const vw = window.innerWidth || 1000
    const vh = window.innerHeight || 800
    mx.set(Math.min(Math.max(mx.get(), 0), vw - 90))
    my.set(Math.min(Math.max(my.get(), -(vh - 170)), 0))
    setPinned(true)
    lsx.set(`hecp:bot:pinned:${uid}`, '1')
    lsx.set(`hecp:bot:pos:${uid}`, JSON.stringify({ x: mx.get(), y: my.get() }))
    lastRef.current = Date.now(); setAsleep(false)
  }
  const setRoam = () => { setPinned(false); lsx.set(`hecp:bot:pinned:${uid}`, '0'); animate(my, 0, { duration: 0.4 }) }
  const disableGuide = () => { setOpen(false); setEnabled(false); lsx.set(`hecp:bot:enabled:${uid}`, '0') }
  const enableGuide = () => { setEnabled(true); lsx.set(`hecp:bot:enabled:${uid}`, '1') }

  // Hybrid: instant rule answer if it matched; otherwise fall back to the AI.
  const ask = async (text) => {
    const t = (text || '').trim()
    if (!t || asking) return
    setInput('')
    const rule = answer(t, ctx)
    if (rule.matched) {
      setMessages((m) => [...m, { from: 'user', text: t }, { from: 'guide', text: rule.text }])
      if (rule.action?.type === 'navigate' && rule.action.to) {
        setTimeout(() => { navigate(rule.action.to); setOpen(false) }, 700)
      }
      return
    }
    setMessages((m) => [...m, { from: 'user', text: t }, { from: 'guide', text: '…', thinking: true }])
    setAsking(true); lastRef.current = Date.now(); setAsleep(false)
    let reply = null
    try { reply = await askAI(t, buildAIContext(ctx)) } catch { reply = null }
    setAsking(false)
    setMessages((m) => {
      const copy = m.slice()
      for (let i = copy.length - 1; i >= 0; i--) {
        if (copy[i].thinking) { copy[i] = { from: 'guide', text: reply || rule.text }; break }
      }
      return copy
    })
  }
  useEffect(() => { if (open && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }, [messages, open])

  // While the first-login tour is running it drives its own Sam — hide this one.
  if (tourActive) return null

  // Disabled → small restore button only.
  if (!enabled) {
    return (
      <button onClick={enableGuide} className="fixed bottom-4 right-4 z-40 flex items-center gap-1.5 rounded-full bg-hazard px-3 py-2 text-xs font-bold text-ink shadow-clay hover:bg-hazard-dark" title="Show the Safety Bot">
        {IconChat} Safety Bot
      </button>
    )
  }

  const shownMode = asking ? 'think' : open ? 'wave' : asleep ? 'sleep' : mode

  return (
    <div>
      {/* Draggable walking character */}
      <motion.div
        className="fixed bottom-1 left-0 z-40 cursor-grab active:cursor-grabbing"
        style={{ x: mx, y: my }}
        drag
        dragMomentum={false}
        dragElastic={0.04}
        onDragStart={() => { setMode('idle'); lastRef.current = Date.now(); setAsleep(false) }}
        onDragEnd={onDragEnd}
      >
        <button onClick={() => (open ? setOpen(false) : openPanel())} className="relative block" aria-label="Open Safety Bot">
          {reduced ? (
            <div style={{ transform: `scaleX(${facing})` }}>
              <Character mode={shownMode} reduced />
            </div>
          ) : (
            <AvatarBoundary fallback={<div style={{ transform: `scaleX(${facing})` }}><Character mode={shownMode} reduced /></div>}>
              <Suspense fallback={<div style={{ transform: `scaleX(${facing})` }}><Character mode={shownMode} reduced /></div>}>
                <Character3D
                  mode={shownMode}
                  size={68}
                  facing={facing}
                  fallback={<div style={{ transform: `scaleX(${facing})` }}><Character mode={shownMode} reduced /></div>}
                />
              </Suspense>
            </AvatarBoundary>
          )}
          {attention > 0 && (
            <span className="absolute right-0 top-2 grid h-5 min-w-5 place-items-center rounded-full bg-danger px-1 text-[10px] font-extrabold text-white ring-2 ring-claySurface">{attention}</span>
          )}
        </button>
      </motion.div>

      {/* Tip / welcome bubble */}
      <AnimatePresence>
        {tip && !open && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96, transition: { duration: 0.12 } }}
            transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
            className="fixed bottom-28 right-5 z-40 w-64 rounded-2xl border border-steel-700 bg-claySurface p-3.5 shadow-clay"
          >
            <button onClick={dismissTip} className="absolute right-2 top-2 rounded-lg p-1 text-steel-400 hover:bg-clay">{IconX}</button>
            <p className="pr-4 text-sm font-bold text-steel-50">{tip.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-steel-400">{tip.text}</p>
            <button onClick={openPanel} className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-hazard px-3 py-1.5 text-xs font-semibold text-ink hover:bg-hazard-dark">{IconSparkles} Ask Sam</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Assistant panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97, transition: { duration: 0.12 } }}
            transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
            style={{ transformOrigin: 'bottom right' }}
            className="fixed bottom-32 right-5 z-50 flex max-h-[68vh] w-[360px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-steel-700 bg-claySurface shadow-clay"
          >
            <div className="flex items-center gap-2.5 bg-hazard px-4 py-3 text-ink">
              <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-black/10"><Character mode="idle" reduced /></span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold">Sam — Safety Bot</p>
                <p className="text-[11px] text-ink/70">LOTO insights from your live data</p>
              </div>
              <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-ink/70 hover:bg-black/10">{IconX}</button>
            </div>

            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
              <div className="rounded-2xl bg-hazard/10 p-3">
                <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-amber-700">{IconBulb} {guide.title}</p>
                <ul className="mt-1.5 space-y-1 text-xs leading-relaxed text-steel-300">{guide.tips.map((t, i) => <li key={i}>• {t}</li>)}</ul>
              </div>
              {attention > 0 && <Bubble from="guide">⚠️ {attention} equipment partially locked. Ask “what’s partially locked?” or open the LOTO Register.</Bubble>}
              {messages.map((m, i) => <Bubble key={i} from={m.from}>{m.text}</Bubble>)}
            </div>

            <div className="flex flex-wrap gap-1.5 border-t border-steel-700/60 px-3 pt-2.5">
              {chips.map((c) => <button key={c} onClick={() => ask(c)} className="rounded-full bg-clay px-2.5 py-1 text-xs font-medium text-steel-300 transition-colors hover:bg-steel-800 hover:text-steel-100">{c}</button>)}
            </div>

            <form onSubmit={(e) => { e.preventDefault(); ask(input) }} className="flex items-center gap-2 px-3 py-3">
              <input
                className="flex-1 rounded-xl bg-clay px-3 py-2 text-sm text-steel-100 shadow-clay-inset outline-none ring-2 ring-transparent transition-[box-shadow] ease-out-strong focus:ring-hazard/50"
                placeholder={asking ? 'Thinking…' : 'Ask about your LOTO…'}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={asking}
              />
              <button type="submit" className="rounded-xl bg-hazard px-3 py-2 text-ink shadow-clay disabled:opacity-50" disabled={!input.trim() || asking}>{IconSend}</button>
            </form>

            <div className="flex items-center justify-between gap-2 border-t border-steel-700/60 px-3 py-2 text-[11px] text-steel-400">
              <button onClick={setRoam} className="inline-flex items-center gap-1 hover:text-steel-200" disabled={!pinned}>
                {IconMove} {pinned ? 'Let Sam roam' : 'Drag Sam to pin him'}
              </button>
              <button onClick={disableGuide} className="inline-flex items-center gap-1 hover:text-steel-200">{IconEyeOff} Hide bot</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

import { useEffect, useMemo, useRef, useState, lazy, Suspense, Component } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence, useReducedMotion, useMotionValue, animate } from 'framer-motion'
import { X, Send, Sparkles, Lightbulb, Move, EyeOff, MessageCircle } from 'lucide-react'
import { useData } from '../context/DataContext'
import { useAuth } from '../context/AuthContext'
import { pageGuide, suggestedQuestions, answer, askAI, buildAIContext } from '../lib/assistant'

// 3D character is heavy (three.js) — load it only when needed. The auto wrapper
// uses a realistic rigged .glb if one is present, else the procedural figure.
const Character3D = lazy(() => import('./Character3DRigged'))

// Falls back to the 2D SVG Sam if WebGL/three fails to load.
class AvatarBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { /* swallow — fallback handles it */ }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

const ls = {
  get: (k) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } },
}
const loop = (d) => ({ duration: d, repeat: Infinity, ease: 'easeInOut' })
const IDLE_SLEEP_MS = 3 * 60 * 1000

// First-login walkthrough. Sam walks across the screen and narrates each of the
// core pages, navigating the app as he goes. Runs once per user (persisted),
// and can be replayed from the panel.
const TOUR = [
  { to: '/dashboard', title: 'Welcome aboard! 👷', text: "I'm Sam, your inspection guide. Let me show you around — this is your Dashboard, a live overview of forms, what's due and what's overdue." },
  { to: '/inspections/forms', title: 'Inspection Forms', text: 'Build your checklists here, then hit “Assign” to schedule a form to a site and date. The same form can go to several sites.' },
  { to: '/inspections/schedule', title: 'Schedule', text: 'Your month calendar of upcoming inspections. Click any tile to run that inspection — done ones turn green or red with their score.' },
  { to: '/inspections/overdue', title: 'Overdue', text: "Anything past its due date lands here. Tackle these first — I'll always flag the count on my badge." },
  { to: '/inspections/records', title: 'Records', text: 'Every completed inspection with its score, findings and full responses. Search and filter by site, form or inspector.' },
  { to: '/dashboard', title: "You're all set! 🎉", text: 'That’s the tour! Tap me anytime for help or to ask about your live data — try “what’s overdue?”. Happy inspecting!' },
]

const SKIN = '#e8b48f', SKIN_D = '#c98b62', HAT = '#f4b400', HAT_D = '#c98a00'
const VEST = '#2563eb', VEST_D = '#1e40af', STRIPE = '#fde047', TROUSER = '#1e3a8a', SHOE = '#0b1220'

// ── Safety Manager "Sam": hard hat + hi-vis vest, two-segment arms ───────────
function Character({ mode = 'idle', reduced = false }) {
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
      <div className={`max-w-[85%] whitespace-pre-line rounded-2xl px-3 py-2 text-sm ${mine ? 'bg-brand-600 text-white' : 'bg-clay-100 text-ink-800'}`}>{children}</div>
    </div>
  )
}

export default function Assistant() {
  const location = useLocation()
  const navigate = useNavigate()
  const { templates, activeTemplates, scheduledTasks, overdueTasks, dueTodayTasks, records, sites } = useData()
  const { user } = useAuth()
  const reduced = useReducedMotion()
  const uid = user?.uid || 'anon'

  const [enabled, setEnabled] = useState(() => ls.get(`insp:guide:enabled:${uid}`) !== '0')
  const [open, setOpen] = useState(false)
  const [tip, setTip] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [asking, setAsking] = useState(false)
  const scrollRef = useRef(null)

  const [mode, setMode] = useState('idle')
  const [facing, setFacing] = useState(-1)
  const [asleep, setAsleep] = useState(false)
  const [pinned, setPinned] = useState(() => ls.get(`insp:guide:pinned:${uid}`) === '1')
  const [tour, setTour] = useState(null) // null | { step }

  const savedPos = useMemo(() => { try { return JSON.parse(ls.get(`insp:guide:pos:${uid}`) || 'null') } catch { return null } }, [uid])
  const mx = useMotionValue(savedPos?.x ?? 80)
  const my = useMotionValue(savedPos?.y ?? 0)
  const lastRef = useRef(Date.now())
  const asleepRef = useRef(false)
  useEffect(() => { asleepRef.current = asleep }, [asleep])

  const guide = useMemo(() => pageGuide(location.pathname), [location.pathname])
  const chips = useMemo(() => suggestedQuestions(location.pathname), [location.pathname])
  const overdue = overdueTasks.length
  const ctx = { templates, activeTemplates, scheduledTasks, overdueTasks, dueTodayTasks, records, sites, pathname: location.pathname }
  const writingPage = location.pathname.includes('/forms/new') || location.pathname.includes('/edit')
  const homeX = () => Math.max(20, (typeof window !== 'undefined' ? window.innerWidth : 1000) - 96)

  // Idle → sleep after 3 minutes of no activity; any activity wakes Sam.
  useEffect(() => {
    const bump = () => { lastRef.current = Date.now(); if (asleepRef.current) setAsleep(false) }
    const evs = ['mousemove', 'keydown', 'scroll', 'click', 'touchstart']
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }))
    const iv = setInterval(() => { if (Date.now() - lastRef.current > IDLE_SLEEP_MS) setAsleep(true) }, 15000)
    return () => { evs.forEach((e) => window.removeEventListener(e, bump)); clearInterval(iv) }
  }, [])

  // ── Guided tour (first login) ───────────────────────────────────────────────
  const tourKey = `insp:guide:tour:${uid}`
  const startTour = () => { setOpen(false); setTip(null); setAsleep(false); setTour({ step: 0 }) }
  const nextTourStep = () => setTour((cur) => (cur ? { step: cur.step + 1 } : cur))
  const endTour = () => {
    setTour(null)
    ls.set(tourKey, '1')
    try { sessionStorage.setItem(`insp:guide:greeted:${uid}`, '1') } catch { /* ignore */ }
    lastRef.current = Date.now()
    setMode('idle')
  }

  // Kick off the walkthrough once, on first login for this user.
  useEffect(() => {
    if (!enabled || tour) return undefined
    if (ls.get(tourKey) === '1') return undefined
    const t = setTimeout(() => setTour({ step: 0 }), 1000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, uid])

  // Drive the tour: navigate to each page and walk Sam across the screen.
  useEffect(() => {
    if (!tour) return undefined
    const step = TOUR[tour.step]
    if (!step) { endTour(); return undefined }
    setOpen(false); setTip(null); setAsleep(false)
    if (location.pathname !== step.to) navigate(step.to)
    if (reduced || pinned) { setMode('wave'); return undefined }
    // Walk to a fresh spot so Sam visibly travels across the page each step.
    const from = mx.get()
    const w = typeof window !== 'undefined' ? window.innerWidth : 1000
    const target = tour.step % 2 === 0 ? Math.round(w * 0.16) : Math.round(Math.max(120, w * 0.6))
    setFacing(target >= from ? 1 : -1)
    setMode('walk')
    const anim = animate(mx, target, { duration: 0.9, ease: 'linear' })
    animate(my, 0, { duration: 0.3 })
    const t = setTimeout(() => setMode('wave'), 950)
    return () => { if (anim?.stop) anim.stop(); clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour])

  // Movement / pose state machine.
  useEffect(() => {
    if (!enabled) return undefined
    if (tour) return undefined // the tour drives movement while active
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
  }, [enabled, asleep, open, tip, writingPage, reduced, pinned, tour, mx, my])

  // Login greeting (once per browser session) → then per-page tips.
  useEffect(() => {
    if (!enabled || open || tour) return undefined // tour replaces the greeting/tips while running
    const greetKey = `insp:guide:greeted:${uid}`
    const greeted = (() => { try { return sessionStorage.getItem(greetKey) === '1' } catch { return false } })()
    if (!greeted) {
      const t = setTimeout(() => {
        setTip({ greeting: true, title: 'Hi, I’m Sam!', text: 'Tap me anytime to ask about your forms, schedule, overdue checks and records.' })
        try { sessionStorage.setItem(greetKey, '1') } catch { /* ignore */ }
      }, 1200)
      const t2 = setTimeout(() => setTip((cur) => (cur?.greeting ? null : cur)), 8000) // auto-dismiss greeting
      return () => { clearTimeout(t); clearTimeout(t2) }
    }
    const seenKey = `insp:guide:tip:${uid}:${guide.title}`
    if (ls.get(seenKey) !== '1') { const t = setTimeout(() => setTip({ title: guide.title, text: guide.tips[0] }), 900); return () => clearTimeout(t) }
    return undefined
  }, [location.pathname, open, uid, guide, enabled, tour])

  const dismissTip = () => {
    if (tip && !tip.greeting) ls.set(`insp:guide:tip:${uid}:${guide.title}`, '1')
    setTip(null)
  }
  const openPanel = () => {
    if (tip && !tip.greeting) ls.set(`insp:guide:tip:${uid}:${guide.title}`, '1')
    setTip(null); setOpen(true); lastRef.current = Date.now(); setAsleep(false)
  }
  const onDragEnd = () => {
    const vw = window.innerWidth || 1000
    const vh = window.innerHeight || 800
    mx.set(Math.min(Math.max(mx.get(), 0), vw - 90))
    my.set(Math.min(Math.max(my.get(), -(vh - 170)), 0))
    setPinned(true)
    ls.set(`insp:guide:pinned:${uid}`, '1')
    ls.set(`insp:guide:pos:${uid}`, JSON.stringify({ x: mx.get(), y: my.get() }))
    lastRef.current = Date.now(); setAsleep(false)
  }
  const setRoam = () => { setPinned(false); ls.set(`insp:guide:pinned:${uid}`, '0'); animate(my, 0, { duration: 0.4 }) }
  const disableGuide = () => { setOpen(false); setEnabled(false); ls.set(`insp:guide:enabled:${uid}`, '0') }
  const enableGuide = () => { setEnabled(true); ls.set(`insp:guide:enabled:${uid}`, '1') }

  // Hybrid: instant rule answer if it matched; otherwise fall back to the AI.
  const ask = async (text) => {
    const t = (text || '').trim()
    if (!t || asking) return
    setInput('')
    const rule = answer(t, ctx) // { text, matched, action? }
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

  // Disabled → small restore button only.
  if (!enabled) {
    return (
      <button onClick={enableGuide} className="no-print fixed bottom-4 right-4 z-40 flex items-center gap-1.5 rounded-full bg-brand-600 px-3 py-2 text-xs font-bold text-white shadow-card hover:bg-brand-700" title="Show the Inspection Guide">
        <MessageCircle size={15} /> Guide
      </button>
    )
  }

  const shownMode = asking ? 'think' : open ? 'wave' : asleep ? 'sleep' : mode

  return (
    <div className="no-print">
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
        <button onClick={() => (open ? setOpen(false) : openPanel())} className="relative block" aria-label="Open Inspection Guide">
          {reduced ? (
            <div style={{ transform: `scaleX(${facing})` }}>
              <Character mode={shownMode} reduced />
            </div>
          ) : (
            <AvatarBoundary fallback={<div style={{ transform: `scaleX(${facing})` }}><Character mode={shownMode} reduced={reduced} /></div>}>
              <Suspense fallback={<div style={{ transform: `scaleX(${facing})` }}><Character mode={shownMode} reduced={reduced} /></div>}>
                <Character3D mode={shownMode} size={68} facing={facing} />
              </Suspense>
            </AvatarBoundary>
          )}
          {overdue > 0 && (
            <span className="absolute right-0 top-2 grid h-5 min-w-5 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-extrabold text-white ring-2 ring-white">{overdue}</span>
          )}
        </button>
      </motion.div>

      {/* Guided tour coachmark (first login) */}
      <AnimatePresence mode="wait">
        {tour && !open && TOUR[tour.step] && (
          <motion.div
            key={tour.step}
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96, transition: { duration: 0.12 } }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            className="fixed bottom-28 left-1/2 z-50 -ml-40 w-[20rem] max-w-[calc(100vw-2.5rem)] rounded-2xl border border-brand-200 bg-clay-surface p-4 shadow-card"
          >
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-700">
                <Sparkles size={13} /> Step {tour.step + 1} of {TOUR.length}
              </span>
              <button onClick={endTour} className="text-[11px] font-semibold text-ink-400 hover:text-ink-700">Skip tour</button>
            </div>
            <p className="mt-2 text-sm font-bold text-ink-900">{TOUR[tour.step].title}</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-600">{TOUR[tour.step].text}</p>
            <div className="mt-3 flex items-center justify-between">
              <div className="flex gap-1">
                {TOUR.map((_, i) => (
                  <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === tour.step ? 'bg-brand-600' : 'bg-clay-200'}`} />
                ))}
              </div>
              <button
                onClick={tour.step === TOUR.length - 1 ? endTour : nextTourStep}
                className="btn-primary px-3 py-1.5 text-xs"
              >
                {tour.step === TOUR.length - 1 ? 'Finish' : 'Next'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tip / welcome bubble */}
      <AnimatePresence>
        {tip && !open && !tour && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96, transition: { duration: 0.12 } }}
            transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
            className="fixed bottom-28 right-5 z-40 w-64 rounded-2xl border border-clay-200 bg-clay-surface p-3.5 shadow-card"
          >
            <button onClick={dismissTip} className="absolute right-2 top-2 rounded-lg p-1 text-ink-400 hover:bg-clay-100"><X size={14} /></button>
            <p className="pr-4 text-sm font-bold text-ink-900">{tip.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-600">{tip.text}</p>
            <button onClick={openPanel} className="btn-soft mt-2.5 px-3 py-1.5 text-xs"><Sparkles size={13} /> {tip.welcome ? 'Show me around' : 'Ask Sam'}</button>
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
            className="fixed bottom-32 right-5 z-50 flex max-h-[68vh] w-[360px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-clay-200 bg-clay-surface shadow-card"
          >
            <div className="flex items-center gap-2.5 border-b border-clay-200 bg-brand-600 px-4 py-3 text-white">
              <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-white/15"><Character mode="idle" reduced /></span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold">Sam — Inspection Guide</p>
                <p className="text-[11px] text-white/70">Insights from your live data</p>
              </div>
              <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-white/80 hover:bg-white/15"><X size={16} /></button>
            </div>

            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
              <div className="rounded-2xl bg-brand-50 p-3">
                <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-brand-700"><Lightbulb size={13} /> {guide.title}</p>
                <ul className="mt-1.5 space-y-1 text-xs leading-relaxed text-ink-600">{guide.tips.map((t, i) => <li key={i}>• {t}</li>)}</ul>
              </div>
              {overdue > 0 && <Bubble from="guide">⚠️ You have {overdue} overdue inspection(s). Ask me “what’s overdue?” or open the Overdue page.</Bubble>}
              {messages.map((m, i) => <Bubble key={i} from={m.from}>{m.text}</Bubble>)}
            </div>

            <div className="flex flex-wrap gap-1.5 border-t border-clay-200 px-3 pt-2.5">
              {chips.map((c) => <button key={c} onClick={() => ask(c)} className="chip bg-clay-100 text-ink-600 hover:bg-clay-200">{c}</button>)}
            </div>

            <form onSubmit={(e) => { e.preventDefault(); ask(input) }} className="flex items-center gap-2 px-3 pt-3">
              <input className="input py-2" placeholder={asking ? 'Thinking…' : 'Ask about your inspections…'} value={input} onChange={(e) => setInput(e.target.value)} disabled={asking} />
              <button type="submit" className="btn-primary px-3 py-2" disabled={!input.trim() || asking}><Send size={16} /></button>
            </form>

            {/* Controls: roam/pin + replay tour + hide */}
            <div className="flex items-center justify-between gap-2 px-3 py-2 text-[11px] text-ink-400">
              <button onClick={setRoam} className="inline-flex items-center gap-1 hover:text-ink-700" disabled={!pinned}>
                <Move size={12} /> {pinned ? 'Let Sam roam' : 'Drag Sam to pin him'}
              </button>
              <button onClick={startTour} className="inline-flex items-center gap-1 hover:text-ink-700"><Sparkles size={12} /> Replay tour</button>
              <button onClick={disableGuide} className="inline-flex items-center gap-1 hover:text-ink-700"><EyeOff size={12} /> Hide guide</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

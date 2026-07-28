import { useEffect, useMemo, useRef, useState, lazy, Suspense, Component } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence, useReducedMotion, useMotionValue, animate } from 'framer-motion'
import { X, Send, Sparkles, Lightbulb, Move, EyeOff, MessageCircle, ArrowRight, ArrowLeft, Compass } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { usePermits } from '../context/PermitContext'
import { subscribeObservations } from '../lib/firestore'
import { pageGuide, suggestedQuestions, answer, askAI, buildAIContext } from '../lib/assistant'

// The 3D mascot is heavy (three.js) — load it only when needed. The auto wrapper
// uses a realistic rigged .glb if one is present, else the procedural figure.
const Character3D = lazy(() => import('./Character3DRigged'))

// Falls back to the 2D SVG Sam if WebGL / three fails to load.
class AvatarBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { /* swallow — fallback handles it */ }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

const lsx = {
  get: (k) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } },
}
const loop = (d) => ({ duration: d, repeat: Infinity, ease: 'easeInOut' })
const IDLE_SLEEP_MS = 3 * 60 * 1000

// ── First-login walkthrough ──────────────────────────────────────────────────
// Sam actually navigates the app and spotlights real on-page elements. Each step
// optionally has a `route` (Sam navigates there first) and a `sel` (a data-tour
// target to highlight, polled for after navigation since pages are lazy-loaded).
// `place` steps have no target — Sam stands centre-stage (welcome) or at his home
// corner (finale). If a target never appears, the step degrades to a centred card.
const TOUR_BASE = [
  { place: 'center', title: "Hi, I'm Sam 👷", text: "I'm your safety guide. Let me walk you through Permit to Work — it only takes about 30 seconds." },
  { route: '/dashboard', sel: '[data-tour="dash-kpis"]', title: 'Your KPIs', text: 'These tiles track permits in progress, expiring and not-closed, plus safe vs unsafe observations — your safety pulse at a glance.' },
  { route: '/dashboard', sel: '[data-tour="dash-charts"]', title: 'Charts & insights', text: 'Status, work-type, site and trend charts. Use the Site filter at the top to focus the whole dashboard.' },
  { route: '/permits', sel: '[data-tour="permits-header"]', title: 'Permits', text: 'Every permit with its live status. Filter or search, and scan a permit’s QR on site to log an observation.' },
  { route: '/permits/new', sel: '[data-tour="newpermit-header"]', title: 'Raise a permit', text: 'Start here: pick the work type, complete the JSA, add participants, then send it for Engineering & Operations sign-off.' },
  { route: '/permits/approvals', sel: '[data-tour="approvals-header"]', title: 'Approvals', text: 'Permits awaiting your team’s decision land here — approve or reject each with a note.' },
  { route: '/permits/observations', sel: '[data-tour="observations-header"]', title: 'Observations', text: 'Safe and unsafe observations logged via QR or in-app. An unsafe one closes its permit for non-compliance.' },
]
const TOUR_ADMIN = { route: '/users', sel: '[data-tour="users-header"]', title: 'Users (Admin)', text: 'Approve new sign-ups here and set each person’s role: Engineering, Operations or Technician.' }
const TOUR_FINALE = { route: '/dashboard', place: 'home', title: 'I’m always here', text: 'Tap me anytime to ask things like “what needs my approval?” or “what’s expired?”. Enjoy Permit to Work!' }

// Orange hi-vis "Sam": white/yellow hard hat + orange vest, two-segment arms.
const SKIN = '#e8b48f', SKIN_D = '#c98b62', HAT = '#facc15', HAT_D = '#ca8a04'
const VEST = '#f97316', VEST_D = '#c2410c', STRIPE = '#fde047', TROUSER = '#1e293b', SHOE = '#0b1220'

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
          <rect x="33" y="74" width="6.5" height="32" rx="2.4" fill="#0f172a" />
          <rect x="30.5" y="104" width="11" height="6.5" rx="3" fill={SHOE} />
        </motion.g>

        <rect x="22" y="33" width="20" height="42" rx="6" fill="#f1f5f9" />
        <path d="M23 41h7l2 5 2-5h7v33a3 3 0 0 1-3 3H26a3 3 0 0 1-3-3z" fill={VEST} stroke={VEST_D} strokeWidth="0.8" />
        <rect x="25" y="58" width="14" height="2.6" fill={STRIPE} />
        <rect x="27.5" y="44" width="2.4" height="31" fill={STRIPE} />
        <rect x="34.1" y="44" width="2.4" height="31" fill={STRIPE} />
        <rect x="29" y="29" width="6" height="6" fill={SKIN} />

        <Arm shoulder={[24, 39]} elbow={[24, 54]} upper={uAL} fore={fAL} uT={uALT} fT={fALT} />

        {mode === 'write' && (
          <g transform="rotate(-8 33 60)">
            <rect x="24" y="50" width="19" height="24" rx="2" fill="#e7d2bb" stroke="#c2a888" strokeWidth="0.8" />
            <rect x="26" y="53" width="15" height="19" rx="1" fill="#fff" />
            <rect x="30" y="48.5" width="7" height="3" rx="1" fill="#c2a888" />
            <rect x="28" y="57" width="11" height="1.2" rx="0.6" fill="#e3ccba" />
            <rect x="28" y="61" width="11" height="1.2" rx="0.6" fill="#e3ccba" />
            <rect x="28" y="65" width="8" height="1.2" rx="0.6" fill="#e3ccba" />
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
      <div className={`max-w-[85%] whitespace-pre-line rounded-2xl px-3 py-2 text-sm ${mine ? 'bg-brand-500 text-white' : 'bg-clay-100 text-ink-700'}`}>{children}</div>
    </div>
  )
}

export default function Assistant() {
  const location = useLocation()
  const navigate = useNavigate()
  const { profile, isAdmin } = useAuth()
  const { permits, users, sites, approvalQueue } = usePermits()
  const reduced = useReducedMotion()
  const uid = profile?.uid || 'anon'

  const [observations, setObservations] = useState([])
  useEffect(() => {
    if (!profile?.orgId) return undefined
    return subscribeObservations(profile.orgId, setObservations)
  }, [profile?.orgId])

  const [enabled, setEnabled] = useState(() => lsx.get(`ptw:bot:enabled:${uid}`) !== '0')
  const [open, setOpen] = useState(false)
  const [tip, setTip] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [asking, setAsking] = useState(false)
  const scrollRef = useRef(null)

  const [mode, setMode] = useState('idle')
  const [facing, setFacing] = useState(-1)
  const [asleep, setAsleep] = useState(false)
  const [pinned, setPinned] = useState(() => lsx.get(`ptw:bot:pinned:${uid}`) === '1')

  // Guided first-login tour.
  const [tour, setTour] = useState(null) // null | { step }
  const [tourRect, setTourRect] = useState(null) // highlighted target's screen rect
  const tourSteps = useMemo(() => [...TOUR_BASE, ...(isAdmin ? [TOUR_ADMIN] : []), TOUR_FINALE], [isAdmin])
  const tourStartedRef = useRef(false)

  const savedPos = useMemo(() => { try { return JSON.parse(lsx.get(`ptw:bot:pos:${uid}`) || 'null') } catch { return null } }, [uid])
  const mx = useMotionValue(savedPos?.x ?? 80)
  const my = useMotionValue(savedPos?.y ?? 0)
  const lastRef = useRef(Date.now())
  const asleepRef = useRef(false)
  const greetedRef = useRef(false)
  useEffect(() => { asleepRef.current = asleep }, [asleep])

  const guide = useMemo(() => pageGuide(location.pathname), [location.pathname])
  const chips = useMemo(() => suggestedQuestions(location.pathname), [location.pathname])
  const attention = approvalQueue.length
  const ctx = { permits, observations, users, sites, approvalQueue, profile, pathname: location.pathname }
  const writingPage = location.pathname.includes('/permits/new')
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
    if (tour) return undefined // the tour drives Sam's position/pose
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
  }, [enabled, tour, asleep, open, tip, writingPage, reduced, pinned, mx, my])

  // Greeting (once per page load) → then per-page tips.
  useEffect(() => {
    if (!enabled || open) return undefined
    // While the first-run tour is pending or playing, it owns the stage — no
    // greeting or page tips until the user has finished (or skipped) it.
    if (tour || lsx.get(`ptw:bot:tour:${uid}`) !== '1') return undefined
    if (!greetedRef.current) {
      greetedRef.current = true
      const t = setTimeout(() => {
        setTip({ greeting: true, title: "Hi, I'm Sam 👷", text: 'Tap me anytime to ask about your permits, approvals, expiries and observations.' })
      }, 1200)
      const t2 = setTimeout(() => setTip((cur) => (cur?.greeting ? null : cur)), 9000)
      return () => { clearTimeout(t); clearTimeout(t2) }
    }
    const seenKey = `ptw:bot:tip:${uid}:${guide.title}`
    if (lsx.get(seenKey) !== '1') { const t = setTimeout(() => setTip({ title: guide.title, text: guide.tips[0] }), 900); return () => clearTimeout(t) }
    return undefined
  }, [location.pathname, open, uid, guide, enabled, tour])

  // Auto-start the walkthrough once, on a user's very first visit.
  const tourKey = `ptw:bot:tour:${uid}`
  useEffect(() => {
    if (!enabled || tourStartedRef.current || !profile) return undefined
    if (lsx.get(tourKey) === '1') return undefined
    tourStartedRef.current = true
    const t = setTimeout(() => { setOpen(false); setTip(null); setTour({ step: 0 }) }, 1100)
    return () => clearTimeout(t)
  }, [enabled, profile, uid, tourKey])

  // Drive the tour: navigate to the step's page, then poll for its on-page target
  // (pages are lazy-loaded), spotlight it and move Sam beside the bubble.
  useEffect(() => {
    if (!tour) return undefined
    const stepDef = tourSteps[tour.step]
    let cancelled = false
    let pollT
    const needsNav = stepDef?.route && window.location.pathname !== stepDef.route
    if (needsNav) navigate(stepDef.route)
    setMode('walk'); setTourRect(null)
    lastRef.current = Date.now(); setAsleep(false)

    const clampY = (y, vh) => Math.min(0, Math.max(-(vh - 170), y))
    const place = () => {
      const vw = window.innerWidth || 1000
      const vh = window.innerHeight || 800
      if (stepDef?.sel) {
        const el = document.querySelector(stepDef.sel)
        const r = el?.getBoundingClientRect()
        if (!r || r.width === 0 || r.height === 0) return false // not mounted yet
        setTourRect(r)
        const below = r.bottom + 188 < vh
        const bTop = below ? r.bottom + 14 : Math.max(12, r.top - 196)
        const bLeft = Math.min(Math.max(r.left, 16), vw - 300)
        setFacing(1)
        animate(mx, Math.max(8, bLeft - 84), { duration: 0.6, ease: 'easeInOut' })
        animate(my, clampY(bTop + 80 - vh + 62, vh), { duration: 0.6, ease: 'easeInOut' })
        return true
      }
      setTourRect(null)
      if (stepDef?.place === 'home') {
        setFacing(-1); animate(mx, homeX(), { duration: 0.6, ease: 'easeInOut' }); animate(my, 0, { duration: 0.5, ease: 'easeInOut' })
      } else {
        setFacing(1); animate(mx, vw / 2 - 40, { duration: 0.7, ease: 'easeInOut' }); animate(my, clampY(-(vh / 2 - 90), vh), { duration: 0.7, ease: 'easeInOut' })
      }
      return true
    }

    let tries = 0
    const tick = () => {
      if (cancelled) return
      if (place() || tries++ >= 32) { setTimeout(() => !cancelled && setMode('wave'), 350); return }
      pollT = setTimeout(tick, 110)
    }
    pollT = setTimeout(tick, needsNav ? 240 : 40)

    const onResize = () => !cancelled && place()
    window.addEventListener('resize', onResize)
    return () => { cancelled = true; clearTimeout(pollT); window.removeEventListener('resize', onResize) }
  }, [tour, tourSteps, navigate, mx, my])

  // Tour controls.
  const endTour = () => { lsx.set(tourKey, '1'); setTour(null); setTourRect(null); setMode('idle') }
  const nextTour = () => { if (tour && tour.step < tourSteps.length - 1) setTour({ step: tour.step + 1 }); else endTour() }
  const backTour = () => { if (tour && tour.step > 0) setTour({ step: tour.step - 1 }) }
  const startTour = () => { setOpen(false); setTip(null); setPinned(false); setTour({ step: 0 }) }

  const dismissTip = () => {
    if (tip && !tip.greeting) lsx.set(`ptw:bot:tip:${uid}:${guide.title}`, '1')
    setTip(null)
  }
  const openPanel = () => {
    if (tip && !tip.greeting) lsx.set(`ptw:bot:tip:${uid}:${guide.title}`, '1')
    setTip(null); setOpen(true); lastRef.current = Date.now(); setAsleep(false)
  }
  const onDragEnd = () => {
    const vw = window.innerWidth || 1000
    const vh = window.innerHeight || 800
    mx.set(Math.min(Math.max(mx.get(), 0), vw - 90))
    my.set(Math.min(Math.max(my.get(), -(vh - 170)), 0))
    setPinned(true)
    lsx.set(`ptw:bot:pinned:${uid}`, '1')
    lsx.set(`ptw:bot:pos:${uid}`, JSON.stringify({ x: mx.get(), y: my.get() }))
    lastRef.current = Date.now(); setAsleep(false)
  }
  const setRoam = () => { setPinned(false); lsx.set(`ptw:bot:pinned:${uid}`, '0'); animate(my, 0, { duration: 0.4 }) }
  const disableGuide = () => { setOpen(false); setEnabled(false); lsx.set(`ptw:bot:enabled:${uid}`, '0') }
  const enableGuide = () => { setEnabled(true); lsx.set(`ptw:bot:enabled:${uid}`, '1') }

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

  // Disabled → small restore button only.
  if (!enabled) {
    return (
      <button onClick={enableGuide} className="no-print fixed bottom-4 right-4 z-40 flex items-center gap-1.5 rounded-full bg-brand-500 px-3 py-2 text-xs font-bold text-white shadow-clay hover:bg-brand-600" title="Show the Safety Bot">
        <MessageCircle size={15} /> Safety Bot
      </button>
    )
  }

  const shownMode = asking ? 'think' : tour ? mode : open ? 'wave' : asleep ? 'sleep' : mode

  return (
    <div className="no-print">
      {/* Draggable walking character (drag disabled & lifted above the dim during the tour) */}
      <motion.div
        className={`fixed bottom-1 left-0 cursor-grab active:cursor-grabbing ${tour ? 'z-50' : 'z-40'}`}
        style={{ x: mx, y: my }}
        drag={!tour}
        dragMomentum={false}
        dragElastic={0.04}
        onDragStart={() => { setMode('idle'); lastRef.current = Date.now(); setAsleep(false) }}
        onDragEnd={onDragEnd}
      >
        <button onClick={() => { if (tour) return; open ? setOpen(false) : openPanel() }} className="relative block" aria-label="Open Safety Bot">
          {reduced ? (
            // 2D drawing: flip horizontally to face the walking direction.
            <div style={{ transform: `scaleX(${facing})` }}>
              <Character mode={shownMode} reduced />
            </div>
          ) : (
            // 3D model: it turns itself toward `facing` — never mirror the canvas.
            <AvatarBoundary fallback={<div style={{ transform: `scaleX(${facing})` }}><Character mode={shownMode} reduced={reduced} /></div>}>
              <Suspense fallback={<div style={{ transform: `scaleX(${facing})` }}><Character mode={shownMode} reduced={reduced} /></div>}>
                <Character3D mode={shownMode} size={68} facing={facing} />
              </Suspense>
            </AvatarBoundary>
          )}
          {attention > 0 && (
            <span className="absolute right-0 top-2 grid h-5 min-w-5 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-extrabold text-white ring-2 ring-clay-bg">{attention}</span>
          )}
        </button>
      </motion.div>

      {/* First-login guided tour: dim/spotlight + Sam-led explanation bubble */}
      <AnimatePresence>
        {tour && (() => {
          const stepDef = tourSteps[tour.step]
          const isLast = tour.step === tourSteps.length - 1
          const vw = typeof window !== 'undefined' ? window.innerWidth : 1000
          const vh = typeof window !== 'undefined' ? window.innerHeight : 800
          const bubble = tourRect
            ? {
                left: Math.min(Math.max(tourRect.left, 16), vw - 300),
                top: tourRect.bottom + 188 < vh ? tourRect.bottom + 14 : Math.max(12, tourRect.top - 196),
              }
            : stepDef.place === 'home'
              ? { right: 20, bottom: 184 }
              : { left: Math.max(12, vw / 2 - 144), top: vh / 2 + 76 }
          return (
            <motion.div key="tour" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-40">
              {/* Click blocker so the tour stays in control */}
              <div className="absolute inset-0" />
              {/* Spotlight on the target, or a flat dim for placed steps */}
              {tourRect ? (
                <motion.div
                  layout
                  className="pointer-events-none absolute rounded-xl ring-2 ring-brand-400"
                  style={{
                    top: tourRect.top - 6, left: tourRect.left - 6,
                    width: tourRect.width + 12, height: tourRect.height + 12,
                    boxShadow: '0 0 0 9999px rgba(15,23,42,0.6)',
                  }}
                />
              ) : (
                <div className="pointer-events-none absolute inset-0 bg-ink-950/55" />
              )}
              {/* Explanation bubble */}
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                style={bubble}
                className="absolute w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-clay-200 bg-clay-surface p-4 shadow-clay"
              >
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-600"><Compass size={13} /> Tour · {tour.step + 1}/{tourSteps.length}</span>
                  <button onClick={endTour} className="rounded-lg p-1 text-ink-400 hover:bg-clay-100" aria-label="Skip tour"><X size={14} /></button>
                </div>
                <p className="mt-1.5 text-sm font-extrabold text-ink-900">{stepDef.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-ink-500">{stepDef.text}</p>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <button onClick={endTour} className="text-xs font-semibold text-ink-400 hover:text-ink-700">Skip</button>
                  <div className="flex items-center gap-2">
                    {tour.step > 0 && (
                      <button onClick={backTour} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-ink-600 hover:bg-clay-100 hover:text-ink-900"><ArrowLeft size={13} /> Back</button>
                    )}
                    <button onClick={nextTour} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-600">
                      {isLast ? 'Got it' : (<>Next <ArrowRight size={13} /></>)}
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )
        })()}
      </AnimatePresence>

      {/* Tip / welcome bubble */}
      <AnimatePresence>
        {tip && !open && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96, transition: { duration: 0.12 } }}
            transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
            className="fixed bottom-28 right-5 z-40 w-64 rounded-2xl border border-clay-200 bg-clay-surface p-3.5 shadow-clay"
          >
            <button onClick={dismissTip} className="absolute right-2 top-2 rounded-lg p-1 text-ink-400 hover:bg-clay-100"><X size={15} /></button>
            <p className="pr-4 text-sm font-bold text-ink-900">{tip.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-500">{tip.text}</p>
            <button onClick={openPanel} className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-600"><Sparkles size={13} /> Ask Sam</button>
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
            className="fixed bottom-32 right-5 z-50 flex max-h-[68vh] w-[360px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-clay-200 bg-clay-surface shadow-clay"
          >
            <div className="flex items-center gap-2.5 bg-brand-500 px-4 py-3 text-white">
              <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-white/20"><Character mode="idle" reduced /></span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold">Sam — Safety Bot</p>
                <p className="text-[11px] text-white/75">Permit insights from your live data</p>
              </div>
              <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-white/80 hover:bg-black/10"><X size={15} /></button>
            </div>

            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
              <div className="rounded-2xl bg-brand-50 p-3">
                <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-brand-700"><Lightbulb size={13} /> {guide.title}</p>
                <ul className="mt-1.5 space-y-1 text-xs leading-relaxed text-ink-500">{guide.tips.map((t, i) => <li key={i}>• {t}</li>)}</ul>
              </div>
              {attention > 0 && <Bubble from="guide">⚠️ {attention} permit(s) awaiting your approval. Ask “what needs my approval?” or open Approvals.</Bubble>}
              {messages.map((m, i) => <Bubble key={i} from={m.from}>{m.text}</Bubble>)}
            </div>

            <div className="flex flex-wrap gap-1.5 border-t border-clay-200/70 px-3 pt-2.5">
              {chips.map((c) => <button key={c} onClick={() => ask(c)} className="rounded-full bg-clay-100 px-2.5 py-1 text-xs font-medium text-ink-600 transition-colors hover:bg-clay-200 hover:text-ink-900">{c}</button>)}
            </div>

            <form onSubmit={(e) => { e.preventDefault(); ask(input) }} className="flex items-center gap-2 px-3 py-3">
              <input
                className="flex-1 rounded-xl bg-clay-surface px-3 py-2 text-sm text-ink-900 shadow-clay-inset outline-none ring-2 ring-transparent transition-[box-shadow] duration-150 ease-out-expo focus:ring-brand-200"
                placeholder={asking ? 'Thinking…' : 'Ask about your permits…'}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={asking}
              />
              <button type="submit" className="rounded-xl bg-brand-500 px-3 py-2 text-white shadow-clay-sm hover:bg-brand-600 disabled:opacity-50" disabled={!input.trim() || asking}><Send size={16} /></button>
            </form>

            <div className="flex items-center justify-between gap-2 border-t border-clay-200/70 px-3 py-2 text-[11px] text-ink-400">
              <button onClick={setRoam} className="inline-flex items-center gap-1 hover:text-ink-700" disabled={!pinned}>
                <Move size={12} /> {pinned ? 'Let Sam roam' : 'Drag Sam to pin him'}
              </button>
              <button onClick={startTour} className="inline-flex items-center gap-1 hover:text-ink-700"><Compass size={12} /> Replay tour</button>
              <button onClick={disableGuide} className="inline-flex items-center gap-1 hover:text-ink-700"><EyeOff size={12} /> Hide bot</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

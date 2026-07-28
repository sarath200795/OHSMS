import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTutorial } from '../context/TutorialContext'
import { Character } from './Assistant'

// Use the real 3D Sam during the tour (matching the roaming assistant); fall
// back to the lightweight 2D Sam while the three.js chunk loads.
const Character3D = lazy(() => import('./Character3D'))

const SAM_W = 80
const SAM_H = 108
const DONE_KEY = 'hecp:tutorialDone'

// Build the ordered tour steps from the user's permissions, so every targeted
// step points at a sidebar item that actually exists for this user.
function buildSteps({ can, isAdmin, PERMISSIONS }) {
  const steps = [
    {
      id: 'welcome',
      center: true,
      route: '/loto',
      title: "Hi, I'm Sam 👷",
      text: "Welcome aboard! Let me give you a quick 30-second tour of your safety portal.",
    },
    {
      id: 'nav-dashboard',
      target: 'nav-dashboard',
      route: '/loto',
      title: 'Your Dashboard',
      text: 'This is home base — a live overview of your LOTO activity and anything needing attention.',
    },
  ]
  if (can(PERMISSIONS.LOTO_PERFORM)) {
    steps.push({
      id: 'nav-operations',
      target: 'nav-operations',
      route: '/loto/operations',
      title: 'LOTO Operations',
      text: 'Start and manage lock-out / tag-out operations — apply and remove your locks here.',
    })
  }
  if (can(PERMISSIONS.PROCEDURE_VIEW)) {
    steps.push({
      id: 'nav-inventory',
      target: 'nav-inventory',
      route: '/loto/inventory',
      title: 'Procedure Inventory',
      text: 'Browse every LOTO procedure in your organization, with steps, energy sources and QR tags.',
    })
    steps.push({
      id: 'nav-register',
      target: 'nav-register',
      route: '/loto/register',
      title: 'LOTO Register',
      text: "The live, color-coded register shows exactly what's locked out right now.",
    })
  }
  if (can(PERMISSIONS.PROCEDURE_CREATE)) {
    steps.push({
      id: 'nav-create',
      target: 'nav-create',
      title: 'Create a Procedure',
      text: 'Build a brand-new LOTO procedure here — add isolation points, photos and generate QR codes.',
    })
  }
  if (isAdmin) {
    steps.push({
      id: 'nav-approvals',
      target: 'nav-approvals',
      route: '/loto/approvals',
      title: 'Approvals',
      text: 'New teammates land here for you to approve and assign a role.',
    })
    steps.push({
      id: 'nav-users',
      target: 'nav-users',
      route: '/loto/users',
      title: 'Team & Permissions',
      text: 'Manage roles and fine-grained permissions for everyone in your org.',
    })
  }
  steps.push({
    id: 'finish',
    center: true,
    route: '/loto',
    title: "You're all set!",
    text: 'That’s the tour. Tap me any time at the bottom-left if you need a hand. Stay safe out there!',
  })
  return steps
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

export default function Tutorial() {
  const { profile, isApproved, can, isAdmin, PERMISSIONS, completeTutorial } = useAuth()
  const { setActive, startSignal } = useTutorial()
  const location = useLocation()
  const navigate = useNavigate()

  const [running, setRunning] = useState(false)
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState(null)
  const [walking, setWalking] = useState(false)
  const lastPosRef = useRef({ x: 0, y: 0 })
  const startedSignalRef = useRef(0)

  const steps = useMemo(
    () => buildSteps({ can, isAdmin, PERMISSIONS }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profile?.role, profile?.permissions, isAdmin],
  )
  const step = steps[index]

  // Decide whether to start the tour (desktop, approved, not yet completed).
  useEffect(() => {
    if (running) return
    if (!isApproved || !profile) return
    if (!location.pathname.startsWith('/loto')) return
    if (typeof window === 'undefined' || window.innerWidth < 1024) return
    let done = profile.tutorialCompleted === true
    try {
      done = done || localStorage.getItem(DONE_KEY) === '1'
    } catch {
      /* ignore */
    }
    if (done) return
    const t = setTimeout(() => {
      setIndex(0)
      setRunning(true)
      setActive(true)
    }, 900)
    return () => clearTimeout(t)
  }, [running, isApproved, profile, location.pathname, setActive])

  // Manual replay: a "Take a tour" button bumps startSignal — start regardless
  // of whether the tour was already completed.
  useEffect(() => {
    if (startSignal > 0 && startSignal !== startedSignalRef.current) {
      startedSignalRef.current = startSignal
      setIndex(0)
      setRunning(true)
      setActive(true)
    }
  }, [startSignal, setActive])

  // Walk the user THROUGH the app: navigate to each step's route so they see
  // the section Sam is describing (the sidebar highlight stays put).
  useEffect(() => {
    if (!running || !step?.route) return
    if (location.pathname !== step.route) navigate(step.route)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, index])

  // Measure the current target element (and keep it in sync on scroll/resize).
  useLayoutEffect(() => {
    if (!running || !step || step.center || !step.target) {
      setRect(null)
      return undefined
    }
    function measure() {
      const el = document.querySelector(`[data-tour="${step.target}"]`)
      if (el) {
        const r = el.getBoundingClientRect()
        if (r.width > 0 && r.height > 0) {
          setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
          return
        }
      }
      setRect(null) // target missing/hidden → fall back to a centered card
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [running, step])

  // Brief "walk" animation whenever Sam moves to a new step.
  useEffect(() => {
    if (!running) return undefined
    setWalking(true)
    const t = setTimeout(() => setWalking(false), 1600)
    return () => clearTimeout(t)
  }, [index, running])

  if (!running || !step) return null

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const centered = step.center || !rect

  // Where Sam stands, and where the tooltip card sits relative to him.
  let samX
  let samY
  let card // { left, top, align }
  if (centered) {
    samX = vw / 2 - SAM_W / 2
    samY = vh / 2 - SAM_H - 10
    card = { left: clamp(vw / 2 - 170, 16, vw - 356), top: vh / 2 + 16, arrow: 'none' }
  } else {
    samX = clamp(rect.left + rect.width + 18, 16, vw - SAM_W - 360)
    samY = clamp(rect.top + rect.height / 2 - SAM_H / 2, 12, vh - SAM_H - 12)
    card = {
      left: clamp(samX + SAM_W + 12, 16, vw - 356),
      top: clamp(samY - 8, 12, vh - 200),
      arrow: 'left',
    }
  }

  // Walk duration scales with distance so Sam appears to actually walk over,
  // not teleport. Facing follows the horizontal travel direction.
  const last = lastPosRef.current
  const dist = Math.hypot(samX - last.x, samY - last.y)
  const walkDur = clamp(dist / 320, 0.5, 1.6)
  const facing = Math.abs(samX - last.x) > 6 ? (samX >= last.x ? 1 : -1) : centered ? 1 : -1
  lastPosRef.current = { x: samX, y: samY }

  const isFirst = index === 0
  const isLast = index === steps.length - 1

  function finish() {
    setRunning(false)
    setActive(false)
    completeTutorial()
  }
  function next() {
    if (isLast) finish()
    else setIndex((i) => i + 1)
  }
  function back() {
    setIndex((i) => Math.max(0, i - 1))
  }

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label="Guided tour">
      {/* Dimming backdrop — captures clicks so the app underneath isn't usable mid-tour. */}
      {centered ? (
        <div className="absolute inset-0 bg-ink/55" />
      ) : (
        // Transparent layer blocks interaction with the app while the
        // spotlight's box-shadow dims everything except the target hole.
        <div className="absolute inset-0" />
      )}
      {!centered && (
        <motion.div
          className="absolute rounded-xl ring-2 ring-hazard"
          initial={false}
          animate={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
          }}
          transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
          style={{ boxShadow: '0 0 0 9999px rgba(29,27,23,0.55)' }}
        />
      )}

      {/* Sam walks to the spot — the real 3D Sam, with a 2D fallback on load. */}
      <motion.div
        className="absolute"
        initial={false}
        animate={{ x: samX, y: samY }}
        transition={{ duration: walkDur, ease: [0.23, 1, 0.32, 1] }}
        style={{ width: SAM_W, height: SAM_H, top: 0, left: 0 }}
      >
        <Suspense
          fallback={
            <div style={{ transform: `scaleX(${facing})` }}>
              <Character mode={walking ? 'walk' : 'wave'} />
            </div>
          }
        >
          <Character3D mode={walking ? 'walk' : 'wave'} size={SAM_W} facing={facing} />
        </Suspense>
      </motion.div>

      {/* Tooltip / step card. */}
      <AnimatePresence mode="wait">
        <motion.div
          key={step.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
          className="absolute w-[340px] max-w-[calc(100vw-2rem)] rounded-2xl border border-steel-700 bg-claySurface p-4 shadow-clay"
          style={{ left: card.left, top: card.top }}
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-extrabold tracking-tight text-steel-50">{step.title}</h3>
            <span className="text-[11px] font-semibold text-steel-400">
              {index + 1} / {steps.length}
            </span>
          </div>
          <p className="mt-1.5 text-sm text-steel-300">{step.text}</p>

          {/* progress dots */}
          <div className="mt-3 flex items-center gap-1">
            {steps.map((s, i) => (
              <span
                key={s.id}
                className={`h-1.5 rounded-full transition-all ${
                  i === index ? 'w-4 bg-hazard' : 'w-1.5 bg-steel-700'
                }`}
              />
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between">
            <button
              onClick={finish}
              className="text-xs font-medium text-steel-400 hover:text-danger"
            >
              Skip tour
            </button>
            <div className="flex items-center gap-2">
              {!isFirst && (
                <button
                  onClick={back}
                  className="rounded-xl px-3 py-1.5 text-sm font-semibold text-steel-300 hover:bg-steel-800"
                >
                  Back
                </button>
              )}
              <button
                onClick={next}
                className="rounded-xl bg-hazard px-4 py-1.5 text-sm font-bold text-ink shadow-clay hover:bg-hazard-dark"
              >
                {isLast ? 'Finish' : 'Next'}
              </button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

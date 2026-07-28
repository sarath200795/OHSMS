import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, Send, Move, EyeOff, ArrowRight, Compass } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { subscribeAuditFindings, subscribeAuditPlans } from '../services/auditModule'

/* ── Sam: a roaming voxel audit officer that answers questions about the
 *    live audit data. Modeled on the EHS suite's "Sam — Safety Bot",
 *    recoloured blue for the Internal Audit portal. ── */

function Officer({ className = '' }) {
  // Sam — safety officer matched to the Fire Marshal mascot: open red hi-vis
  // vest with reflective straps, clipboard in one hand, red rod in the other.
  return (
    <svg viewBox="0 0 96 134" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="sam-vest" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ef4444" />
          <stop offset="1" stopColor="#cc2222" />
        </linearGradient>
        <linearGradient id="sam-hair" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f7cf5b" />
          <stop offset="1" stopColor="#dca62b" />
        </linearGradient>
      </defs>
      <ellipse cx="48" cy="127" rx="22" ry="4.2" fill="rgba(15,23,42,0.16)" />

      {/* legs (swing while walking) — slight gap */}
      <g className="sam-leg sam-leg-l">
        <rect x="38" y="95" width="9" height="27" rx="2" fill="#1e2a4a" />
        <rect x="37" y="118" width="11" height="6" rx="2" fill="#0f1b33" />
      </g>
      <g className="sam-leg sam-leg-r">
        <rect x="50" y="95" width="9" height="27" rx="2" fill="#1e2a4a" />
        <rect x="49" y="118" width="11" height="6" rx="2" fill="#0f1b33" />
      </g>

      {/* red rod held in the right hand */}
      <rect x="66.5" y="66" width="3.8" height="52" rx="1.9" fill="#e23b3b" />
      <rect x="65.6" y="66" width="5.6" height="3" rx="1.5" fill="#b91c1c" />

      {/* arms (dark sleeves) + skin hands */}
      <rect x="24" y="60" width="8" height="22" rx="3" fill="#16233f" />
      <rect x="24" y="80" width="8" height="7" rx="2.5" fill="#f0c89c" />
      <rect x="64" y="60" width="8" height="22" rx="3" fill="#16233f" />
      <rect x="64" y="80" width="8" height="7" rx="2.5" fill="#f0c89c" />

      {/* dark shirt (shows through the open vest) */}
      <rect x="32" y="57" width="32" height="42" rx="5" fill="#16233f" />

      {/* open red vest: two panels + shoulder straps */}
      <rect x="36" y="55" width="7" height="8" rx="2" fill="url(#sam-vest)" />
      <rect x="53" y="55" width="7" height="8" rx="2" fill="url(#sam-vest)" />
      <rect x="32.5" y="58" width="12.5" height="37" rx="2.5" fill="url(#sam-vest)" />
      <rect x="51" y="58" width="12.5" height="37" rx="2.5" fill="url(#sam-vest)" />
      {/* reflective stripe on each panel */}
      <rect x="37.5" y="61" width="3.4" height="31" rx="1" fill="#e8eef0" opacity="0.95" />
      <rect x="55.1" y="61" width="3.4" height="31" rx="1" fill="#e8eef0" opacity="0.95" />

      {/* clipboard in the left hand */}
      <rect x="13" y="66" width="15" height="19" rx="2" fill="#fff" stroke="#cbd5e1" strokeWidth="1.2" />
      <rect x="17.5" y="64" width="6" height="3.4" rx="1.5" fill="#94a3b8" />
      <rect x="15.5" y="71" width="10" height="1.8" rx="0.9" fill="#cbd5e1" />
      <rect x="15.5" y="75" width="10" height="1.8" rx="0.9" fill="#cbd5e1" />
      <rect x="15.5" y="79" width="7" height="1.8" rx="0.9" fill="#dc2626" />

      {/* head */}
      <rect x="33" y="28" width="30" height="28" rx="7" fill="#f0c89c" />
      <rect x="30" y="39" width="4" height="8" rx="2" fill="#e6b485" />
      <rect x="62" y="39" width="4" height="8" rx="2" fill="#e6b485" />
      {/* fuller blonde hair */}
      <rect x="29" y="18" width="38" height="16" rx="8" fill="url(#sam-hair)" />
      <rect x="33" y="29" width="30" height="6" rx="2" fill="url(#sam-hair)" />
      <rect x="29" y="26" width="5" height="11" rx="2" fill="url(#sam-hair)" />
      <rect x="62" y="26" width="5" height="11" rx="2" fill="url(#sam-hair)" />
      {/* worried brows */}
      <rect x="39.5" y="38.5" width="5" height="1.7" rx="0.8" fill="#9a6b2e" transform="rotate(-8 42 39)" />
      <rect x="51.5" y="38.5" width="5" height="1.7" rx="0.8" fill="#9a6b2e" transform="rotate(8 54 39)" />
      {/* eyes + slight frown */}
      <circle cx="42" cy="43" r="1.9" fill="#26303f" />
      <circle cx="54" cy="43" r="1.9" fill="#26303f" />
      <rect x="44.5" y="49.5" width="7" height="1.9" rx="0.95" fill="#b87651" />
    </svg>
  )
}

const QUICK = [
  ['Today’s status', 'status'],
  ['What needs attention?', 'attention'],
  ['How many open findings?', 'findings'],
  ['Give me a summary', 'summary'],
]

function sample(arr, key) {
  const ids = arr.map((x) => x[key]).filter(Boolean)
  if (!ids.length) return ''
  if (ids.length <= 2) return ids.join(', ')
  return `${ids[0]}, ${ids[1]} and ${ids.length - 2} more`
}

export default function HelpAssistant() {
  const { profile, org, firebaseUser } = useAuth()
  const navigate = useNavigate()
  const [records, setRecords] = useState([])
  const [plans, setPlans] = useState([])

  const [open, setOpen] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [roaming, setRoaming] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState(false)

  // first-login guided tour
  const [tour, setTour] = useState({ active: false, step: 0 })
  const [tourTarget, setTourTarget] = useState(null)
  const [tourWalk, setTourWalk] = useState(false)
  const [bubbleAt, setBubbleAt] = useState(null)

  const charRef = useRef(null)
  const scrollRef = useRef(null)
  const drag = useRef({ startX: 0, offsetX: 0, offsetY: 0, moved: false })
  const roam = useRef({
    x: typeof window !== 'undefined' ? window.innerWidth - 88 : 0,
    y: typeof window !== 'undefined' ? window.innerHeight - 100 : 0,
    dir: -1,
  })

  useEffect(() => {
    if (!org?.id) return undefined
    const a = subscribeAuditFindings(org.id, setRecords)
    const b = subscribeAuditPlans(org.id, setPlans)
    return () => { a && a(); b && b() }
  }, [org?.id])

  const firstName = profile?.name?.split(' ')[0] || 'there'

  const stats = useMemo(() => {
    const all = []
    records.forEach((r) => (r.findings || []).forEach((f) => all.push({ ...f, _status: r.status })))
    const openF = all.filter((f) => f._status !== 'Closed')
    const byType = (t) => openF.filter((f) => f.type === t).length
    const pendingResp = all.filter((f) => f._status === 'Reported' && f.response?.status !== 'Completed')
    const now = Date.now()
    const overdueCapa = all.filter(
      (f) => f.response?.status === 'Completed' && f._status !== 'Closed' && f.response.targetDate && new Date(f.response.targetDate).getTime() < now,
    )
    const doneKeys = new Set(records.map((r) => `${r.taskDetails?.planId}_${r.taskDetails?.area}_${r.taskDetails?.auditee}`))
    let plannedPending = 0
    plans.forEach((p) => (p.matrix || []).forEach((row) => {
      if (!doneKeys.has(`${p.docId}_${row.area}_${row.auditee}`)) plannedPending++
    }))
    const closureRate = all.length ? Math.round((all.filter((f) => f._status === 'Closed').length / all.length) * 100) : 0
    return {
      all, openF, byType, pendingResp, overdueCapa, plannedPending, closureRate,
      total: records.length,
      reported: records.filter((r) => r.status === 'Reported').length,
      inVerif: records.filter((r) => r.status === 'Submitted for Verification').length,
      closed: records.filter((r) => r.status === 'Closed').length,
    }
  }, [records, plans])

  const attentionCount = stats.openF.length + stats.plannedPending

  function answer(intent) {
    const s = stats
    if (intent === 'status')
      return `Across the program: ${s.total} audit${s.total === 1 ? '' : 's'} — ${s.reported} reported, ${s.inVerif} in verification, ${s.closed} closed. There ${s.openF.length === 1 ? 'is' : 'are'} ${s.openF.length} open finding${s.openF.length === 1 ? '' : 's'} (closure rate ${s.closureRate}%).`
    if (intent === 'attention') {
      const lines = ['Here’s where to focus:']
      let i = 1
      if (s.openF.length) lines.push(`${i++}) ${s.openF.length} open finding(s) to drive to closure: ${sample(s.openF, 'id')}.`)
      if (s.pendingResp.length) lines.push(`${i++}) ${s.pendingResp.length} finding(s) awaiting an auditee CAPA: ${sample(s.pendingResp, 'id')}.`)
      if (s.overdueCapa.length) lines.push(`${i++}) ${s.overdueCapa.length} CAPA(s) overdue past target date.`)
      if (s.plannedPending) lines.push(`${i++}) ${s.plannedPending} planned audit task(s) not yet executed.`)
      if (lines.length === 1) lines.push('Nothing needs attention right now — all findings are closed. 🎉')
      return lines.join('\n')
    }
    if (intent === 'findings')
      return s.openF.length
        ? `There ${s.openF.length === 1 ? 'is' : 'are'} ${s.openF.length} open finding(s) — ${s.byType('Major NC')} major, ${s.byType('Minor NC')} minor, ${s.byType('Observation') + s.byType('OFI')} observation/OFI. IDs: ${sample(s.openF, 'id')}.`
        : 'No open findings — every finding is closed. 🎉'
    if (intent === 'capa') {
      const withCapa = s.all.filter((f) => f.response?.status === 'Completed').length
      return `${withCapa} corrective action(s) on record. ${s.overdueCapa.length} overdue, ${s.pendingResp.length} finding(s) still awaiting a CAPA from the auditee.`
    }
    if (intent === 'summary')
      return `Summary: ${s.total} audit(s) logged, ${s.openF.length} open finding(s), ${s.overdueCapa.length} overdue CAPA(s), ${s.plannedPending} planned task(s) pending. Closure rate is ${s.closureRate}%.`
    if (intent === 'help')
      return 'I can summarise your audits, tell you what needs attention, count open findings, or track CAPAs. Tap a chip below or just ask.'
    return 'I’m not sure about that one yet. Try “what needs attention?”, “how many open findings?”, or “give me a summary”.'
  }

  function route(text) {
    const q = text.toLowerCase()
    if (/attention|focus|priorit|urgent/.test(q)) return 'attention'
    if (/summary|overview|recap|doing/.test(q)) return 'summary'
    if (/capa|corrective|overdue|remediat/.test(q)) return 'capa'
    if (/finding|nonconform|\bnc\b|observation/.test(q)) return 'findings'
    if (/status|today|progress/.test(q)) return 'status'
    if (/help|how do|what can you|hello|\bhi\b/.test(q)) return 'help'
    return 'default'
  }

  const ask = (label, intent) => {
    const reply = answer(intent)
    setMessages((m) => [...m, { role: 'user', text: label }])
    setTyping(true)
    window.setTimeout(() => {
      setMessages((m) => [...m, { role: 'sam', text: reply }])
      setTyping(false)
    }, 420)
  }

  const send = (e) => {
    e?.preventDefault()
    const text = input.trim()
    if (!text) return
    setInput('')
    ask(text, route(text))
  }

  const openPanel = () => {
    if (messages.length === 0) {
      setMessages([
        { role: 'sam', text: `Hi ${firstName}! I’m Sam, your audit assistant — I read your live audit data.` },
        { role: 'sam', text: `This hub runs the ISO 45001 lifecycle: plan in the Scheduler, raise findings in the Auditor Workplace, respond with CAPA in the Auditee Workplace, then verify in Reports.` },
        { role: 'sam', text: attentionCount ? `🔎 ${attentionCount} item(s) need attention. Ask me “what needs attention?”.` : 'Everything looks clear right now. 🎉' },
      ])
    }
    setOpen(true)
  }

  // autoscroll chat
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, typing, open])

  const apply = () => {
    const el = charRef.current
    if (el) {
      el.style.left = `${roam.current.x}px`
      el.style.top = `${roam.current.y}px`
    }
  }

  const dock = () => {
    roam.current.x = window.innerWidth - 88
    roam.current.y = window.innerHeight - 100
    apply()
    const inner = charRef.current?.firstChild
    if (inner) inner.style.transform = ''
  }

  // initial dock (bottom-right)
  useEffect(() => {
    dock()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Each step opens the relevant tab/page (route + module view), then Sam walks
  // to it and explains the detail — like the Fire Marshal / Incident IRA tours.
  const STEPS = [
    { route: '/', view: 'hub', sel: null, title: `Hi ${firstName}! 👋`, body: "I'm Sam — let me open each part of the portal and show you what it does." },
    { route: '/', view: 'scheduler', sel: '[data-tour="stage"]', title: 'Scheduler', body: 'Plan an audit: pick a site, set the dates, assign a lead auditor & team, and build the execution matrix.' },
    { route: '/', view: 'auditor', sel: '[data-tour="stage"]', title: 'Auditor Workplace', body: 'Auditors find their assigned audits here, work the clause checklist and raise findings.' },
    { route: '/', view: 'auditee', sel: '[data-tour="stage"]', title: 'Auditee Workplace', body: 'Auditees reply to each finding with a root cause and a corrective action (CAPA).' },
    { route: '/', view: 'reports', sel: '[data-tour="stage"]', title: 'Reports', body: 'Verify closure and generate printable PDF audit reports and schedules.' },
    { route: '/', view: 'calendar', sel: '[data-tour="stage"]', title: 'Calendar', body: 'A visual timeline of scheduled, executed and closed audits.' },
    { route: '/', view: 'dashboard', sel: '[data-tour="stage"]', title: 'Dashboard', body: 'Live KPIs — open findings, overdue CAPAs and closure rate at a glance.' },
    { route: '/audit/findings', view: null, sel: '[data-tour="stage"]', title: 'Findings register', body: 'Every finding raised across audits is tracked here, all the way to closure.' },
    { route: '/audit/capa', view: null, sel: '[data-tour="stage"]', title: 'CAPA register', body: 'And every corrective action lives here, with its owner and due date.' },
    { route: '/sites', view: null, sel: '[data-tour="stage"]', title: 'Sites', body: 'Manage the locations your audits run against.' },
    { route: '/', view: 'hub', sel: null, title: "You're all set! 🎉", body: 'Click me anytime for help or a quick summary. Happy auditing!' },
  ]

  // start the tour once, on first login (per user, per browser)
  useEffect(() => {
    if (!firebaseUser?.uid || !org?.id) return undefined
    const key = `sam_tour_${firebaseUser.uid}`
    if (localStorage.getItem(key)) return undefined
    const t = setTimeout(() => setTour({ active: true, step: 0 }), 1400)
    return () => clearTimeout(t)
  }, [firebaseUser?.uid, org?.id])

  const endTour = () => {
    try {
      if (firebaseUser?.uid) localStorage.setItem(`sam_tour_${firebaseUser.uid}`, '1')
    } catch {
      /* ignore */
    }
    setTour({ active: false, step: 0 })
    setTourTarget(null)
    setTourWalk(false)
    setBubbleAt(null)
    dock()
  }
  const nextStep = () => {
    if (tour.step >= STEPS.length - 1) endTour()
    else setTour((t) => ({ active: true, step: t.step + 1 }))
  }

  // Open the step's tab/page, then walk Sam to it and show the tip bubble.
  useEffect(() => {
    if (!tour.active) return undefined
    const def = STEPS[tour.step]
    const needNav = def.route && window.location.pathname !== def.route
    if (needNav) navigate(def.route)

    setBubbleAt(null)
    setTourTarget(null)
    setTourWalk(true)
    const inner = charRef.current?.firstChild
    if (inner) inner.style.transform = ''

    let raf = 0
    let dv = 0
    // switch the Internal Audit module tab (after any route change settles)
    if (def.view) {
      dv = window.setTimeout(
        () => window.dispatchEvent(new CustomEvent('sam:view', { detail: def.view })),
        needNav ? 280 : 30,
      )
    }

    const measure = window.setTimeout(() => {
      let rect = null
      if (def.sel) {
        const el = document.querySelector(def.sel)
        if (el) rect = el.getBoundingClientRect()
      }
      setTourTarget(rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null)

      let ax
      let ay
      if (rect && rect.width < 340) {
        if (rect.left < window.innerWidth * 0.45) { ax = rect.right + 18; ay = rect.top + rect.height / 2 - 42 }
        else { ax = rect.left + rect.width / 2 - 32; ay = rect.bottom + 14 }
      } else if (rect) {
        ax = rect.left + rect.width * 0.5 - 32
        ay = Math.min(rect.bottom - 100, window.innerHeight - 112)
      } else {
        ax = window.innerWidth / 2 - 32
        ay = window.innerHeight / 2
      }
      ax = Math.max(8, Math.min(window.innerWidth - 80, ax))
      ay = Math.max(8, Math.min(window.innerHeight - 100, ay))

      let last = 0
      const stepFn = (t) => {
        if (!last) last = t
        const dt = Math.min(0.05, (t - last) / 1000)
        last = t
        const p = roam.current
        const dx = ax - p.x
        const dy = ay - p.y
        const d = Math.hypot(dx, dy)
        if (d < 2) {
          p.x = ax; p.y = ay; apply()
          setTourWalk(false)
          setBubbleAt({ x: ax, y: ay })
          return
        }
        const mv = Math.min(320 * dt, d)
        p.x += (dx / d) * mv
        p.y += (dy / d) * mv
        apply()
        raf = requestAnimationFrame(stepFn)
      }
      raf = requestAnimationFrame(stepFn)
    }, needNav ? 540 : def.view ? 400 : 120)

    return () => {
      clearTimeout(dv)
      clearTimeout(measure)
      cancelAnimationFrame(raf)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour.active, tour.step])

  // roam loop — walk left/right along the bottom when roaming and panel closed
  const moving = roaming && !open && !dragging && !hidden
  useEffect(() => {
    if (!moving) return undefined
    let raf = 0
    let last = 0
    const step = (t) => {
      if (!last) last = t
      const dt = Math.min(0.05, (t - last) / 1000)
      last = t
      const st = roam.current
      st.x += st.dir * 42 * dt
      const min = 8
      const max = window.innerWidth - 80
      if (st.x < min) { st.x = min; st.dir = 1 }
      if (st.x > max) { st.x = max; st.dir = -1 }
      if (charRef.current) {
        charRef.current.style.left = `${st.x}px`
        const inner = charRef.current.firstChild
        if (inner) inner.style.transform = `scaleX(${st.dir > 0 ? -1 : 1})`
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [moving])

  // drag to reposition / pin
  const onPointerDown = (e) => {
    const rect = charRef.current.getBoundingClientRect()
    drag.current = { startX: e.clientX, offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top, moved: false }
    setDragging(true)
    charRef.current.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e) => {
    if (!dragging) return
    if (Math.abs(e.clientX - drag.current.startX) > 4) drag.current.moved = true
    roam.current.x = Math.max(8, Math.min(window.innerWidth - 80, e.clientX - drag.current.offsetX))
    roam.current.y = Math.max(8, Math.min(window.innerHeight - 96, e.clientY - drag.current.offsetY))
    apply()
  }
  const onPointerUp = () => {
    if (!dragging) return
    setDragging(false)
    if (drag.current.moved) setRoaming(false) // pinned
    else openPanel() // tap → open
  }

  if (hidden) {
    return (
      <button
        onClick={() => setHidden(false)}
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-brand-600 px-4 py-2 text-sm font-bold text-white shadow-brand transition active:scale-95 hover:bg-brand-700 print:hidden"
      >
        <span className="grid h-6 w-6 place-items-center"><Officer className="h-6 w-6" /></span>
        Ask Sam
      </button>
    )
  }

  return (
    <>
      {open && (
        <div className="assist-panel fixed bottom-24 right-4 z-50 flex max-h-[calc(100dvh-7rem)] w-[330px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl print:hidden">
          {/* header */}
          <div className="flex items-center justify-between bg-auth-panel px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-white/10">
                <Officer className="h-8 w-8" />
              </span>
              <div>
                <p className="text-sm font-bold text-white">Sam — Audit Bot</p>
                <p className="text-[10px] text-slate-300">Insights from your live audits</p>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="rounded-lg p-1 text-slate-300 transition hover:bg-white/10 hover:text-white" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* messages */}
          <div ref={scrollRef} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto bg-slate-50/60 px-3 py-3">
            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <p className={`max-w-[85%] whitespace-pre-line rounded-2xl px-3 py-2 text-xs leading-relaxed ${m.role === 'user' ? 'bg-brand-600 text-white' : 'bg-white text-slate-700 shadow-sm ring-1 ring-slate-100'}`}>
                  {m.text}
                </p>
              </div>
            ))}
            {typing && (
              <div className="flex justify-start">
                <p className="sam-typing rounded-2xl bg-white px-3 py-2.5 shadow-sm ring-1 ring-slate-100">
                  <span /><span /><span />
                </p>
              </div>
            )}
          </div>

          {/* quick replies */}
          <div className="flex flex-wrap gap-1.5 border-t border-slate-100 px-3 pt-2.5">
            {QUICK.map(([label, intent]) => (
              <button key={label} onClick={() => ask(label, intent)} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-brand-50 hover:text-brand-700">
                {label}
              </button>
            ))}
          </div>

          {/* input */}
          <form onSubmit={send} className="flex items-center gap-2 px-3 py-2.5">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your audits…"
              className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-ink-800 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-400/20"
            />
            <button type="submit" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-600 text-white transition active:scale-95 hover:bg-brand-700" aria-label="Send">
              <Send className="h-4 w-4" />
            </button>
          </form>

          {/* footer */}
          <div className="border-t border-slate-100 px-3 py-2">
            <button
              onClick={() => { setOpen(false); setTour({ active: true, step: 0 }) }}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-50 px-3 py-1.5 text-xs font-bold text-brand-700 transition hover:bg-brand-100"
            >
              <Compass className="h-3.5 w-3.5" /> Take the guided tour
            </button>
            <div className="mt-2 flex items-center justify-between text-[11px] font-semibold text-slate-500">
              <button onClick={() => setRoaming((v) => !v)} className="inline-flex items-center gap-1.5 transition hover:text-brand-600">
                <Move className="h-3.5 w-3.5" />
                {roaming ? 'Drag Sam to pin him' : 'Let Sam roam'}
              </button>
              <button onClick={() => { setHidden(true); setOpen(false) }} className="inline-flex items-center gap-1.5 transition hover:text-brand-600">
                <EyeOff className="h-3.5 w-3.5" /> Hide
              </button>
            </div>
          </div>
        </div>
      )}

      {/* guided tour: spotlight + tip bubble */}
      {tour.active && (
        <>
          {tourTarget ? (
            <div
              className="pointer-events-none fixed z-[55] rounded-xl ring-2 ring-brand-400 transition-all duration-200"
              style={{
                left: tourTarget.left - 6,
                top: tourTarget.top - 6,
                width: tourTarget.width + 12,
                height: tourTarget.height + 12,
                boxShadow: '0 0 0 9999px rgba(15,23,42,0.45)',
              }}
            />
          ) : (
            <div className="pointer-events-none fixed inset-0 z-[55] bg-ink-900/40" />
          )}
          {bubbleAt && (
            <div
              className="assist-panel fixed z-[60] w-[250px] max-w-[calc(100vw-2rem)] rounded-2xl bg-white p-4 shadow-2xl"
              style={{
                left: Math.max(8, Math.min(window.innerWidth - 258, bubbleAt.x - 92)),
                top: bubbleAt.y < 170 ? bubbleAt.y + 96 : bubbleAt.y - 134,
              }}
            >
              <p className="text-sm font-bold text-ink-800">{STEPS[tour.step].title}</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">{STEPS[tour.step].body}</p>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  {tour.step + 1} / {STEPS.length}
                </span>
                <div className="flex items-center gap-2">
                  <button onClick={endTour} className="text-[11px] font-semibold text-slate-400 transition hover:text-slate-600">
                    Skip
                  </button>
                  <button
                    onClick={nextStep}
                    className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white transition active:scale-95 hover:bg-brand-700"
                  >
                    {tour.step >= STEPS.length - 1 ? 'Done' : 'Next'} <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* the character */}
      <button
        ref={charRef}
        onPointerDown={tour.active ? undefined : onPointerDown}
        onPointerMove={tour.active ? undefined : onPointerMove}
        onPointerUp={tour.active ? undefined : onPointerUp}
        style={{ left: `${roam.current.x}px`, top: `${roam.current.y}px`, pointerEvents: tour.active ? 'none' : 'auto' }}
        className={`fixed touch-none select-none ${tour.active ? 'z-[60]' : 'z-40'} ${roaming ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} print:hidden`}
        aria-label="Audit assistant Sam"
      >
        <span className={`block drop-shadow-lg ${moving || tourWalk ? 'sam-walking' : 'assist-char'}`}>
          <Officer className="h-[84px] w-[64px]" />
        </span>
        {attentionCount > 0 && !tour.active && (
          <span className="pointer-events-none absolute -right-1 top-1 grid min-w-[22px] place-items-center rounded-full bg-rose-500 px-1.5 py-0.5 text-[11px] font-bold text-white ring-2 ring-white">
            {attentionCount > 99 ? '99+' : attentionCount}
          </span>
        )}
      </button>
    </>
  )
}

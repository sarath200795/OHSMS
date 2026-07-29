import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Send, X } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { answer, isoMap } from './brain'
import { getStats } from './liveStats'
import SamCharacter from './SamCharacter'

const AVATAR = 76

/** Random on-screen spot (edge-biased) for Sam's idle wander. */
function randomSpot() {
  const w = window.innerWidth
  const h = window.innerHeight
  const margin = 16
  const edges = [
    { x: margin, y: margin + Math.random() * (h - 200) }, // left
    { x: w - AVATAR - margin, y: margin + Math.random() * (h - 200) }, // right
    { x: margin + Math.random() * (w - 200), y: h - AVATAR - margin - 60 }, // bottom
  ]
  return edges[Math.floor(Math.random() * edges.length)]
}

/** Render **bold** spans + newlines in Sam's text parts. */
function SamText({ text }) {
  const chunks = text.split('**')
  return (
    <p className="whitespace-pre-line text-sm leading-relaxed text-ink-800">
      {chunks.map((c, i) => (i % 2 ? <b key={i}>{c}</b> : <span key={i}>{c}</span>))}
    </p>
  )
}

function SamParts({ parts }) {
  return (
    <div className="space-y-2">
      {parts.map((p, i) => {
        if (p.type === 'text') return <SamText key={i} text={p.text} />
        if (p.type === 'modules')
          return (
            <div key={i}>
              <p className="mb-1 text-xs font-semibold text-ink-500">{p.label}</p>
              <div className="flex flex-wrap gap-1.5">
                {p.modules.map((m) => (
                  <Link key={m.path + m.label} to={m.path} className="chip bg-brand-50 text-brand-700 hover:bg-brand-100">
                    {m.label}
                  </Link>
                ))}
              </div>
            </div>
          )
        if (p.type === 'map')
          return (
            <div key={i} className="max-h-64 overflow-y-auto rounded-xl bg-clay-100/70 p-2">
              <table className="w-full text-xs">
                <tbody>
                  {isoMap().map((row) => (
                    <tr key={row.clause} className="border-b border-clay-200/60 last:border-0">
                      <td className="whitespace-nowrap py-1 pr-2 font-bold text-brand-700">{row.clause}</td>
                      <td className="py-1 pr-2 text-ink-700">{row.title}</td>
                      <td className="py-1">
                        {row.modules.map((m) => (
                          <Link key={m.path + m.label} to={m.path} className="mr-1 text-brand-600 hover:underline">
                            {m.label.split(' (')[0]}
                          </Link>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        return null
      })}
    </div>
  )
}

const SUGGESTIONS = ['What is clause 5.4?', '8.2 emergency', 'How is our training compliance?', 'ISO map']

export default function Sam() {
  const { orgId, isApproved, profile } = useAuth()
  const reduce = useReducedMotion()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(() => ({
    x: Math.max(16, window.innerWidth - AVATAR - 24),
    y: Math.max(16, window.innerHeight - AVATAR - 96),
  }))
  const [messages, setMessages] = useState([
    {
      role: 'sam',
      parts: [{ type: 'text', text: 'Hi, I’m **Sam** — your ISO 45001 buddy! 🦺 Ask me about any clause, or how your WEHS modules stack up against the standard.' }],
    },
  ])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  // Walk state drives the limb swing and which way Sam faces while strolling.
  const [walking, setWalking] = useState(false)
  const [facing, setFacing] = useState(1)
  const dragging = useRef(false)
  const listRef = useRef(null)

  /** Move to a spot, turning to face the direction of travel and walking there. */
  const strollTo = (next) => {
    setPos((prev) => {
      if (next.x !== prev.x) setFacing(next.x > prev.x ? 1 : -1)
      return next
    })
    setWalking(true)
    // Matches the spring settle below; the legs stop when Sam does.
    window.setTimeout(() => setWalking(false), 2200)
  }

  // Idle wander: when the chat is closed, stroll to a new spot every 25–45 s.
  useEffect(() => {
    if (open || reduce) return undefined
    let timer
    const schedule = () => {
      timer = setTimeout(() => {
        if (!dragging.current) strollTo(randomSpot())
        schedule()
      }, 25_000 + Math.random() * 20_000)
    }
    schedule()
    return () => clearTimeout(timer)
  }, [open, reduce])

  // Dock beside the panel when the chat opens — walking over rather than teleporting.
  useEffect(() => {
    if (open) strollTo({ x: Math.max(16, window.innerWidth - AVATAR - 24), y: Math.max(16, window.innerHeight - 520) })
  }, [open])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, thinking, open])

  const ask = async (raw) => {
    const q = (raw ?? input).trim()
    if (!q) return
    setInput('')
    setMessages((m) => [...m, { role: 'user', parts: [{ type: 'text', text: q }] }])
    setThinking(true)
    let stats = {}
    try {
      stats = await getStats(orgId)
    } catch {
      /* stats are optional */
    }
    setMessages((m) => [...m, { role: 'sam', parts: answer(q, stats) }])
    setThinking(false)
  }

  const greeting = useMemo(
    () => (profile?.name ? `Sam · here to help, ${profile.name.split(' ')[0]}!` : 'Sam · ISO 45001 buddy'),
    [profile]
  )

  if (!isApproved) return null

  return (
    <div className="pointer-events-none fixed inset-0 z-40 print:hidden" aria-live="polite">
      {/* The buddy */}
      <motion.button
        type="button"
        aria-label="Sam — ISO 45001 assistant"
        className="pointer-events-auto absolute left-0 top-0 grid cursor-grab place-items-center rounded-2xl active:cursor-grabbing"
        style={{ width: AVATAR, height: AVATAR, touchAction: 'none' }}
        animate={{ x: pos.x, y: pos.y }}
        transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 40, damping: 14 }}
        drag
        dragMomentum={false}
        onDragStart={() => { dragging.current = true }}
        onDragEnd={(e, info) => {
          dragging.current = false
          setPos((p) => ({
            x: Math.min(Math.max(8, p.x + info.offset.x), window.innerWidth - AVATAR - 8),
            y: Math.min(Math.max(8, p.y + info.offset.y), window.innerHeight - AVATAR - 8),
          }))
        }}
        onClick={() => { if (!dragging.current) setOpen((o) => !o) }}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.95 }}
      >
        {/* Soft ground shadow — anchors the character instead of leaving it floating */}
        <span
          aria-hidden="true"
          className="absolute bottom-1 left-1/2 h-1.5 -translate-x-1/2 rounded-[50%] bg-ink-900/15 blur-[2px]"
          style={{ width: AVATAR * 0.42 }}
        />
        <SamCharacter
          size={AVATAR}
          walking={walking}
          facing={facing}
          talking={thinking || open}
          reduce={reduce}
        />
        <span className="absolute -bottom-1 rounded-full bg-brand-600 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white shadow-clay-sm">
          Sam
        </span>
      </motion.button>

      {/* Chat panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            className="pointer-events-auto absolute bottom-4 right-4 flex h-[28rem] w-[24rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-3xl bg-clay-surface shadow-clay"
          >
            <div className="flex items-center justify-between border-b border-clay-200/70 bg-brand-600 px-4 py-3 text-white">
              <p className="text-sm font-bold">🦺 {greeting}</p>
              <button onClick={() => setOpen(false)} aria-label="Close Sam" className="rounded-lg p-1 hover:bg-white/15">
                <X size={16} />
              </button>
            </div>

            <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-3">
              {messages.map((m, i) => (
                <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                  <div className={
                    m.role === 'user'
                      ? 'max-w-[85%] rounded-2xl rounded-br-md bg-brand-600 px-3 py-2 text-sm text-white'
                      : 'max-w-[92%] rounded-2xl rounded-bl-md bg-clay-100 px-3 py-2 shadow-clay-sm'
                  }>
                    {m.role === 'user' ? m.parts[0].text : <SamParts parts={m.parts} />}
                  </div>
                </div>
              ))}
              {thinking && (
                <div className="flex items-center gap-1 pl-2 text-ink-400">
                  {[0, 1, 2].map((i) => (
                    <motion.span key={i} className="h-1.5 w-1.5 rounded-full bg-ink-400"
                      animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 0.9, delay: i * 0.15 }} />
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5 px-3 pb-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => ask(s)} className="chip bg-clay-100 text-ink-600 transition hover:bg-brand-50 hover:text-brand-700">
                  {s}
                </button>
              ))}
            </div>

            <form
              className="flex items-center gap-2 border-t border-clay-200/70 p-3"
              onSubmit={(e) => { e.preventDefault(); ask() }}
            >
              <input
                className="input !py-2 text-sm"
                placeholder="Ask about an ISO clause…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
              <button type="submit" className="btn-primary !px-3 !py-2" aria-label="Send">
                <Send size={16} />
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

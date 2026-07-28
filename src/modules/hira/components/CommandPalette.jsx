import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard, FolderOpen, ShieldAlert, CalendarClock, FilePlus2, Upload, Building2,
  LogOut, Search, CornerDownLeft,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'

// Global quick-nav / actions palette. Opens with ⌘K / Ctrl+K, or by dispatching
// a window 'open-command-palette' event (used by the sidebar search button).
export default function CommandPalette() {
  const navigate = useNavigate()
  const { signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)

  const commands = useMemo(() => [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, kw: 'home overview kpi', run: () => navigate('/dashboard') },
    { id: 'create', label: 'Create Risk Assessment', icon: FilePlus2, kw: 'new add hira hazard', run: () => navigate('/hira/create') },
    { id: 'repository', label: 'Repository', icon: FolderOpen, kw: 'assessments list browse', run: () => navigate('/hira/repository') },
    { id: 'risk', label: 'Risk Register', icon: ShieldAlert, kw: 'alarp acceptable critical high residual', run: () => navigate('/hira/risk-register') },
    { id: 'actions', label: 'Action Tracker', icon: CalendarClock, kw: 'capa controls due overdue', run: () => navigate('/hira/action-tracker') },
    { id: 'bulk', label: 'Bulk Import (CSV)', icon: Upload, kw: 'csv upload import', run: () => navigate('/hira/bulk-import') },
    { id: 'org', label: 'Organization & Sites', icon: Building2, kw: 'sites settings facility', run: () => navigate('/settings') },
    { id: 'signout', label: 'Sign out', icon: LogOut, kw: 'logout exit', run: async () => { await signOut(); navigate('/login') } },
  ], [navigate, signOut])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter((c) => `${c.label} ${c.kw}`.toLowerCase().includes(q))
  }, [commands, query])

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      } else if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('open-command-palette', onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('open-command-palette', onOpen)
    }
  }, [])

  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
      const t = setTimeout(() => inputRef.current?.focus(), 20)
      return () => clearTimeout(t)
    }
    return undefined
  }, [open])

  useEffect(() => { setActive(0) }, [query])

  const run = (cmd) => { setOpen(false); cmd.run() }

  const onInputKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); const c = filtered[active]; if (c) run(c) }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.1 } }}
        >
          <div className="absolute inset-0 bg-ink-950/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
          {/* Keyboard-initiated → fast, minimal animation (per Emil/Raycast). */}
          <motion.div
            className="card relative z-10 w-full max-w-lg overflow-hidden !p-0"
            initial={{ opacity: 0, scale: 0.98, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.1 } }}
            transition={{ duration: 0.12, ease: [0.23, 1, 0.32, 1] }}
          >
            <div className="flex items-center gap-2 border-b border-clay-200 px-4">
              <Search size={16} className="text-ink-400" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onInputKey}
                placeholder="Search pages and actions…"
                className="w-full bg-transparent py-3.5 text-sm text-ink-900 outline-none placeholder:text-ink-400"
              />
              <kbd className="rounded bg-clay-100 px-1.5 py-0.5 text-[10px] font-bold text-ink-400">ESC</kbd>
            </div>
            <ul className="max-h-80 overflow-y-auto p-2">
              {filtered.length === 0 && <li className="px-3 py-6 text-center text-sm text-ink-400">No matches</li>}
              {filtered.map((c, i) => (
                <li key={c.id}>
                  <button
                    onMouseEnter={() => setActive(i)}
                    onClick={() => run(c)}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${i === active ? 'bg-brand-50 text-brand-700' : 'text-ink-700 hover:bg-clay-50'}`}
                  >
                    <c.icon size={16} className={i === active ? 'text-brand-600' : 'text-ink-400'} />
                    <span className="flex-1 text-left font-medium">{c.label}</span>
                    {i === active && <CornerDownLeft size={14} className="text-brand-400" />}
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

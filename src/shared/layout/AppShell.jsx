import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Home, Building2, LogOut, ChevronDown, KeyRound } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { roleLabel } from '../auth/permissions'
import { initials } from '../lib/format'
import RequestAccessModal from './RequestAccessModal'
import Sam from '../sam/Sam'

function UserMenu() {
  const { profile, orgName, role, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const [reqOpen, setReqOpen] = useState(false)
  const reduce = useReducedMotion()
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-2xl bg-clay-surface px-2 py-1.5 shadow-clay-sm transition active:scale-[0.98]"
      >
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand-600 text-xs font-bold text-white">
          {initials(profile?.name) || 'U'}
        </span>
        <span className="hidden text-left sm:block">
          <span className="block text-sm font-semibold leading-tight text-ink-900">
            {profile?.name || 'User'}
          </span>
          <span className="block text-[11px] leading-tight text-ink-400">{roleLabel(role)}</span>
        </span>
        <ChevronDown size={16} className="text-ink-400" />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <motion.div
              className="absolute right-0 z-20 mt-2 w-56 origin-top-right"
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
              animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
            >
              <div className="card overflow-hidden p-2">
                <div className="border-b border-ink-100 px-3 py-2">
                  <p className="text-sm font-semibold text-ink-900">{profile?.name}</p>
                  <p className="truncate text-xs text-ink-400">{profile?.email}</p>
                  <p className="mt-1 text-[11px] font-medium text-brand-700">{orgName}</p>
                </div>
                <Link
                  to="/hub"
                  onClick={() => setOpen(false)}
                  className="mt-1 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-ink-700 transition hover:bg-clay-100 active:scale-[0.98]"
                >
                  <Home size={16} /> Home
                </Link>
                <button
                  onClick={() => { setOpen(false); setReqOpen(true) }}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-ink-700 transition hover:bg-clay-100 active:scale-[0.98]"
                >
                  <KeyRound size={16} /> Request access
                </button>
                <button
                  onClick={signOut}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 active:scale-[0.98]"
                >
                  <LogOut size={16} /> Sign out
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <RequestAccessModal open={reqOpen} onClose={() => setReqOpen(false)} />
    </div>
  )
}

// Sidebar-free shell: a topbar with a Home (hub) button, org context and the
// user menu. All navigation happens through the Hub tiles and each module's
// own sub-nav.
export default function AppShell({ children }) {
  const { orgName } = useAuth()
  const location = useLocation()
  const reduce = useReducedMotion()
  const onHub = location.pathname === '/hub'

  return (
    <div className="min-h-screen bg-clay-bg">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-ink-100 bg-clay-bg/85 px-4 py-3 backdrop-blur-md sm:px-6">
        <Link
          to="/hub"
          title="Home"
          className="flex items-center gap-2.5 rounded-2xl px-2 py-1 transition hover:bg-clay-100 active:scale-[0.98]"
        >
          <img src="/wehs.svg" alt="WEHS" className="h-9 w-9 rounded-lg" />
          <div className="leading-tight">
            <p className="text-sm font-bold tracking-tight text-ink-900">WEHS</p>
            <p className="hidden text-[11px] text-ink-400 sm:block">Workplace Environment, Health &amp; Safety</p>
          </div>
        </Link>

        {!onHub && (
          <Link to="/hub" className="btn-ghost !hidden !px-3 !py-1.5 sm:!inline-flex">
            <Home size={15} /> Home
          </Link>
        )}

        <div className="flex-1" />

        <div className="hidden items-center gap-2 sm:flex">
          <Building2 size={16} className="text-ink-400" />
          <span className="text-sm font-semibold text-ink-700">{orgName || 'Organization'}</span>
        </div>
        <UserMenu />
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <motion.div
          key={location.pathname}
          initial={reduce ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
        >
          {children}
        </motion.div>
      </main>

      {/* Sam the Buddy — floating ISO 45001 assistant, available everywhere. */}
      <Sam />
    </div>
  )
}

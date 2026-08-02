// ─────────────────────────────────────────────────────────────────────────────
// The one shell.
//
// There used to be two: the portal had its own header, and every module page
// rendered inside a different one. Same app, same person, two sets of
// navigation depending on which link they happened to follow — so opening a
// module felt like leaving the product.
//
// This is the portal header, used everywhere. Module pages render inside it
// exactly as portal pages do, which is why it takes children rather than
// assuming an Outlet: the portal routes nest, the module routes do not.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { Building2, ChevronDown, LogOut, GraduationCap, KeyRound } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { initials } from '../lib/format'
import RequestAccessModal from './RequestAccessModal'
import Sam from '../sam/Sam'

const NAV = [
  { to: '/portal', end: true, label: 'Home', dot: '#8fbc74' },
  { to: '/portal/report', label: 'Report', dot: '#c74a33' },
  { to: '/portal/actions', label: 'My actions', dot: '#e8a33d' },
  { to: '/portal/training', label: 'My training', dot: '#7fc4bb' },
]

const ROLE_LABEL = {
  admin: 'Administrator',
  manager: 'Manager',
  auditor: 'Auditor',
  member: 'Employee',
}

export default function AppChrome({ children }) {
  const { profile, orgName, role, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const reduce = useReducedMotion()
  const [menuOpen, setMenuOpen] = useState(false)
  const [reqOpen, setReqOpen] = useState(false)
  const menuRef = useRef(null)

  // A menu that can only be dismissed by the button that opened it is a trap on
  // a touch screen.
  useEffect(() => {
    if (!menuOpen) return undefined
    const onDown = (e) => { if (!menuRef.current?.contains(e.target)) setMenuOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const name = profile?.name || 'There'

  return (
    <div className="min-h-screen bg-clay-bg">
      <header className="sticky top-0 z-30 flex items-center gap-3.5 border-b border-ink-100 bg-clay-bg/90 px-5 py-3 backdrop-blur-md sm:px-7">
        <NavLink to="/portal" className="flex flex-none items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-brand-600 text-sm font-extrabold text-white shadow-clay-sm">
            W
          </span>
          <span className="hidden leading-tight sm:block">
            <span className="block text-[13px] font-extrabold tracking-[-0.01em] text-ink-900">WEHS</span>
            <span className="block text-[11px] text-ink-400">Workplace Environment, Health &amp; Safety</span>
          </span>
        </NavLink>

        <nav className="ml-2 hidden gap-1.5 md:flex">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-[13px] font-semibold transition-transform duration-200 ease-emil active:scale-[0.97] ${
                  isActive ? 'bg-clay-surface text-ink-900 shadow-clay-inset' : 'text-ink-600 hover:text-ink-900'
                }`
              }
            >
              <span className="h-[7px] w-[7px] rounded-full" style={{ background: n.dot }} />
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex-1" />

        <div className="ml-1.5 hidden items-center gap-2 border-l border-ink-200 pl-3.5 lg:flex">
          <Building2 size={15} className="text-ink-400" />
          <span className="text-[13px] font-semibold text-ink-700">{orgName || 'Your organization'}</span>
        </div>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            className="flex items-center gap-2.5 rounded-2xl bg-clay-surface px-2 py-1.5 shadow-clay-sm transition-transform duration-200 ease-emil active:scale-[0.98]"
          >
            <span className="grid h-[30px] w-[30px] place-items-center rounded-[10px] bg-brand-600 text-[11px] font-bold text-white">
              {initials(name)}
            </span>
            <span className="hidden text-left leading-tight sm:block">
              <span className="block text-[12.5px] font-bold text-ink-900">{name}</span>
              <span className="block text-[10.5px] text-ink-400">{ROLE_LABEL[role] || 'Employee'}</span>
            </span>
            <ChevronDown size={14} className="text-ink-400" />
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-2xl bg-clay-surface p-1.5 shadow-clay animate-fade-in-up"
            >
              <div className="border-b border-ink-100 px-3 py-2.5">
                <p className="text-[13px] font-bold text-ink-900">{name}</p>
                <p className="truncate text-[11.5px] text-ink-400">{profile?.email}</p>
                <p className="mt-0.5 text-[11.5px] text-ink-400">{orgName}</p>
              </div>
              <MenuItem icon={GraduationCap} onClick={() => { setMenuOpen(false); navigate('/portal/training') }}>
                My training record
              </MenuItem>
              <MenuItem icon={KeyRound} onClick={() => { setMenuOpen(false); setReqOpen(true) }}>
                Request access
              </MenuItem>
              <MenuItem icon={LogOut} danger onClick={() => signOut?.()}>
                Sign out
              </MenuItem>
            </div>
          )}
        </div>
      </header>

      {/* The header row has no space for nav beside the CTA on a phone. */}
      <nav className="flex gap-1.5 overflow-x-auto px-5 pt-3 md:hidden">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              `inline-flex flex-none items-center gap-2 rounded-2xl px-3 py-2 text-[13px] font-semibold ${
                isActive ? 'bg-clay-surface text-ink-900 shadow-clay-inset' : 'text-ink-600'
              }`
            }
          >
            <span className="h-[7px] w-[7px] rounded-full" style={{ background: n.dot }} />
            {n.label}
          </NavLink>
        ))}
      </nav>

      <main className="mx-auto max-w-[1180px] px-5 pb-24 pt-6 sm:px-7">
        <motion.div
          key={location.pathname}
          initial={reduce ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
        >
          {children}
        </motion.div>
      </main>

      <RequestAccessModal open={reqOpen} onClose={() => setReqOpen(false)} />
      {/* Sam the Buddy — the ISO 45001 assistant, available on every screen. */}
      <Sam />
    </div>
  )
}

function MenuItem({ icon: Icon, children, onClick, danger }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold transition-colors ${
        danger ? 'text-red-600 hover:bg-red-50' : 'text-ink-700 hover:bg-clay-100'
      }`}
    >
      <Icon size={15} />
      {children}
    </button>
  )
}

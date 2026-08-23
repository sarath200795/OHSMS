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
//
// It carries no navigation. The portal home is the only hub — every module and
// every personal page is a tile or a button there — so the bar holds identity
// and account, and nothing that competes with the page below it.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { Building2, ChevronDown, LogOut, GraduationCap, KeyRound, ShieldCheck } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { initials } from '../lib/format'
import RequestAccessModal from './RequestAccessModal'
import Sam from '../sam/Sam'
import HomeBar from './HomeBar'
import { useIdleTimeout } from '../auth/useIdleTimeout'

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
  const { isWarning, isExpired, remainingSeconds, resetActivity } = useIdleTimeout()

  useEffect(() => {
    if (isExpired && signOut) {
      signOut()
    }
  }, [isExpired, signOut])
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
      {/* Skip link. The header carries the wordmark, the module switcher, the
          notification bell and the account menu, and it is sticky — so on every
          single route a keyboard user tabbed through all of it before reaching
          the page they had just navigated to. Visually hidden until focused,
          which is the point: it costs nothing to anyone who does not need it. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to main content
      </a>
      <header className="sticky top-0 z-30 flex items-center gap-3.5 border-b border-ink-100 bg-clay-bg/90 px-5 py-3 backdrop-blur-md sm:px-7">
        {/* aria-label rather than leaning on the wordmark beside it: that text
            is hidden below sm, and without this the only way home on a phone
            was a link announced as the single letter "W". */}
        <NavLink
          to="/portal"
          aria-label="WEHS home"
          className="flex flex-none items-center gap-2.5"
        >
          <img
            src="/wehs.svg"
            alt=""
            aria-hidden="true"
            className="h-9 w-9 flex-none rounded-[10px] shadow-clay-sm"
          />
          <span className="hidden leading-tight sm:block">
            <span className="block text-[13px] font-extrabold tracking-[-0.01em] text-ink-900">WEHS</span>
            <span className="block text-[11px] text-ink-400">Workplace Environment, Health &amp; Safety</span>
          </span>
        </NavLink>

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
              <MenuItem icon={ShieldCheck} onClick={() => { setMenuOpen(false); navigate('/security') }}>
                Security &amp; two-factor
              </MenuItem>
              {/* No link to the platform console lives here, deliberately. It
                  is a separate application with its own sign-in, and a door to
                  it inside a tenant's menu is the confusion the separation
                  exists to remove. */}
              <MenuItem icon={LogOut} danger onClick={() => signOut?.()}>
                Sign out
              </MenuItem>
            </div>
          )}
        </div>
      </header>

      <main id="main" tabIndex={-1} className="mx-auto max-w-[1180px] px-5 pb-24 pt-6 sm:px-7">
        <HomeBar />
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

      {isWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-sm rounded-2xl bg-clay-surface p-6 shadow-clay-lg">
            <h2 className="mb-2 text-lg font-bold text-ink-900">Session Expiring Soon</h2>
            <p className="mb-6 text-[14px] text-ink-600">
              You have been inactive for a while. You will be signed out in <span className="font-bold text-red-600">{remainingSeconds}</span> seconds to protect your account.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => signOut?.()}
                className="rounded-xl px-4 py-2 text-[13px] font-bold text-ink-600 hover:bg-clay-100 transition-colors"
              >
                Sign Out
              </button>
              <button
                type="button"
                onClick={resetActivity}
                className="rounded-xl bg-brand-600 px-4 py-2 text-[13px] font-bold text-white shadow-brand-sm hover:bg-brand-500 transition-colors"
              >
                Stay Signed In
              </button>
            </div>
          </div>
        </div>
      )}
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

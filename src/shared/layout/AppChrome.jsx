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
import { useLocation } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { Building2, ChevronDown, LogOut, GraduationCap, KeyRound, ShieldCheck } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { initials } from '../lib/format'
import RequestAccessModal from './RequestAccessModal'
import Sam from '../sam/Sam'
import HomeBar from './HomeBar'
import { OrgMark, PoweredByWeEhs } from '../branding/OrgMark'
import IdleGuard from '../auth/IdleGuard'
import AppLink from '../../app/AppLink'

const ROLE_LABEL = {
  admin: 'Administrator',
  manager: 'Manager',
  auditor: 'Auditor',
  member: 'Employee',
}

export default function AppChrome({ children }) {
  const { profile, org, orgName, role, signOut } = useAuth()
  const location = useLocation()
  const reduce = useReducedMotion()
  const [menuOpen, setMenuOpen] = useState(false)
  const [reqOpen, setReqOpen] = useState(false)
  const menuRef = useRef(null)

  // A menu that can only be dismissed by the button that opened it is a trap on
  // a touch screen.
  useEffect(() => {
    if (!menuOpen) return undefined
    const onDown = (e) => {
      if (!menuRef.current?.contains(e.target)) setMenuOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  useEffect(() => {
    if (!menuOpen) return undefined
    const items = menuRef.current?.querySelectorAll('[role="menuitem"]')
    items?.[0]?.focus?.({ preventScroll: true })
    return undefined
  }, [menuOpen])

  const onMenuKeyDown = (e) => {
    const items = Array.from(menuRef.current?.querySelectorAll('[role="menuitem"]') || [])
    if (!items.length) return
    const i = items.indexOf(document.activeElement)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      items[(i + 1) % items.length]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      items[(i <= 0 ? items.length : i) - 1]?.focus()
    } else if (e.key === 'Home') {
      e.preventDefault()
      items[0]?.focus()
    } else if (e.key === 'End') {
      e.preventDefault()
      items[items.length - 1]?.focus()
    }
  }

  const name = profile?.name || 'There'
  // The wordmark beside the mark names the ORGANIZATION once it has a logo of
  // its own. Leaving "WEHS / Workplace Environment, Health & Safety" standing
  // next to a customer's logo reads as a co-brand nobody agreed to; the vendor
  // gets the badge in the opposite corner instead.
  const branded = Boolean(org?.logoUrl)

  return (
    <div className="min-h-screen bg-clay-bg">
      {/* Skip link. The header carries the wordmark, the module switcher, the
          notification bell and the account menu, and it is sticky — so on every
          single route a keyboard user tabbed through all of it before reaching
          the page they had just navigated to. Visually hidden until focused,
          which is the point: it costs nothing to anyone who does not need it. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-xl focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to main content
      </a>
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-ink-100 bg-clay-bg/90 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-md sm:gap-3.5 sm:px-7">
        {/* aria-label rather than leaning on the wordmark beside it: that text
            is hidden below sm, and without this the only way home on a phone
            was a link announced as the single letter "W". */}
        <AppLink
          to="/portal"
          aria-label={`${branded && orgName ? orgName : 'WEHS'} home`}
          className="flex min-w-0 flex-none items-center gap-2.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-clay-bg"
        >
          <OrgMark className="h-9 w-9 rounded-[10px] shadow-clay-sm" />
          <span className="hidden min-w-0 leading-tight sm:block">
            <span className="block truncate text-[13px] font-extrabold tracking-[-0.01em] text-ink-900">
              {branded ? orgName || 'Your organization' : 'WEHS'}
            </span>
            <span className="block truncate text-[11px] text-ink-400">
              {branded ? 'Occupational Health & Safety' : 'Workplace Environment, Health & Safety'}
            </span>
          </span>
        </AppLink>

        <div className="flex-1" />

        <div className="ml-1.5 hidden min-w-0 items-center gap-2 border-l border-ink-200 pl-3.5 lg:flex">
          <Building2 size={15} className="shrink-0 text-ink-400" />
          <span className="truncate text-[13px] font-semibold text-ink-700">
            {orgName || 'Your organization'}
          </span>
        </div>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-controls="account-menu"
            className="flex items-center gap-2.5 rounded-2xl bg-clay-surface px-2 py-1.5 shadow-clay-sm transition-transform duration-200 ease-emil active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-clay-bg"
          >
            <span className="grid h-[30px] w-[30px] place-items-center rounded-[10px] bg-brand-600 text-[11px] font-bold text-white">
              {initials(name)}
            </span>
            <span className="hidden text-left leading-tight sm:block">
              <span className="block text-[12.5px] font-bold text-ink-900">{name}</span>
              <span className="block text-[10.5px] text-ink-400">
                {ROLE_LABEL[role] || 'Employee'}
              </span>
            </span>
            <ChevronDown size={14} className="text-ink-400" />
          </button>

          {menuOpen && (
            <div
              id="account-menu"
              role="menu"
              tabIndex={-1}
              onKeyDown={onMenuKeyDown}
              className="absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-2xl bg-clay-surface p-1.5 shadow-clay animate-fade-in-up"
            >
              <div className="border-b border-ink-100 px-3 py-2.5">
                <p className="text-[13px] font-bold text-ink-900">{name}</p>
                <p className="truncate text-[11.5px] text-ink-400">{profile?.email}</p>
                <p className="mt-0.5 truncate text-[11.5px] text-ink-400">{orgName}</p>
              </div>
              <MenuItem
                icon={GraduationCap}
                to="/portal/training"
                onClick={() => setMenuOpen(false)}
              >
                My training record
              </MenuItem>
              <MenuItem
                icon={KeyRound}
                onClick={() => {
                  setMenuOpen(false)
                  setReqOpen(true)
                }}
              >
                Request access
              </MenuItem>
              <MenuItem icon={ShieldCheck} to="/security" onClick={() => setMenuOpen(false)}>
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

      <main id="main" tabIndex={-1} className="mx-auto max-w-[1180px] px-4 pb-24 pt-6 sm:px-7">
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

      {/* Vendor attribution, bottom-right on every screen. Below Sam's panel
          (z-40) and the session dialog (z-50), so it can never sit on top of
          something a person is trying to use. */}
      <PoweredByWeEhs />

      <IdleGuard signOut={signOut} />
    </div>
  )
}

function MenuItem({ icon: Icon, children, onClick, to, danger }) {
  const className = `flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
    danger ? 'text-red-600 hover:bg-red-50' : 'text-ink-700 hover:bg-clay-100'
  }`
  const inner = (
    <>
      <Icon size={15} />
      {children}
    </>
  )
  if (to) {
    return (
      <AppLink to={to} role="menuitem" className={className} onClick={onClick}>
        {inner}
      </AppLink>
    )
  }
  return (
    <button type="button" role="menuitem" onClick={onClick} className={className}>
      {inner}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// The employee portal shell.
//
// Everyone in this app currently lands on /hub — a grid of the ten admin
// modules. That is the right home for an HSE lead and the wrong one for a
// forklift operator who signs in twice a month to report something and check
// whether their refresher is due. The portal is that second person's home: four
// destinations, one prominent action, and no module they cannot open.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { AlertTriangle, Building2, ChevronDown, LogOut, Bell, KeySquare } from 'lucide-react'
import { useAuth } from '../../shared/auth/AuthContext'
import { initials } from '../../shared/lib/format'

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

export default function PortalLayout() {
  const { profile, orgName, role, signOut } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  // Close the profile menu on an outside click or Escape — a menu that can only
  // be dismissed by the button that opened it is a trap on a touch screen.
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
                  isActive
                    ? 'bg-clay-surface text-ink-900 shadow-clay-inset'
                    : 'text-ink-600 hover:text-ink-900'
                }`
              }
            >
              <span className="h-[7px] w-[7px] rounded-full" style={{ background: n.dot }} />
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex-1" />

        <button
          type="button"
          onClick={() => navigate('/portal/report')}
          className="inline-flex items-center gap-2 rounded-2xl bg-brand-600 px-4 py-2.5 text-[13px] font-semibold text-white shadow-clay-brand transition-transform duration-200 ease-emil hover:bg-brand-700 active:scale-[0.97]"
        >
          <AlertTriangle size={15} strokeWidth={2.2} />
          <span className="hidden sm:inline">Report something</span>
          <span className="sm:hidden">Report</span>
        </button>

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
              <MenuItem icon={Bell} onClick={() => { setMenuOpen(false); navigate('/portal/training') }}>
                My training record
              </MenuItem>
              <MenuItem icon={KeySquare} onClick={() => { setMenuOpen(false); navigate('/hub') }}>
                Request module access
              </MenuItem>
              <MenuItem icon={LogOut} danger onClick={() => signOut?.()}>
                Sign out
              </MenuItem>
            </div>
          )}
        </div>
      </header>

      {/* Mobile nav — the header row has no space for it beside the CTA. */}
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
        <Outlet />
      </main>
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

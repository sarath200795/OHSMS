import { Link } from 'react-router-dom'
import { ArrowRight, Building2, ScrollText, UsersRound, Settings } from 'lucide-react'
import { useAuth } from '../shared/auth/AuthContext'
import { MODULES } from '../shared/modules/registry'

// Per-tone logo gradient — gives each app a distinct, recognizable "logo" tile.
const GRADIENT = {
  red: 'from-red-500 to-rose-600',
  amber: 'from-amber-500 to-orange-600',
  blue: 'from-sky-500 to-blue-600',
  violet: 'from-violet-500 to-purple-600',
  green: 'from-emerald-500 to-teal-600',
  brand: 'from-brand-500 to-brand-700',
}

// Workspace & administration tiles (moved here from the removed sidebar).
// NOTE: the Analytics Dashboard tile is intentionally hidden for now — a dedicated
// Analytics module will be designed later.
const SYSTEM = [
  {
    key: 'sites',
    title: 'Sites',
    path: '/sites',
    icon: Building2,
    tone: 'brand',
    description: 'Locations and departments across your organization.',
  },
  {
    key: 'audit-log',
    title: 'Audit Log',
    path: '/audit-log',
    icon: ScrollText,
    tone: 'violet',
    description: 'Append-only record of every action, all modules.',
  },
  {
    key: 'users',
    title: 'Employees',
    path: '/users',
    icon: UsersRound,
    tone: 'green',
    description: 'Employee repository — add or bulk-upload employees, roles & access.',
    adminOnly: true,
  },
  {
    key: 'settings',
    title: 'Org Settings',
    path: '/settings',
    icon: Settings,
    tone: 'amber',
    description: 'Organization profile and preferences.',
    adminOnly: true,
  },
]

// A branded app "logo": a soft gradient tile with the item's icon.
function AppLogo({ item, size = 'lg' }) {
  const dim = size === 'lg' ? 'h-16 w-16' : 'h-12 w-12'
  const icon = size === 'lg' ? 30 : 24
  return (
    <span
      className={`grid ${dim} place-items-center rounded-3xl bg-gradient-to-br ${
        GRADIENT[item.tone] || GRADIENT.brand
      } text-white shadow-clay-sm`}
    >
      <item.icon size={icon} strokeWidth={2.2} />
    </span>
  )
}

export { AppLogo }

function Tile({ item, i, size = 'lg' }) {
  return (
    <Link
      to={item.path}
      className="group card animate-fade-in-up flex flex-col gap-4 p-5 transition-transform duration-200 ease-emil hover:-translate-y-1 active:scale-[0.99]"
      style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}
    >
      <div className="flex items-start justify-between">
        <AppLogo item={item} size={size} />
        {item.isNew && (
          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold text-brand-700">New</span>
        )}
      </div>
      <div className="flex-1">
        <p className="text-base font-bold tracking-tight text-ink-900">{item.title}</p>
        <p className="mt-1 text-sm leading-relaxed text-ink-500">{item.description}</p>
      </div>
      <span className="flex items-center gap-1 text-sm font-semibold text-brand-700 opacity-0 transition group-hover:opacity-100">
        Open <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  )
}

export default function Hub() {
  const { profile, orgName, isAdmin } = useAuth()
  const systemTiles = SYSTEM.filter((t) => !t.adminOnly || isAdmin)

  return (
    <div>
      {/* Hero */}
      <div className="mb-8 flex items-center gap-4">
        <img src="/wehs.svg" alt="" className="h-16 w-16 rounded-2xl drop-shadow" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">
            WEHS — Workplace Environment, Health &amp; Safety
          </h1>
          <p className="text-sm text-ink-500">
            {orgName ? `${orgName} · ` : ''}
            {profile?.name ? `Welcome, ${profile.name.split(' ')[0]}. ` : ''}
            Choose a module to open.
          </p>
        </div>
      </div>

      {/* Modules */}
      <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-ink-400">Modules</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {MODULES.map((m, i) => (
          <Tile key={m.key} item={m} i={i} />
        ))}
      </div>

      {/* Workspace & administration */}
      <h2 className="mb-3 mt-9 text-xs font-bold uppercase tracking-widest text-ink-400">
        Workspace &amp; Administration
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {systemTiles.map((t, i) => (
          <Tile key={t.key} item={t} i={i} size="md" />
        ))}
      </div>
    </div>
  )
}

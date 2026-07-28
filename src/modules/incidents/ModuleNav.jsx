import { NavLink } from 'react-router-dom'
import { AlertTriangle, Stethoscope, HeartPulse, ListChecks, Trash2 } from 'lucide-react'
import { useAuth } from './context/AuthContext'

const TABS = [
  { to: '/incidents', label: 'Incidents', icon: AlertTriangle, end: true },
  { to: '/incidents/illness', label: 'Illnesses', icon: Stethoscope },
  { to: '/incidents/injuries', label: 'Injuries', icon: HeartPulse },
  { to: '/incidents/actions', label: 'Actions', icon: ListChecks },
]

// Secondary nav for the Incidents module (the original app's Layout tabs).
export default function ModuleNav() {
  const { isAdmin } = useAuth()
  const tabs = isAdmin ? [...TABS, { to: '/incidents/recycle', label: 'Recycle Bin', icon: Trash2 }] : TABS
  return (
    <div className="mb-5 flex flex-wrap gap-1.5 border-b border-ink-100 pb-3">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            [
              'inline-flex items-center gap-2 rounded-2xl px-3.5 py-2 text-sm font-medium transition-all duration-200 ease-emil',
              isActive
                ? 'bg-clay-surface text-ink-900 shadow-clay-pressed'
                : 'text-ink-500 hover:bg-clay-100 hover:text-ink-800 active:scale-[0.98]',
            ].join(' ')
          }
        >
          <t.icon size={16} />
          {t.label}
        </NavLink>
      ))}
    </div>
  )
}

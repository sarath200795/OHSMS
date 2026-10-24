import { NavLink } from 'react-router-dom'
import { AlertTriangle, ClipboardCheck, MapPin, QrCode, Wrench } from 'lucide-react'

// The phone's primary navigation. Desktop keeps the portal: this bar is
// rendered only below the `md` breakpoint, from AppChrome.
const ITEMS = [
  { to: '/field/scan', label: 'Scan QR', icon: QrCode },
  { to: '/field/tasks', label: 'My tasks and inspections', short: 'Tasks', icon: ClipboardCheck },
  { to: '/portal/report', label: 'Report incident', short: 'Report', icon: AlertTriangle },
  { to: '/equipment/defects', label: 'Defects', icon: Wrench },
  { to: '/sites', label: 'Sites', icon: MapPin },
]

export default function FieldNav() {
  return (
    <nav
      aria-label="Field"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-white/95 pb-[max(0.25rem,env(safe-area-inset-bottom))] backdrop-blur-xl print:hidden"
    >
      <ul className="mx-auto flex max-w-lg items-stretch">
        {ITEMS.map((item) => (
          <li key={item.to} className="flex flex-1">
            <NavLink
              to={item.to}
              end
              aria-label={item.label}
              className={({ isActive }) =>
                `flex min-h-14 w-full flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-400 ${
                  isActive ? 'text-brand-700' : 'text-ink-500'
                }`
              }
            >
              <item.icon size={22} aria-hidden="true" />
              <span aria-hidden="true">{item.short || item.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

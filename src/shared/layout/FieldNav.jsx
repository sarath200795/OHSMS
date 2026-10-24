import { NavLink } from 'react-router-dom'
import { AlertTriangle, Bell, ClipboardCheck, QrCode, Wrench } from 'lucide-react'
import { useAlertUnread } from '../mobile/alertContext'

// The phone's primary navigation. Desktop keeps the portal: this bar is
// rendered only below the `md` breakpoint, from AppChrome.
//
// The five labels are the product's phone navigation. Sites and the module
// registers live on the home grid; this bar is the jobs that are not a module.
const ITEMS = [
  { to: '/field/scan', label: 'QR Scan', icon: QrCode },
  { to: '/field/tasks', label: 'Tasks', icon: ClipboardCheck },
  { to: '/portal/report', label: 'Report', icon: AlertTriangle },
  { to: '/equipment/defects', label: 'Defects', icon: Wrench },
  { to: '/field/alerts', label: 'Alerts', icon: Bell },
]

export default function FieldNav() {
  const unread = useAlertUnread()
  return (
    <nav
      aria-label="Field"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-white/95 pb-[max(0.25rem,env(safe-area-inset-bottom))] backdrop-blur-xl print:hidden"
    >
      <ul className="mx-auto flex max-w-lg items-stretch">
        {ITEMS.map((item) => {
          const badge = item.to === '/field/alerts' && unread > 0
          const name = badge ? `Alerts, ${unread} unread` : item.label
          return (
            <li key={item.to} className="flex flex-1">
              <NavLink
                to={item.to}
                end
                aria-label={name}
                className={({ isActive }) =>
                  `relative flex min-h-14 w-full flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-400 ${
                    isActive ? 'text-brand-700' : 'text-ink-500'
                  }`
                }
              >
                <item.icon size={22} aria-hidden="true" />
                {badge && (
                  <span
                    aria-hidden="true"
                    className="absolute right-[18%] top-1 grid min-h-[16px] min-w-[16px] place-items-center rounded-full bg-[#c43d32] px-1 text-[9px] font-bold leading-none text-white"
                  >
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
                <span aria-hidden="true">{item.label}</span>
              </NavLink>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

import { Link } from 'react-router-dom'
import { AlertTriangle, ClipboardCheck, MapPin, QrCode, Wrench } from 'lucide-react'

const ACTIONS = [
  {
    to: '/field/scan',
    label: 'Scan QR',
    detail: 'Extinguisher, AED or fire-alarm panel',
    icon: QrCode,
  },
  {
    to: '/field/tasks',
    label: 'My tasks',
    detail: 'Actions and inspections waiting on you',
    icon: ClipboardCheck,
  },
  {
    to: '/portal/report',
    label: 'Report incident',
    detail: 'What you saw, in a few steps',
    icon: AlertTriangle,
  },
  {
    to: '/equipment/defects',
    label: 'Defects',
    detail: 'Open faults and closures',
    icon: Wrench,
  },
  {
    to: '/sites',
    label: 'Sites',
    detail: 'Locations you work at',
    icon: MapPin,
  },
]

/**
 * The phone home. Big targets, one job each.
 *
 * `titleAs` is h2 on the portal, which already has its own h1. Two h1s on
 * one screen is what a screen reader announces as two pages.
 */
export default function FieldLaunchpad({ titleAs: Title = 'h1' }) {
  return (
    <div>
      <Title className="text-[22px] font-extrabold tracking-[-0.02em] text-ink-900">On site</Title>
      <p className="mt-1 text-sm text-ink-500">Scan a label, or jump straight to the job.</p>
      <ul className="mt-4 grid gap-3">
        {ACTIONS.map((action) => (
          <li key={action.to}>
            <Link
              to={action.to}
              className="flex min-h-[4.5rem] items-center gap-3 rounded-3xl bg-white px-4 py-3 shadow-elev-sm ring-1 ring-ink-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              <span className="grid h-12 w-12 flex-none place-items-center rounded-2xl bg-brand-600 text-white">
                <action.icon size={22} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-[16px] font-bold text-ink-900">{action.label}</span>
                <span className="block text-[13px] text-ink-500">{action.detail}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

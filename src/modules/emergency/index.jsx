import { Routes, Route, Navigate, Outlet, NavLink } from 'react-router-dom'
import { PhoneCall, Map } from 'lucide-react'
import Contacts from './pages/Contacts'
import SiteFerp from './pages/SiteFerp'

// Emergency Response (FERP) — the who-to-call directory (external services +
// internal escalation chain) and per-site FERP views with evacuation layouts.
const TABS = [
  { to: '/emergency-response', label: 'Contacts', icon: PhoneCall, end: true },
  { to: '/emergency-response/sites', label: 'Site FERP', icon: Map },
]

function Layout() {
  return (
    <>
      <div className="mb-5 flex flex-wrap gap-1.5 border-b border-ink-100 pb-3 print:hidden">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition ${
                isActive ? 'bg-brand-600 text-white shadow-clay-brand' : 'text-ink-500 hover:bg-clay-100 hover:text-ink-800'
              }`
            }
          >
            <t.icon size={15} /> {t.label}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </>
  )
}

export default function EmergencyModule() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Contacts />} />
        <Route path="sites" element={<SiteFerp />} />
      </Route>
      <Route path="*" element={<Navigate to="/emergency-response" replace />} />
    </Routes>
  )
}

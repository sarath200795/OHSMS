import { Routes, Route, Navigate, Outlet, NavLink, useLocation } from 'react-router-dom'
import { PhoneCall, Building2 } from 'lucide-react'
import Contacts from './pages/Contacts'
import SiteRepository from './pages/SiteRepository'
import SiteDetail from './pages/SiteDetail'

// Emergency Response (FERP):
//  • Contacts   — org-wide directory (external services + internal escalation)
//  • Sites      — per-site repository: contacts, FERP plan, scenario rescue plans
const TABS = [
  { to: '/emergency-response', label: 'Contacts', icon: PhoneCall, end: true },
  { to: '/emergency-response/sites', label: 'Site Repository', icon: Building2 },
]

function Layout() {
  const { pathname } = useLocation()
  // Keep the Site Repository tab active on the per-site detail route too.
  const isSites = pathname.startsWith('/emergency-response/sites')
  return (
    <>
      <div className="mb-5 flex flex-wrap gap-1.5 border-b border-ink-100 pb-3 print:hidden">
        {TABS.map((t) => {
          const active = t.end ? !isSites : isSites
          return (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition ${
                active ? 'bg-brand-600 text-white shadow-clay-brand' : 'text-ink-500 hover:bg-clay-100 hover:text-ink-800'
              }`}
            >
              <t.icon size={15} /> {t.label}
            </NavLink>
          )
        })}
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
        <Route path="sites" element={<SiteRepository />} />
        <Route path="sites/:siteId" element={<SiteDetail />} />
      </Route>
      <Route path="*" element={<Navigate to="/emergency-response" replace />} />
    </Routes>
  )
}

import { Routes, Route, Navigate, Outlet, NavLink, useLocation } from 'react-router-dom'
import { Building2, Library } from 'lucide-react'
import SiteRepository from './pages/SiteRepository'
import SiteDetail from './pages/SiteDetail'
import BaselinePlans from './pages/BaselinePlans'

// Emergency Response (FERP):
//  • Sites    — per-site repository: contacts, FERP plan, scenario rescue plans
//  • Baseline — org-wide rescue-plan library each site can recall and adapt
const TABS = [
  { to: '/emergency-response', label: 'Site Repository', icon: Building2, end: true },
  { to: '/emergency-response/baseline', label: 'Baseline Plans', icon: Library },
]

function Layout() {
  const { pathname } = useLocation()
  const isBaseline = pathname.startsWith('/emergency-response/baseline')
  return (
    <>
      <div className="mb-5 flex flex-wrap gap-1.5 border-b border-ink-100 pb-3 print:hidden">
        {TABS.map((t) => {
          const active = t.end ? !isBaseline : isBaseline
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
        <Route index element={<SiteRepository />} />
        <Route path="baseline" element={<BaselinePlans />} />
        <Route path="sites" element={<Navigate to="/emergency-response" replace />} />
        <Route path="sites/:siteId" element={<SiteDetail />} />
      </Route>
      <Route path="*" element={<Navigate to="/emergency-response" replace />} />
    </Routes>
  )
}

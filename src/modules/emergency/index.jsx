import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom'
import { Building2, Library } from 'lucide-react'
import SiteRepository from './pages/SiteRepository'
import SiteDetail from './pages/SiteDetail'
import BaselinePlans from './pages/BaselinePlans'
import ModuleTabs from '../../shared/layout/ModuleTabs'

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
      <ModuleTabs
        label="Emergency Response sections"
        tabs={[
          { ...TABS[0], active: !isBaseline },
          { ...TABS[1], active: isBaseline },
        ]}
      />
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

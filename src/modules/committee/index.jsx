import { Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { Users, BarChart3 } from 'lucide-react'
import ErrorBoundary from '../../shared/ErrorBoundary'
import Consultation from './pages/Consultation'
import Reports from './pages/Reports'
import ModuleTabs from '../../shared/layout/ModuleTabs'
import { reportsNavTab } from '../../shared/modules/reports'

const TABS = [
  { to: '/committee', label: 'Meetings', icon: Users, end: true },
  { ...reportsNavTab('/committee'), icon: BarChart3 },
]

function Layout() {
  return (
    <>
      <ModuleTabs label="HSE Committee sections" tabs={TABS} />
      <Outlet />
    </>
  )
}

// HSE Committee Meetings (ported from hse-committee-meeting), mounted at /committee.
export default function CommitteeModule() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Consultation />} />
          <Route path="reports" element={<Reports />} />
        </Route>
        <Route path="*" element={<Navigate to="/committee" replace />} />
      </Routes>
    </ErrorBoundary>
  )
}

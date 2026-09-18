import { Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { Gauge, Target, BarChart3 } from 'lucide-react'
import { ObjectivesProvider } from './context/ObjectivesContext'
import Scorecard from './pages/Scorecard'
import Targets from './pages/Targets'
import Reports from './pages/Reports'
import ModuleTabs from '../../shared/layout/ModuleTabs'
import { reportsNavTab } from '../../shared/modules/reports'

// Objectives & Targets — OH&S KPI scorecard. Targets are entered here; actuals
// are computed live from the modules that own the data.
const TABS = [
  { to: '/objectives', label: 'Scorecard', icon: Gauge, end: true },
  { to: '/objectives/targets', label: 'Targets', icon: Target },
  { ...reportsNavTab('/objectives'), icon: BarChart3 },
]

function Layout() {
  return (
    <>
      <ModuleTabs label="Objectives sections" tabs={TABS} />
      <Outlet />
    </>
  )
}

export default function ObjectivesModule() {
  return (
    <ObjectivesProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Scorecard />} />
          <Route path="targets" element={<Targets />} />
          <Route path="reports" element={<Reports />} />
        </Route>
        <Route path="*" element={<Navigate to="/objectives" replace />} />
      </Routes>
    </ObjectivesProvider>
  )
}

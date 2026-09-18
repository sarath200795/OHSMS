import { Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { ListChecks, BarChart3 } from 'lucide-react'
import ActionTracker from './ActionTracker'
import Reports from './pages/Reports'
import ModuleTabs from '../../shared/layout/ModuleTabs'
import { reportsNavTab } from '../../shared/modules/reports'

const TABS = [
  { to: '/actions', label: 'Tracker', icon: ListChecks, end: true },
  { ...reportsNavTab('/actions'), icon: BarChart3 },
]

function Layout() {
  return (
    <>
      <ModuleTabs label="Action Tracker sections" tabs={TABS} />
      <Outlet />
    </>
  )
}

// Central Action Tracker — aggregates CAPA / action items from every module
// (incidents, illness, risk assessment, committee) into one place, with status
// updates that write back to the originating record. Mounted at /actions.
export default function ActionsModule() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<ActionTracker />} />
        <Route path="reports" element={<Reports />} />
      </Route>
      <Route path="*" element={<Navigate to="/actions" replace />} />
    </Routes>
  )
}

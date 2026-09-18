import { Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { ClipboardList, BarChart3 } from 'lucide-react'
import { FleetProvider } from './context/FleetContext'
import MockDrills from './pages/MockDrills'
import DrillsReports from './pages/DrillsReports'
import ModuleTabs from '../../shared/layout/ModuleTabs'
import { reportsNavTab } from '../../shared/modules/reports'

const TABS = [
  { to: '/mock-drills', label: 'Log', icon: ClipboardList, end: true },
  { ...reportsNavTab('/mock-drills'), icon: BarChart3 },
]

function Layout() {
  return (
    <>
      <ModuleTabs label="Mock Drills sections" tabs={TABS} />
      <Outlet />
    </>
  )
}

// Mock Drills (split out of fire-marshal): log fire drills & real emergencies,
// run scenario checklists, record teams/commanders and generate scored reports.
// Mounted at /mock-drills; shares the fire-marshal Fleet data context.
export default function DrillsModule() {
  return (
    <FleetProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<MockDrills />} />
          <Route path="reports" element={<DrillsReports />} />
        </Route>
        <Route path="*" element={<Navigate to="/mock-drills" replace />} />
      </Routes>
    </FleetProvider>
  )
}

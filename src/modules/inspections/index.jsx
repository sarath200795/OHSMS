import { Routes, Route, Navigate, Outlet } from 'react-router-dom'
import {
  CalendarClock,
  AlarmClock,
  ClipboardList,
  PlayCircle,
  FileStack,
  BarChart3,
} from 'lucide-react'
import { DataProvider } from './context/DataContext'
import Schedule from './pages/Schedule'
import Overdue from './pages/Overdue'
import Forms from './pages/Forms'
import FormBuilder from './pages/FormBuilder'
import Execute from './pages/Execute'
import Records from './pages/Records'
import Reports from './pages/Reports'
import ModuleTabs from '../../shared/layout/ModuleTabs'
import { reportsNavTab } from '../../shared/modules/reports'

const TABS = [
  { to: '/inspections', label: 'Schedule', icon: CalendarClock, end: true },
  { to: '/inspections/overdue', label: 'Overdue', icon: AlarmClock },
  { to: '/inspections/forms', label: 'Checklists', icon: ClipboardList },
  { to: '/inspections/execute', label: 'Execute', icon: PlayCircle },
  { to: '/inspections/records', label: 'Records', icon: FileStack },
  { ...reportsNavTab('/inspections'), icon: BarChart3 },
]

function ModuleNav() {
  return <ModuleTabs label="Inspections sections" tabs={TABS} />
}

function ListLayout() {
  return (
    <>
      <ModuleNav />
      <Outlet />
    </>
  )
}

// Inspections (ported from inspections-portal), mounted at /inspections.
export default function InspectionsModule() {
  return (
    <DataProvider>
      <Routes>
        <Route element={<ListLayout />}>
          <Route index element={<Schedule />} />
          <Route path="schedule" element={<Schedule />} />
          <Route path="overdue" element={<Overdue />} />
          <Route path="forms" element={<Forms />} />
          <Route path="execute" element={<Execute />} />
          <Route path="records" element={<Records />} />
          <Route path="reports" element={<Reports />} />
        </Route>
        <Route path="forms/new" element={<FormBuilder />} />
        <Route path="forms/:id/edit" element={<FormBuilder />} />
        <Route path="*" element={<Navigate to="/inspections" replace />} />
      </Routes>
    </DataProvider>
  )
}

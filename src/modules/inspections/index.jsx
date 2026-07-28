import { Routes, Route, Navigate, Outlet, NavLink } from 'react-router-dom'
import { CalendarClock, AlarmClock, ClipboardList, PlayCircle, FileStack } from 'lucide-react'
import { DataProvider } from './context/DataContext'
import Schedule from './pages/Schedule'
import Overdue from './pages/Overdue'
import Forms from './pages/Forms'
import FormBuilder from './pages/FormBuilder'
import Execute from './pages/Execute'
import Records from './pages/Records'

const TABS = [
  { to: '/inspections', label: 'Schedule', icon: CalendarClock, end: true },
  { to: '/inspections/overdue', label: 'Overdue', icon: AlarmClock },
  { to: '/inspections/forms', label: 'Checklists', icon: ClipboardList },
  { to: '/inspections/execute', label: 'Execute', icon: PlayCircle },
  { to: '/inspections/records', label: 'Records', icon: FileStack },
]

function ModuleNav() {
  return (
    <div className="mb-5 flex flex-wrap gap-1.5 border-b border-ink-100 pb-3">
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            [
              'inline-flex items-center gap-2 rounded-2xl px-3.5 py-2 text-sm font-medium transition-all duration-200 ease-emil',
              isActive
                ? 'bg-clay-surface text-ink-900 shadow-clay-pressed'
                : 'text-ink-500 hover:bg-clay-100 hover:text-ink-800 active:scale-[0.98]',
            ].join(' ')
          }
        >
          <t.icon size={16} />
          {t.label}
        </NavLink>
      ))}
    </div>
  )
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
        </Route>
        <Route path="forms/new" element={<FormBuilder />} />
        <Route path="forms/:id/edit" element={<FormBuilder />} />
        <Route path="*" element={<Navigate to="/inspections" replace />} />
      </Routes>
    </DataProvider>
  )
}

import { Routes, Route, Navigate, Outlet, NavLink } from 'react-router-dom'
import { Library, Layers, Grid3x3, ListChecks, Upload } from 'lucide-react'
import { RaProvider } from './context/RaContext'
import Repository from './pages/Repository'
import BaselineRepository from './pages/BaselineRepository'
import CreateAssessment from './pages/CreateAssessment'
import AssessmentView from './pages/AssessmentView'
import RiskRegister from './pages/RiskRegister'
import ActionTracker from './pages/ActionTracker'
import BulkImport from './pages/BulkImport'

const TABS = [
  { to: '/hira', label: 'Assessments', icon: Library, end: true },
  { to: '/hira/baselines', label: 'Baselines', icon: Layers },
  { to: '/hira/risk-register', label: 'Risk Register', icon: Grid3x3 },
  { to: '/hira/action-tracker', label: 'Action Tracker', icon: ListChecks },
  { to: '/hira/bulk-import', label: 'Bulk Import', icon: Upload },
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

// Hazard Identification & Risk Assessment (ported from hira), mounted at /hira.
export default function HiraModule() {
  return (
    <RaProvider>
      <Routes>
        <Route element={<ListLayout />}>
          <Route index element={<Repository />} />
          <Route path="repository" element={<Repository />} />
          <Route path="baselines" element={<BaselineRepository />} />
          <Route path="risk-register" element={<RiskRegister />} />
          <Route path="action-tracker" element={<ActionTracker />} />
          <Route path="bulk-import" element={<BulkImport />} />
        </Route>
        <Route path="create" element={<CreateAssessment />} />
        <Route path="create/:id" element={<CreateAssessment />} />
        <Route path="assessment/:id" element={<AssessmentView />} />
        <Route path="*" element={<Navigate to="/hira" replace />} />
      </Routes>
    </RaProvider>
  )
}

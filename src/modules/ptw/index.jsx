import { Routes, Route, Navigate, Outlet, NavLink } from 'react-router-dom'
import { FileCheck, Stamp, Eye } from 'lucide-react'
import { PermitProvider } from './context/PermitContext'
import Permits from './pages/Permits'
import PermitForm from './pages/PermitForm'
import PermitDetail from './pages/PermitDetail'
import Approvals from './pages/Approvals'
import Observations from './pages/Observations'

const TABS = [
  { to: '/permits', label: 'Permits', icon: FileCheck, end: true },
  { to: '/permits/approvals', label: 'Approvals', icon: Stamp },
  { to: '/permits/observations', label: 'Observations', icon: Eye },
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

// Permit to Work (ported from permit-to-work), mounted at /permits.
export default function PermitsModule() {
  return (
    <PermitProvider>
      <Routes>
        <Route element={<ListLayout />}>
          <Route index element={<Permits />} />
          <Route path="approvals" element={<Approvals />} />
          <Route path="observations" element={<Observations />} />
        </Route>
        <Route path="new" element={<PermitForm />} />
        <Route path=":id" element={<PermitDetail />} />
        <Route path="*" element={<Navigate to="/permits" replace />} />
      </Routes>
    </PermitProvider>
  )
}

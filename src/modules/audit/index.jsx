import { Routes, Route, Navigate, Outlet, NavLink } from 'react-router-dom'
import { FileSearch, AlertOctagon, Wrench } from 'lucide-react'
import { OrgDataProvider } from './context/OrgDataContext'
import InternalAudit from './pages/app/InternalAudit'
import FindingsRegister from './pages/app/FindingsRegister'
import CapaRegister from './pages/app/CapaRegister'

const TABS = [
  { to: '/audit', label: 'Audits', icon: FileSearch, end: true },
  { to: '/audit/findings', label: 'Findings', icon: AlertOctagon },
  { to: '/audit/capa', label: 'CAPA', icon: Wrench },
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

// Internal Audit (ported from internal-audit-portal), mounted at /audit.
export default function AuditModule() {
  return (
    <OrgDataProvider>
      <Routes>
        <Route element={<ListLayout />}>
          <Route index element={<InternalAudit />} />
          <Route path="findings" element={<FindingsRegister />} />
          <Route path="capa" element={<CapaRegister />} />
        </Route>
        <Route path="*" element={<Navigate to="/audit" replace />} />
      </Routes>
    </OrgDataProvider>
  )
}

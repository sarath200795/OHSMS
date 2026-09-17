import { Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { FileSearch, AlertOctagon, Wrench } from 'lucide-react'
import { OrgDataProvider } from './context/OrgDataContext'
import InternalAudit from './pages/app/InternalAudit'
import FindingsRegister from './pages/app/FindingsRegister'
import CapaRegister from './pages/app/CapaRegister'
import ModuleTabs from '../../shared/layout/ModuleTabs'

const TABS = [
  { to: '/audit', label: 'Audits', icon: FileSearch, end: true },
  { to: '/audit/findings', label: 'Findings', icon: AlertOctagon },
  { to: '/audit/capa', label: 'CAPA', icon: Wrench },
]

function ModuleNav() {
  return <ModuleTabs label="Internal Audit sections" tabs={TABS} />
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

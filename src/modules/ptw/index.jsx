import { Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { FileCheck, Stamp, Eye, BarChart3 } from 'lucide-react'
import { PermitProvider } from './context/PermitContext'
import Permits from './pages/Permits'
import PermitForm from './pages/PermitForm'
import PermitDetail from './pages/PermitDetail'
import Approvals from './pages/Approvals'
import Observations from './pages/Observations'
import Reports from './pages/Reports'
import ModuleTabs from '../../shared/layout/ModuleTabs'
import { reportsNavTab } from '../../shared/modules/reports'

const TABS = [
  { to: '/permits', label: 'Permits', icon: FileCheck, end: true },
  { to: '/permits/approvals', label: 'Approvals', icon: Stamp },
  { to: '/permits/observations', label: 'Observations', icon: Eye },
  { ...reportsNavTab('/permits'), icon: BarChart3 },
]

function ModuleNav() {
  return <ModuleTabs label="Permit to Work sections" tabs={TABS} />
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
          <Route path="reports" element={<Reports />} />
        </Route>
        <Route path="new" element={<PermitForm />} />
        <Route path=":id" element={<PermitDetail />} />
        <Route path="*" element={<Navigate to="/permits" replace />} />
      </Routes>
    </PermitProvider>
  )
}

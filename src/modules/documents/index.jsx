import { Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { FolderOpen, BarChart3 } from 'lucide-react'
import ModuleTabs from '../../shared/layout/ModuleTabs'
import { reportsNavTab } from '../../shared/modules/reports'
import Library from './Library'
import Reports from './pages/Reports'

const TABS = [
  { to: '/documents', label: 'Library', icon: FolderOpen, end: true },
  { ...reportsNavTab('/documents'), icon: BarChart3 },
]

function Layout() {
  return (
    <>
      <ModuleTabs label="Documents sections" tabs={TABS} />
      <Outlet />
    </>
  )
}

export default function DocumentsModule() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Library />} />
        <Route path="reports" element={<Reports />} />
      </Route>
      <Route path="*" element={<Navigate to="/documents" replace />} />
    </Routes>
  )
}

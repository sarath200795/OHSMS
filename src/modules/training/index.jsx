import { Routes, Route, Navigate, Outlet } from 'react-router-dom'
import {
  LayoutDashboard,
  BookOpen,
  BookOpenCheck,
  GraduationCap,
  UsersRound,
  ClipboardList,
  CalendarClock,
  BarChart3,
} from 'lucide-react'
import { useAuth } from '../../shared/auth/AuthContext'
import { TrainingProvider } from './context/TrainingContext'
import Dashboard from './pages/Dashboard'
import MyLearning from './pages/MyLearning'
import Courses from './pages/Courses'
import Records from './pages/Records'
import EmployeeStatus from './pages/EmployeeStatus'
import AdminWorkspace from './pages/AdminWorkspace'
import Sessions from './pages/Sessions'
import Reports from './pages/Reports'
import ModuleTabs from '../../shared/layout/ModuleTabs'
import { reportsNavTab } from '../../shared/modules/reports'

const TABS = [
  { to: '/training', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/training/my', label: 'My Learning', icon: BookOpenCheck },
  { to: '/training/courses', label: 'Courses', icon: BookOpen },
  { to: '/training/sessions', label: 'Sessions', icon: CalendarClock },
  { to: '/training/records', label: 'Records', icon: GraduationCap },
  { to: '/training/employees', label: 'Employee Status', icon: UsersRound },
  { to: '/training/admin', label: 'Admin Workspace', icon: ClipboardList, managerOnly: true },
  { ...reportsNavTab('/training'), icon: BarChart3 },
]

function ModuleNav() {
  const { isManager } = useAuth()
  return (
    <ModuleTabs label="Training sections" tabs={TABS.filter((t) => !t.managerOnly || isManager)} />
  )
}

function Layout() {
  return (
    <>
      <ModuleNav />
      <Outlet />
    </>
  )
}

// Training & Certifications — course catalogue, per-employee training records
// with automatic expiry, compliance dashboard and the employee × course matrix.
export default function TrainingModule() {
  return (
    <TrainingProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="my" element={<MyLearning />} />
          <Route path="courses" element={<Courses />} />
          <Route path="sessions" element={<Sessions />} />
          <Route path="records" element={<Records />} />
          <Route path="employees" element={<EmployeeStatus />} />
          <Route path="admin" element={<AdminWorkspace />} />
          <Route path="reports" element={<Reports />} />
          <Route path="matrix" element={<Navigate to="/training/employees" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/training" replace />} />
      </Routes>
    </TrainingProvider>
  )
}

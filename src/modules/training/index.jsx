import { Routes, Route, Navigate, Outlet, NavLink } from 'react-router-dom'
import { LayoutDashboard, BookOpen, BookOpenCheck, GraduationCap, UsersRound, ClipboardList } from 'lucide-react'
import { useAuth } from '../../shared/auth/AuthContext'
import { TrainingProvider } from './context/TrainingContext'
import Dashboard from './pages/Dashboard'
import MyLearning from './pages/MyLearning'
import Courses from './pages/Courses'
import Records from './pages/Records'
import EmployeeStatus from './pages/EmployeeStatus'
import AdminWorkspace from './pages/AdminWorkspace'

const TABS = [
  { to: '/training', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/training/my', label: 'My Learning', icon: BookOpenCheck },
  { to: '/training/courses', label: 'Courses', icon: BookOpen },
  { to: '/training/records', label: 'Records', icon: GraduationCap },
  { to: '/training/employees', label: 'Employee Status', icon: UsersRound },
  { to: '/training/admin', label: 'Admin Workspace', icon: ClipboardList, managerOnly: true },
]

function ModuleNav() {
  const { isManager } = useAuth()
  return (
    <div className="mb-5 flex flex-wrap gap-1.5 border-b border-ink-100 pb-3">
      {TABS.filter((t) => !t.managerOnly || isManager).map((t) => (
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
          <Route path="records" element={<Records />} />
          <Route path="employees" element={<EmployeeStatus />} />
          <Route path="admin" element={<AdminWorkspace />} />
          <Route path="matrix" element={<Navigate to="/training/employees" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/training" replace />} />
      </Routes>
    </TrainingProvider>
  )
}

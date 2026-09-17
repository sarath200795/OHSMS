import { Routes, Route, Navigate, Outlet } from 'react-router-dom'
import {
  Home as HomeIcon,
  ListChecks,
  ClipboardList,
  PlayCircle,
  HardHat,
  Lock,
} from 'lucide-react'
import { TutorialProvider } from './context/TutorialContext'
import Home from './pages/Home'
import Inventory from './pages/procedures/Inventory'
import Register from './pages/procedures/Register'
import CreateProcedure from './pages/procedures/CreateProcedure'
import ProcedureDetail from './pages/procedures/ProcedureDetail'
import Operations from './pages/operations/Operations'
import OperateProcedure from './pages/operations/OperateProcedure'
import Technicians from './pages/admin/Technicians'
import LockInventory from './pages/admin/LockInventory'
import ModuleTabs from '../../shared/layout/ModuleTabs'

const TABS = [
  { to: '/loto', label: 'Home', icon: HomeIcon, end: true },
  { to: '/loto/inventory', label: 'Procedures', icon: ListChecks },
  { to: '/loto/register', label: 'Register', icon: ClipboardList },
  { to: '/loto/operations', label: 'Operations', icon: PlayCircle },
  { to: '/loto/technicians', label: 'Technicians', icon: HardHat },
  { to: '/loto/locks', label: 'Locks', icon: Lock },
]

function ModuleNav() {
  return <ModuleTabs label="Lockout / Tagout sections" tabs={TABS} />
}

function ListLayout() {
  return (
    <>
      <ModuleNav />
      <Outlet />
    </>
  )
}

// Lockout / Tagout — Hazardous Energy Control (ported from hecp-loto), at /loto.
export default function LotoModule() {
  return (
    <TutorialProvider>
      <Routes>
        <Route element={<ListLayout />}>
          <Route index element={<Home />} />
          <Route path="inventory" element={<Inventory />} />
          <Route path="register" element={<Register />} />
          <Route path="operations" element={<Operations />} />
          <Route path="technicians" element={<Technicians />} />
          <Route path="locks" element={<LockInventory />} />
        </Route>
        <Route path="operations/:id" element={<OperateProcedure />} />
        <Route path="procedures/new" element={<CreateProcedure />} />
        <Route path="procedures/:id/revise" element={<CreateProcedure />} />
        <Route path="procedures/:id" element={<ProcedureDetail />} />
        <Route path="*" element={<Navigate to="/loto" replace />} />
      </Routes>
    </TutorialProvider>
  )
}

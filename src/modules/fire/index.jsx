import { Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { LayoutDashboard, Boxes, Wrench, Stamp, MapPin } from 'lucide-react'
import { FleetProvider } from './context/FleetContext'
import EquipmentHub from './EquipmentHub'
import EquipmentRepository from './EquipmentRepository'
import DefectRepository from './DefectRepository'
import Dashboard from './pages/Dashboard'
import Repository from './pages/Repository'
import Signages from './pages/Signages'
import LinkedSites from './pages/LinkedSites'
import AEDRepository from './pages/AEDRepository'
import AEDDashboard from './pages/AEDDashboard'
import FASRepository from './pages/FASRepository'
import FASDashboard from './pages/FASDashboard'
import SignageDashboard from './pages/SignageDashboard'
import Stretchers from './pages/Stretchers'
import StretcherDashboard from './pages/StretcherDashboard'
import FirstAid from './pages/FirstAid'
import FirstAidDashboard from './pages/FirstAidDashboard'
import AssetBulkUpload from './pages/AssetBulkUpload'
import AssetsDue from './pages/AssetsDue'
import AddExtinguisher from './pages/AddExtinguisher'
import BulkUpload from './pages/BulkUpload'
import QRPrint from './pages/QRPrint'
import RefillDue from './pages/RefillDue'
import InProcess from './pages/InProcess'
import PhysicalDefects from './pages/PhysicalDefects'
import PhysicalDefectLog from './pages/PhysicalDefectLog'
import Closed from './pages/Closed'
import Approvals from './pages/Approvals'
import RecycleBin from './pages/RecycleBin'
import ModuleTabs from '../../shared/layout/ModuleTabs'

// Dashboard = per-type dashboards (EquipmentHub tabs, kept separate).
// Repository = one consolidated inventory for every equipment class.
// Defects    = one common defect repository, closeable from there.
const TABS = [
  { to: '/equipment', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/equipment/repository', label: 'Repository', icon: Boxes },
  { to: '/equipment/defects', label: 'Defects', icon: Wrench },
  { to: '/equipment/sites', label: 'Sites', icon: MapPin },
  { to: '/equipment/approvals', label: 'Approvals', icon: Stamp },
]

function ModuleNav() {
  return <ModuleTabs label="Emergency Equipment sections" tabs={TABS} />
}

function ListLayout() {
  return (
    <>
      <ModuleNav />
      <Outlet />
    </>
  )
}

// Emergency Equipment Inventory (from fire-marshal): fire extinguishers, AED,
// fire-alarm systems, signages, stretchers, first aid boxes and their
// inspection/approval lifecycle. Mounted at /equipment. Mock Drills is now a
// separate module (see DrillsModule).
export default function EquipmentModule() {
  return (
    <FleetProvider>
      <Routes>
        <Route element={<ListLayout />}>
          <Route index element={<EquipmentHub />} />
          <Route path="dashboard" element={<EquipmentHub />} />
          <Route path="ext-dashboard" element={<Dashboard />} />
          <Route path="repository" element={<EquipmentRepository />} />
          <Route path="extinguishers" element={<Repository />} />
          <Route path="defects" element={<DefectRepository />} />
          <Route path="signages" element={<Signages />} />
          <Route path="signage-dashboard" element={<SignageDashboard />} />
          <Route path="sites" element={<LinkedSites />} />
          <Route path="aed" element={<AEDRepository />} />
          <Route path="aed-dashboard" element={<AEDDashboard />} />
          <Route path="fas" element={<FASRepository />} />
          <Route path="fas-dashboard" element={<FASDashboard />} />
          <Route path="stretchers" element={<Stretchers />} />
          <Route path="stretcher-dashboard" element={<StretcherDashboard />} />
          <Route path="first-aid" element={<FirstAid />} />
          <Route path="first-aid-dashboard" element={<FirstAidDashboard />} />
          <Route path="assets-due" element={<AssetsDue />} />
          <Route path="refill-due" element={<RefillDue />} />
          <Route path="in-process" element={<InProcess />} />
          <Route path="physical-defects" element={<PhysicalDefects />} />
          <Route path="physical-open" element={<PhysicalDefectLog mode="open" />} />
          <Route path="physical-closed" element={<PhysicalDefectLog mode="closed" />} />
          <Route path="closed" element={<Closed />} />
          <Route path="approvals" element={<Approvals />} />
          <Route path="recycle" element={<RecycleBin />} />
        </Route>
        <Route path="add" element={<AddExtinguisher />} />
        <Route path="bulk-upload" element={<BulkUpload />} />
        <Route path="asset-bulk-upload" element={<AssetBulkUpload />} />
        <Route path="qr-print" element={<QRPrint />} />
        <Route path="*" element={<Navigate to="/equipment" replace />} />
      </Routes>
    </FleetProvider>
  )
}

import { Routes, Route, Navigate, NavLink } from 'react-router-dom'
import { Activity, List, TriangleAlert } from 'lucide-react'
import { CctvProvider } from './context/CctvContext'
import Dashboard from './pages/Dashboard'
import Inventory from './pages/Inventory'
import Defects from './pages/Defects'

// CCTV — an inventory of cameras, DVRs and Meraki devices, and the health that
// falls out of how they are wired together. The module's whole reason for
// existing is the cascade: a camera that stops answering is usually not the
// broken thing, and reporting it as one sends technicians to the wrong place.
const TABS = [
  { to: '/cctv', end: true, label: 'Health', icon: Activity },
  { to: '/cctv/inventory', label: 'Inventory', icon: List },
  { to: '/cctv/defects', label: 'Defects', icon: TriangleAlert },
]

export default function CctvModule() {
  return (
    <CctvProvider>
      <nav className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold transition ${
                isActive ? 'bg-ink-900 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
              }`
            }
          >
            <t.icon size={14} /> {t.label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<Dashboard />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="defects" element={<Defects />} />
        <Route path="*" element={<Navigate to="/cctv" replace />} />
      </Routes>
    </CctvProvider>
  )
}

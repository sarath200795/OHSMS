import { Routes, Route, Navigate, Outlet, NavLink } from 'react-router-dom'
import { Gauge, Target } from 'lucide-react'
import { ObjectivesProvider } from './context/ObjectivesContext'
import Scorecard from './pages/Scorecard'
import Targets from './pages/Targets'

// Objectives & Targets — OH&S KPI scorecard. Targets are entered here; actuals
// are computed live from the modules that own the data.
const TABS = [
  { to: '/objectives', label: 'Scorecard', icon: Gauge, end: true },
  { to: '/objectives/targets', label: 'Targets', icon: Target },
]

function Layout() {
  return (
    <>
      <div className="mb-5 flex flex-wrap gap-1.5 border-b border-ink-100 pb-3 print:hidden">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition ${
                isActive ? 'bg-brand-600 text-white shadow-clay-brand' : 'text-ink-500 hover:bg-clay-100 hover:text-ink-800'
              }`
            }
          >
            <t.icon size={15} /> {t.label}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </>
  )
}

export default function ObjectivesModule() {
  return (
    <ObjectivesProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Scorecard />} />
          <Route path="targets" element={<Targets />} />
        </Route>
        <Route path="*" element={<Navigate to="/objectives" replace />} />
      </Routes>
    </ObjectivesProvider>
  )
}

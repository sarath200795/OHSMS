import { Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { CloudSun, BarChart3 } from 'lucide-react'
import SiteWeather from './pages/SiteWeather'
import Reports from './pages/Reports'
import ModuleTabs from '../../shared/layout/ModuleTabs'
import { reportsNavTab } from '../../shared/modules/reports'

const TABS = [
  { to: '/weather', label: 'Sites', icon: CloudSun, end: true },
  { ...reportsNavTab('/weather'), icon: BarChart3 },
]

function Layout() {
  return (
    <>
      <ModuleTabs label="Weather Risk sections" tabs={TABS} />
      <Outlet />
    </>
  )
}

// Weather Risk — current conditions at every site, read as occupational risk
// rather than as a forecast. The same assessment drives the pin bubbles on the
// site map, which imports from this module's components.
export default function WeatherModule() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<SiteWeather />} />
        <Route path="reports" element={<Reports />} />
      </Route>
      <Route path="*" element={<Navigate to="/weather" replace />} />
    </Routes>
  )
}

import { Routes, Route, Navigate } from 'react-router-dom'
import SiteWeather from './pages/SiteWeather'

// Weather Risk — current conditions at every site, read as occupational risk
// rather than as a forecast. The same assessment drives the pin bubbles on the
// site map, which imports from this module's components.
export default function WeatherModule() {
  return (
    <Routes>
      <Route index element={<SiteWeather />} />
      <Route path="*" element={<Navigate to="/weather" replace />} />
    </Routes>
  )
}

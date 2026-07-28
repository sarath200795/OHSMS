import { Routes, Route, Navigate } from 'react-router-dom'
import SiteRepository from './pages/SiteRepository'
import SiteDetail from './pages/SiteDetail'

// Emergency Response (FERP) — a site-level repository. Each site holds its
// emergency contacts (external services mapped from the site's coordinates +
// the internal escalation chain), its FERP evacuation plan, and scenario
// rescue plans. Mounted at /emergency-response.
export default function EmergencyModule() {
  return (
    <Routes>
      <Route index element={<SiteRepository />} />
      <Route path="sites" element={<Navigate to="/emergency-response" replace />} />
      <Route path="sites/:siteId" element={<SiteDetail />} />
      <Route path="*" element={<Navigate to="/emergency-response" replace />} />
    </Routes>
  )
}

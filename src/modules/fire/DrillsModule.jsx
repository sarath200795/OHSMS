import { Routes, Route, Navigate } from 'react-router-dom'
import { FleetProvider } from './context/FleetContext'
import MockDrills from './pages/MockDrills'

// Mock Drills (split out of fire-marshal): log fire drills & real emergencies,
// run scenario checklists, record teams/commanders and generate scored reports.
// Mounted at /mock-drills; shares the fire-marshal Fleet data context.
export default function DrillsModule() {
  return (
    <FleetProvider>
      <Routes>
        <Route index element={<MockDrills />} />
        <Route path="*" element={<Navigate to="/mock-drills" replace />} />
      </Routes>
    </FleetProvider>
  )
}

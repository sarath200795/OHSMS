import { Routes, Route, Navigate } from 'react-router-dom'
import ActionTracker from './ActionTracker'

// Central Action Tracker — aggregates CAPA / action items from every module
// (incidents, illness, risk assessment, committee) into one place, with status
// updates that write back to the originating record. Mounted at /actions.
export default function ActionsModule() {
  return (
    <Routes>
      <Route index element={<ActionTracker />} />
      <Route path="*" element={<Navigate to="/actions" replace />} />
    </Routes>
  )
}

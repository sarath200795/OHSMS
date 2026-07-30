import { Routes, Route, Navigate } from 'react-router-dom'
import PortalLayout from './PortalLayout'
import PortalHome from './Home'
import ReportIncident from './ReportIncident'
import MyActions from './MyActions'
import MyTraining from './MyTraining'

export default function Portal() {
  return (
    <Routes>
      <Route element={<PortalLayout />}>
        <Route index element={<PortalHome />} />
        <Route path="report" element={<ReportIncident />} />
        <Route path="actions" element={<MyActions />} />
        <Route path="training" element={<MyTraining />} />
        <Route path="*" element={<Navigate to="/portal" replace />} />
      </Route>
    </Routes>
  )
}

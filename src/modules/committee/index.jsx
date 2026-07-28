import { Routes, Route, Navigate } from 'react-router-dom'
import ErrorBoundary from './components/ErrorBoundary'
import Consultation from './pages/Consultation'

// HSE Committee Meetings (ported from hse-committee-meeting), mounted at /committee.
export default function CommitteeModule() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route index element={<Consultation />} />
        <Route path="*" element={<Navigate to="/committee" replace />} />
      </Routes>
    </ErrorBoundary>
  )
}

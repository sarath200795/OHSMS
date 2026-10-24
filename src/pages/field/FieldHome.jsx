import { Navigate } from 'react-router-dom'
import FieldAppGrid from '../../shared/layout/FieldAppGrid'
import { useViewMode } from '../../shared/mobile/viewModeContext'

// /field is the phone home, and the installed icon opens it. Desktop view
// has nowhere to show that grid without hiding the portal the person just
// asked for, so this route steps aside.
export default function FieldHome() {
  const { mode } = useViewMode()
  if (mode === 'desktop') return <Navigate to="/portal" replace />
  return (
    <div className="mx-auto max-w-md">
      <FieldAppGrid />
    </div>
  )
}

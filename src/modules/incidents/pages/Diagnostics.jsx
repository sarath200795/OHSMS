import { Link } from 'react-router-dom'
import { ArrowLeft, Activity } from 'lucide-react'
import AuthShell from '../components/AuthShell'
import ConnectivityDiagnostics from '../components/ConnectivityDiagnostics'

/** Public connectivity self-check — reachable pre-auth at /diagnostics. */
export default function Diagnostics() {
  return (
    <AuthShell>
      <div className="mb-2 flex items-center gap-2 text-brand-600">
        <Activity size={20} />
        <h2 className="text-2xl font-extrabold tracking-tight text-ink-900">Connection check</h2>
      </div>
      <p className="mb-6 text-sm text-ink-500">
        If sign-in shows “Network error”, this checks whether your device can reach the sign-in
        service and database, and tells you what to fix.
      </p>

      <ConnectivityDiagnostics auto />

      <div className="mt-6 text-center text-sm">
        <Link to="/login" className="inline-flex items-center gap-1 font-semibold text-brand-600 hover:underline">
          <ArrowLeft size={14} /> Back to sign in
        </Link>
      </div>
    </AuthShell>
  )
}

import { Loader2 } from 'lucide-react'
import AuditLoader from '../AuditLoader'

export default function Spinner({ className = 'h-6 w-6' }) {
  return <Loader2 className={`animate-spin text-brand-500 ${className}`} />
}

export function FullPageSpinner({ label }) {
  return (
    <div className="grid min-h-screen place-items-center bg-[#eef2f8]">
      <AuditLoader label={label} />
    </div>
  )
}

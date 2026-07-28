import { Navigate } from 'react-router-dom'
import { Hourglass, RefreshCw } from 'lucide-react'
import { useAuth } from '../../shared/auth/AuthContext'
import { Button } from '../../shared/ui'
import AuthLayout from './AuthLayout'

export default function PendingApproval() {
  const { isAuthed, isApproved, orgName, refreshProfile, signOut } = useAuth()

  if (!isAuthed) return <Navigate to="/login" replace />
  if (isApproved) return <Navigate to="/dashboard" replace />

  return (
    <AuthLayout title="Awaiting approval" subtitle={orgName}>
      <div className="flex flex-col items-center gap-4 py-2 text-center">
        <span className="grid h-16 w-16 animate-pulse place-items-center rounded-2xl bg-amber-50 text-amber-600 shadow-clay-sm">
          <Hourglass size={30} />
        </span>
        <p className="text-sm text-ink-600">
          Your account has been created and is waiting for an administrator at{' '}
          <span className="font-semibold">{orgName}</span> to approve your access. You&apos;ll be able to
          sign in to the platform once approved.
        </p>
        <div className="flex w-full gap-2">
          <Button variant="soft" icon={RefreshCw} className="flex-1" onClick={() => refreshProfile()}>
            Check again
          </Button>
          <Button variant="ghost" className="flex-1" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </div>
    </AuthLayout>
  )
}

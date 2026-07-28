import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { MailCheck } from 'lucide-react'
import { useAuth } from '../../shared/auth/AuthContext'
import { authErrorMessage } from '../../shared/lib/authErrors'
import { Button, Field, Input } from '../../shared/ui'
import AuthLayout from './AuthLayout'

export default function ForgotPassword() {
  const { resetPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await resetPassword(email)
      setSent(true)
    } catch (err) {
      toast.error(authErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title="Reset password"
      subtitle="We'll email you a secure reset link"
      footer={
        <Link to="/login" className="font-semibold text-white underline-offset-2 hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-600 shadow-clay-sm">
            <MailCheck size={26} />
          </span>
          <p className="text-sm text-ink-600">
            If an account exists for <span className="font-semibold">{email}</span>, a reset link is on
            its way. Check your inbox (and the emulator UI / MailHog in local dev).
          </p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
          </Field>
          <Button type="submit" loading={busy} className="w-full">
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}

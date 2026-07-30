import { useState } from 'react'
import { Link, useNavigate, useLocation, Navigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '../../shared/auth/AuthContext'
import { authErrorMessage } from '../../shared/lib/authErrors'
import { Button, Field, Input } from '../../shared/ui'
import AuthLayout from './AuthLayout'

export default function Login() {
  const { login, isAuthed, profile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [form, setForm] = useState({ email: '', password: '' })
  const [busy, setBusy] = useState(false)

  // Only redirect once the profile has loaded — redirecting on isAuthed alone
  // races ProtectedRoute (which needs the profile) and causes a redirect loop.
  if (isAuthed && profile) return <Navigate to={location.state?.from?.pathname || '/portal'} replace />

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await login(form)
      toast.success('Welcome back')
      navigate('/portal', { replace: true })
    } catch (err) {
      toast.error(authErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Occupational Health & Safety Management System"
      footer={
        <>
          New organization?{' '}
          <Link to="/register-org" className="font-semibold text-white underline-offset-2 hover:underline">
            Register
          </Link>{' '}
          ·{' '}
          <Link to="/signup" className="font-semibold text-white underline-offset-2 hover:underline">
            Join an existing one
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email" htmlFor="email">
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="you@company.com"
          />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="••••••••"
          />
        </Field>
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-xs font-medium text-brand-700 hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" loading={busy} className="w-full">
          Sign in
        </Button>
      </form>
    </AuthLayout>
  )
}

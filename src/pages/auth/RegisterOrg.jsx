import { useState } from 'react'
import { Link, useNavigate, Navigate, useLocation } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '../../shared/auth/AuthContext'
import { authErrorMessage } from '../../shared/lib/authErrors'
import { continueToFromSearch, withContinueTo } from '../../shared/auth/continueTo'
import { Button, Field, Input } from '../../shared/ui'
import AuthLayout from './AuthLayout'
import { validatePassword } from '../../shared/auth/passwordPolicy'
import { useAppRole } from '../../app/AppRoleContext'
import CrossAppRedirect from '../../app/CrossAppRedirect'

export default function RegisterOrg() {
  const { registerOrganization, isAuthed, profile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { ownsPath, shellHref } = useAppRole()
  const next = continueToFromSearch(location.search)
  const [form, setForm] = useState({ orgName: '', address: '', name: '', email: '', password: '' })
  const [busy, setBusy] = useState(false)

  if (isAuthed && profile) {
    return ownsPath(next) ? <Navigate to={next} replace /> : <CrossAppRedirect to={next} />
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const submit = async (e) => {
    e.preventDefault()
    const pwError = validatePassword(form.password, { email: form.email, name: form.name })
    if (pwError) return toast.error(pwError)
    setBusy(true)
    try {
      await registerOrganization(form)
      toast.success('Organization created — welcome!')
      // A product-card register carries ?next=/equipment (etc.). New orgs seed
      // every module as a placeholder, so the destination is ModuleGate until
      // a suite is assigned — that is the locked screen, not a missing app.
      if (ownsPath(next)) navigate(next, { replace: true })
      else window.location.replace(shellHref(next))
    } catch (err) {
      toast.error(authErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title="Register your organization"
      subtitle="You'll become the first administrator"
      footer={
        <>
          Already have an account?{' '}
          <Link
            to={withContinueTo('/login', next)}
            className="font-semibold text-white underline-offset-2 hover:underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Organization name" htmlFor="orgName">
          <Input
            id="orgName"
            required
            value={form.orgName}
            onChange={set('orgName')}
            placeholder="Acme Manufacturing Ltd"
          />
        </Field>
        <Field label="Address" htmlFor="address" hint="Optional">
          <Input
            id="address"
            value={form.address}
            onChange={set('address')}
            placeholder="City, Country"
          />
        </Field>
        <div className="h-px bg-ink-100" />
        <Field label="Your name" htmlFor="name">
          <Input
            id="name"
            required
            value={form.name}
            onChange={set('name')}
            placeholder="Jane Doe"
            autoComplete="name"
          />
        </Field>
        <Field label="Work email" htmlFor="email">
          <Input
            id="email"
            type="email"
            required
            value={form.email}
            onChange={set('email')}
            placeholder="jane@acme.com"
            autoComplete="email"
          />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 6 characters">
          <Input
            id="password"
            type="password"
            required
            value={form.password}
            onChange={set('password')}
            placeholder="••••••••"
            autoComplete="new-password"
          />
        </Field>
        <Button type="submit" loading={busy} className="w-full">
          Create organization
        </Button>
      </form>
    </AuthLayout>
  )
}

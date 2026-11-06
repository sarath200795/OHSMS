import { useState } from 'react'
import { Link, useNavigate, Navigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '../../shared/auth/AuthContext'
import { authErrorMessage } from '../../shared/lib/authErrors'
import { Button, Field, Input } from '../../shared/ui'
import AuthLayout from './AuthLayout'
import OwnStackRequest from './OwnStackRequest'
import {
  validatePassword,
  passwordLengthHint,
  MIN_PASSWORD_LENGTH,
} from '../../shared/auth/passwordPolicy'

/**
 * Organization registration starts with the database choice.
 *
 * WEEHS continues into the form this screen has always submitted
 * (`registerOrganization`). Own database renders OwnStackRequest, which files
 * a provisioning request and does not create a WEEHS user. The two paths do
 * not share a submit handler. docs/CUSTOM-STACK.md.
 */
export default function RegisterOrg() {
  const { registerOrganization, isAuthed, profile } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState('choice')
  const [choice, setChoice] = useState('')
  const [form, setForm] = useState({ orgName: '', address: '', name: '', email: '', password: '' })
  const [busy, setBusy] = useState(false)

  if (isAuthed && profile) return <Navigate to="/portal" replace />

  if (step === 'own') return <OwnStackRequest onBack={() => setStep('choice')} />

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const choose = (e) => {
    e.preventDefault()
    if (choice === 'weehs' || choice === 'own') setStep(choice)
  }

  const submit = async (e) => {
    e.preventDefault()
    const pwError = validatePassword(form.password, { email: form.email, name: form.name })
    if (pwError) return toast.error(pwError)
    setBusy(true)
    try {
      await registerOrganization(form)
      toast.success('Organization created — welcome!')
      navigate('/portal', { replace: true })
    } catch (err) {
      toast.error(authErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (step === 'choice') {
    return (
      <AuthLayout
        title="Register your organization"
        subtitle="Choose where this organization stores its records"
        footer={
          <>
            Already have an account?{' '}
            <Link
              to="/login"
              className="font-semibold text-brand-700 underline-offset-2 hover:underline"
            >
              Sign in
            </Link>
          </>
        }
      >
        <form onSubmit={choose} className="space-y-4">
          <fieldset className="space-y-3">
            <legend className="label">Database</legend>
            <div className="rounded-2xl border border-ink-200 p-3">
              <label
                htmlFor="stack-weehs"
                className="flex items-start gap-2 text-sm font-semibold text-ink-900"
              >
                <input
                  id="stack-weehs"
                  type="radio"
                  name="stack"
                  value="weehs"
                  className="mt-1"
                  checked={choice === 'weehs'}
                  onChange={() => setChoice('weehs')}
                />
                Use the WEEHS database
              </label>
              <p id="stack-weehs-hint" className="mt-1 pl-6 text-xs leading-relaxed text-ink-500">
                Shared Cloud Firestore. You create a WEEHS account and sign in on this site.
              </p>
            </div>
            <div className="rounded-2xl border border-ink-200 p-3">
              <label
                htmlFor="stack-own"
                className="flex items-start gap-2 text-sm font-semibold text-ink-900"
              >
                <input
                  id="stack-own"
                  type="radio"
                  name="stack"
                  value="own"
                  className="mt-1"
                  checked={choice === 'own'}
                  onChange={() => setChoice('own')}
                  aria-describedby="stack-own-hint"
                />
                Use your own database
              </label>
              <p id="stack-own-hint" className="mt-1 pl-6 text-xs leading-relaxed text-ink-500">
                File a provisioning request. Your company is not live, and no WEEHS account is
                created, until an operator provisions a dedicated environment.
              </p>
            </div>
          </fieldset>
          <Button type="submit" className="w-full" disabled={!choice}>
            Continue
          </Button>
        </form>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Register your organization"
      subtitle="You'll become the first administrator"
      footer={
        <>
          Already have an account?{' '}
          <Link
            to="/login"
            className="font-semibold text-brand-700 underline-offset-2 hover:underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Button type="button" variant="ghost" className="!px-0" onClick={() => setStep('choice')}>
          Back to database choice
        </Button>
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
        <Field label="Password" htmlFor="password" hint={passwordLengthHint()}>
          <Input
            id="password"
            type="password"
            required
            minLength={MIN_PASSWORD_LENGTH}
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

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
    // A fieldset's default min-width is min-content, and a flex label will not
    // shrink its text. Together those two draw the choice smaller than its
    // own label and let the words spill out of the card. min-w-0 on both, and
    // the same padding as .input, keeps each option the width of the other
    // register controls with the label wrapping inside it.
    const optionClass = (on) =>
      [
        'flex w-full min-w-0 cursor-pointer items-start gap-3 rounded-2xl border px-3.5 py-3 text-left',
        on ? 'border-brand-500 bg-white/80 ring-2 ring-brand-400' : 'border-ink-200 bg-white/50',
      ].join(' ')

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
          <fieldset className="m-0 w-full min-w-0 space-y-3 border-0 p-0">
            <legend className="label">Database</legend>
            <label htmlFor="stack-weehs" className={optionClass(choice === 'weehs')}>
              <input
                id="stack-weehs"
                type="radio"
                name="stack"
                value="weehs"
                className="mt-0.5 !h-5 !w-5 shrink-0"
                checked={choice === 'weehs'}
                onChange={() => setChoice('weehs')}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold leading-snug text-ink-900">
                  Use the WEEHS database
                </span>
                <span className="mt-1 block text-sm font-normal leading-snug text-ink-600">
                  Shared Cloud Firestore. You create a WEEHS account and sign in on this site.
                </span>
              </span>
            </label>
            <label htmlFor="stack-own" className={optionClass(choice === 'own')}>
              <input
                id="stack-own"
                type="radio"
                name="stack"
                value="own"
                className="mt-0.5 !h-5 !w-5 shrink-0"
                checked={choice === 'own'}
                onChange={() => setChoice('own')}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold leading-snug text-ink-900">
                  Use your own database
                </span>
                <span className="mt-1 block text-sm font-normal leading-snug text-ink-600">
                  File a provisioning request. Your company is not live, and no WEEHS account is
                  created, until an operator provisions a dedicated environment.
                </span>
              </span>
            </label>
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
            maxLength={120}
            value={form.orgName}
            onChange={set('orgName')}
            placeholder="Acme Manufacturing Ltd"
          />
        </Field>
        <Field label="Address" htmlFor="address" hint="Optional">
          <Input
            id="address"
            maxLength={300}
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
            maxLength={120}
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
            maxLength={200}
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

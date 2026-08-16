import { useEffect, useState } from 'react'
import { Link, useNavigate, useLocation, Navigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { useAuth } from '../../shared/auth/AuthContext'
import { authErrorMessage } from '../../shared/lib/authErrors'
import { SSO_PROVIDERS, hasSso } from '../../shared/auth/sso'
import { isCodeComplete } from '../../shared/auth/mfa'
import { Button, Field, Input } from '../../shared/ui'
import { safeInternalPath } from '../../shared/safeUrl'
import AuthLayout from './AuthLayout'

export default function Login() {
  const { login, loginWithSso, completeMfa, pendingMfa, clearPendingMfa, isAuthed, profile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [form, setForm] = useState({ email: '', password: '' })
  const [busy, setBusy] = useState(false)
  const [ssoBusy, setSsoBusy] = useState('')
  // The live handle to a half-finished sign-in. Held in state, never persisted:
  // it expires, and storing it would leave a partial session on the machine.
  const [resolver, setResolver] = useState(null)
  const [code, setCode] = useState('')

  // A challenge raised by the SSO redirect arrives through the context, because
  // that round trip destroyed this component's state on the way out.
  useEffect(() => {
    if (pendingMfa) setResolver(pendingMfa)
  }, [pendingMfa])

  // Where ProtectedRoute bounced us from, if anywhere. Run through
  // safeInternalPath because this is the classic open-redirect sink: the
  // destination is derived from where the browser was pointed, so it is
  // attacker-influenceable, and it is followed at the exact moment the user has
  // just proved who they are. `//evil.com` and `/\evil.com` are paths to
  // react-router and other origins to the browser.
  const back = safeInternalPath(location.state?.from?.pathname, '/portal')

  // Only redirect once the profile has loaded — redirecting on isAuthed alone
  // races ProtectedRoute (which needs the profile) and causes a redirect loop.
  if (isAuthed && profile) return <Navigate to={back} replace />

  const land = () => {
    toast.success('Welcome back')
    navigate(back, { replace: true })
  }

  const handle = (result) => {
    if (result?.status === 'mfa') {
      setResolver(result.resolver)
      setCode('')
      return
    }
    // 'redirecting' leaves the page entirely; 'cancelled' means they closed the
    // popup, which needs no message — they know.
    if (result?.status === 'signed-in') land()
  }

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      handle(await login(form))
    } catch (err) {
      toast.error(authErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const sso = async (providerId) => {
    setSsoBusy(providerId)
    try {
      handle(await loginWithSso(providerId))
    } catch (err) {
      toast.error(authErrorMessage(err))
    } finally {
      setSsoBusy('')
    }
  }

  const verify = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      handle(await completeMfa(resolver, code))
    } catch (err) {
      toast.error(authErrorMessage(err))
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  const cancelMfa = () => {
    setResolver(null)
    setCode('')
    clearPendingMfa()
  }

  // ── Second factor ──────────────────────────────────────────────────────────
  // A separate screen rather than a field on the form: the password was already
  // right, and showing it again invites people to retype it when the code is
  // what is being asked for.
  if (resolver) {
    return (
      <AuthLayout
        title="Enter your code"
        subtitle="Two-factor authentication"
        footer={
          <button type="button" onClick={cancelMfa} className="font-semibold text-white underline-offset-2 hover:underline">
            Use a different account
          </button>
        }
      >
        <form onSubmit={verify} className="space-y-4">
          <div className="flex items-start gap-2 rounded-xl bg-brand-50 px-3 py-2.5 text-xs text-brand-800">
            <ShieldCheck size={14} className="mt-0.5 shrink-0" />
            <span>Open your authenticator app and enter the 6-digit code for this account.</span>
          </div>
          <Field label="6-digit code" htmlFor="code">
            <Input
              id="code"
              // Not type="number": it strips leading zeros and shows spinners.
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={7}
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              className="text-center text-lg tracking-[0.4em]"
            />
          </Field>
          <Button type="submit" loading={busy} disabled={!isCodeComplete(code)} className="w-full">
            Verify
          </Button>
          <p className="text-center text-xs text-ink-500">
            Lost your device? An administrator can reset two-factor for your account.
          </p>
        </form>
      </AuthLayout>
    )
  }

  // ── Password + SSO ─────────────────────────────────────────────────────────
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
      {/* SSO first, because someone whose company uses it should not fill in a
          password form before noticing the button. Absent entirely when no
          provider is configured, so nothing changes for deployments without it. */}
      {hasSso && (
        <div className="mb-5 space-y-2">
          {SSO_PROVIDERS.map((p) => (
            <Button
              key={p.id}
              type="button"
              variant="ghost"
              icon={KeyRound}
              loading={ssoBusy === p.id}
              disabled={Boolean(ssoBusy)}
              onClick={() => sso(p.id)}
              className="w-full justify-center"
            >
              Continue with {p.label}
            </Button>
          ))}
          <div className="flex items-center gap-3 pt-1">
            <span className="h-px flex-1 bg-ink-200" />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">or</span>
            <span className="h-px flex-1 bg-ink-200" />
          </div>
        </div>
      )}

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

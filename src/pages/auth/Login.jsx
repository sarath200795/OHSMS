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
import LoginModules from './LoginModules'
import { isNativePlatform } from '../../shared/mobile/native'
import {
  currentAccessToken,
  isOwnStackBuild,
  ownStackAuthMethod,
  ownStackGateway,
} from '../../shared/auth/ownStackSession'
import StoreBadges from './StoreBadges'

// Company SAML and OIDC do not use this page's email form. The password is
// entered at the identity provider. /auth/start is the host route that builds
// the AuthnRequest and redirects there. Submitting the email form used to be
// the only way to reach it, so the dedicated host looked like a Firebase login.
function companySignInStart() {
  if (!isOwnStackBuild()) return ''
  const method = ownStackAuthMethod()
  if (method !== 'saml' && method !== 'oidc') return ''
  const gateway = ownStackGateway()
  return gateway ? `${gateway}/auth/start` : ''
}

export default function Login() {
  const {
    login,
    loginWithSso,
    completeMfa,
    pendingMfa,
    clearPendingMfa,
    isAuthed,
    profile,
    isPlatformAdmin,
    platformAdminReady,
  } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [form, setForm] = useState({ email: '', password: '' })
  const [busy, setBusy] = useState(false)
  const [ssoBusy, setSsoBusy] = useState('')
  // The live handle to a half-finished sign-in. Held in state, never persisted:
  // it expires, and storing it would leave a partial session on the machine.
  const [resolver, setResolver] = useState(null)
  const [code, setCode] = useState('')
  const idpStart = companySignInStart()

  useEffect(() => {
    if (!idpStart || isAuthed || currentAccessToken()) return
    try {
      window.location.assign(idpStart)
    } catch {
      // The link below is the same URL. A test runner that refuses navigation
      // still leaves it on the page.
    }
  }, [idpStart, isAuthed])

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
  // An operator who typed their credentials into the CUSTOMER door. They have
  // no profile and never will, so the line above can never fire for them and
  // the form would simply sit there having apparently done nothing. Sending
  // them to their own console is not a second entrance — they are already
  // signed in and already hold the grant — it just avoids a dead end.
  if (isAuthed && !profile && platformAdminReady && isPlatformAdmin) {
    return <Navigate to="/platform" replace />
  }

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
          <button
            type="button"
            onClick={cancelMfa}
            className="font-semibold text-brand-700 underline-offset-2 hover:underline"
          >
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
              // The password step has just been submitted and this field replaced
              // it. Without focus the screen reader stays where the old form was
              // and the user is told nothing about what is now being asked of
              // them. See the no-autofocus note in eslint.config.js.
              // eslint-disable-next-line jsx-a11y/no-autofocus
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

  if (idpStart) {
    return (
      <AuthLayout
        title="Sign in"
        subtitle="Company identity provider"
        footer={
          <span>
            <a
              href="/privacy"
              className="font-semibold text-brand-700 underline-offset-2 hover:underline"
            >
              Privacy Policy
            </a>
            {' · '}
            <a
              href="/terms"
              className="font-semibold text-brand-700 underline-offset-2 hover:underline"
            >
              Terms of Use
            </a>
          </span>
        }
      >
        <p className="text-sm leading-relaxed text-ink-700">
          Continuing to the company identity provider. The password is entered there, not on this
          page.
        </p>
        <a
          href={idpStart}
          className="mt-4 inline-flex w-full items-center justify-center rounded-full bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white"
        >
          Continue to company sign-in
        </a>
      </AuthLayout>
    )
  }

  // ── Password + SSO ─────────────────────────────────────────────────────────
  // Module roster rides beside (desktop) / below (mobile) the form so visitors
  // see what the platform covers before they authenticate. MFA stays form-only
  // — the challenge is not a product tour.
  return (
    <AuthLayout
      title="Sign in"
      subtitle="Occupational Health & Safety Management System"
      showcase={<LoginModules />}
      footer={
        <>
          New organization?{' '}
          <Link
            to="/register-org"
            className="font-semibold text-brand-700 underline-offset-2 hover:underline"
          >
            Register
          </Link>{' '}
          ·{' '}
          <Link
            to="/signup"
            className="font-semibold text-brand-700 underline-offset-2 hover:underline"
          >
            Join an existing one
          </Link>
          <span className="mt-2 block">
            <a
              href="/privacy"
              className="font-semibold text-brand-700 underline-offset-2 hover:underline"
            >
              Privacy Policy
            </a>
            {' · '}
            <a
              href="/terms"
              className="font-semibold text-brand-700 underline-offset-2 hover:underline"
            >
              Terms of Use
            </a>
          </span>
          <StoreBadges />
        </>
      }
    >
      {/* SSO first, because someone whose company uses it should not fill in a
          password form before noticing the button. Absent entirely when no
          provider is configured, so nothing changes for deployments without it. */}
      {isNativePlatform() && (
        <p className="mb-4 rounded-2xl bg-surface px-3 py-3 text-sm text-ink-600">
          In the app, sign in with email and password. Organisation single sign-on needs a one-time
          authorised-domain setup before it can return here.
        </p>
      )}
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
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">
              or
            </span>
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
            // 16px on phones avoids iOS focus-zoom; sm+ keeps the denser auth type.
            className="text-base sm:text-sm"
          />
        </Field>
        <Field
          label="Password"
          htmlFor="password"
          action={
            <Link
              to="/forgot-password"
              className="text-xs font-medium text-brand-700 hover:underline"
            >
              Forgot password?
            </Link>
          }
        >
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="••••••••"
            className="text-base sm:text-sm"
          />
        </Field>
        <Button type="submit" loading={busy} className="w-full">
          Sign in
        </Button>
      </form>
    </AuthLayout>
  )
}

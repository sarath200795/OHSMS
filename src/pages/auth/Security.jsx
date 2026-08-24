import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import toast from 'react-hot-toast'
import { ShieldCheck, ShieldAlert, Trash2, Copy, Check } from 'lucide-react'
import { useAuth } from '../../shared/auth/AuthContext'
import { authErrorMessage } from '../../shared/lib/authErrors'
import {
  enrolledFactors, startTotpEnrolment, finishTotpEnrolment, unenrolFactor,
  reauthWithPassword, canReauthWithPassword, needsRecentLogin, isCodeComplete,
  isEmailVerified, sendVerification,
} from '../../shared/auth/mfa'
import { PageHeader, Button, Field, Input, Badge } from '../../shared/ui'

/**
 * Two-factor authentication, self-service.
 *
 * Enrolment is deliberately the user's own job rather than an admin's: the
 * secret has to reach their authenticator app and nobody else's, and any flow
 * where an administrator sees it defeats the point of the factor.
 *
 * Firebase requires a recent login before enrolling or removing a factor, which
 * surfaces mid-flow rather than up front. That is handled here by asking for the
 * password at the moment it is needed, instead of pre-emptively — most people
 * signed in seconds ago and will never see it.
 */
export default function Security() {
  const { user, refreshProfile } = useAuth()
  const [factors, setFactors] = useState(() => enrolledFactors(user))
  const [step, setStep] = useState('idle') // idle | scan | reauth
  const [enrolment, setEnrolment] = useState(null) // { secret, uri, sharedSecretKey }
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [sent, setSent] = useState(false)
  // What to retry once the password has been re-proven.
  const [afterReauth, setAfterReauth] = useState(null)

  const verified = isEmailVerified(user)

  const refreshFactors = () => setFactors(enrolledFactors(user))

  const verifyEmail = async () => {
    setBusy(true)
    try {
      await sendVerification(user)
      setSent(true)
      toast.success('Check your inbox, then reload this page')
    } catch (err) {
      toast.error(authErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  // Firebase only tells us a fresh login is needed when we try, so the retry is
  // captured and replayed rather than asking everyone for a password up front.
  const withReauth = async (label, fn) => {
    setBusy(true)
    try {
      await fn()
    } catch (err) {
      if (needsRecentLogin(err)) {
        if (!canReauthWithPassword(user)) {
          // Federated accounts have no password to re-enter; Firebase wants the
          // provider credential, which means going round the identity provider
          // again. Signing out and back in is the honest instruction.
          toast.error('Please sign out and sign in again, then retry.')
          return
        }
        setAfterReauth(() => fn)
        setStep('reauth')
        return
      }
      toast.error(authErrorMessage(err))
      throw err
    } finally {
      setBusy(false)
    }
    toast.success(label)
  }

  const begin = async () => {
    await withReauth('Scan the code with your authenticator app', async () => {
      const started = await startTotpEnrolment(user)
      setEnrolment(started)
      setCode('')
      setStep('scan')
    }).catch(() => {})
  }

  const confirm = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await finishTotpEnrolment(user, enrolment.secret, code)
      toast.success('Two-factor authentication is on')
      setStep('idle')
      setEnrolment(null)
      setCode('')
      refreshFactors()
      await refreshProfile?.()
    } catch (err) {
      toast.error(authErrorMessage(err))
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (factor) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Remove "${factor.displayName || 'this factor'}"? Your account will be protected by password alone.`)) return
    await withReauth('Two-factor authentication removed', async () => {
      await unenrolFactor(user, factor.uid)
      refreshFactors()
    }).catch(() => {})
  }

  const reauth = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await reauthWithPassword(user, password)
      setPassword('')
      setStep('idle')
      const retry = afterReauth
      setAfterReauth(null)
      if (retry) await retry()
      refreshFactors()
    } catch (err) {
      toast.error(authErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const copySecret = async () => {
    try {
      await navigator.clipboard.writeText(enrolment.sharedSecretKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy — select the key and copy it manually.')
    }
  }

  return (
    <div>
      <PageHeader
        title="Security"
        subtitle="Two-factor authentication for your account"
        icon={ShieldCheck}
      />

      <section className="card max-w-2xl space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-ink-800">Authenticator app</h2>
            <p className="mt-0.5 max-w-[52ch] text-xs leading-relaxed text-ink-500">
              A 6-digit code from an app on your phone, needed alongside your password.
              Codes work without a signal, which matters on a plant floor.
            </p>
          </div>
          {factors.length > 0 ? (
            <Badge tone="green">On</Badge>
          ) : (
            <Badge tone="amber">Off</Badge>
          )}
        </div>

        {factors.length > 0 && (
          <ul className="space-y-2">
            {factors.map((f) => (
              <li key={f.uid} className="flex items-center justify-between gap-3 rounded-xl bg-ink-50 px-3 py-2.5">
                <span className="flex items-center gap-2 text-sm text-ink-800">
                  <ShieldCheck size={14} className="shrink-0 text-emerald-600" />
                  {f.displayName || 'Authenticator app'}
                  {f.enrollmentTime && (
                    <span className="text-xs text-ink-400">
                      · added {new Date(f.enrollmentTime).toLocaleDateString()}
                    </span>
                  )}
                </span>
                <Button variant="ghost" className="px-2 py-1" icon={Trash2} onClick={() => remove(f)} disabled={busy}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}

        {/* Checked before the button is offered, not after it fails. Firebase
            refuses to enrol a factor on an unverified address and only says so
            when you try, so without this the first thing someone sees when they
            try to secure their account is an SDK error. */}
        {step === 'idle' && !verified && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-amber-50 px-3 py-2.5">
            <span className="flex items-start gap-2 text-xs text-amber-800">
              <ShieldAlert size={14} className="mt-0.5 shrink-0" />
              <span className="max-w-[46ch]">
                Verify your email address first — a second factor can only be added to an
                address you have proven you own.
              </span>
            </span>
            <Button variant="ghost" className="px-2.5 py-1 text-xs" onClick={verifyEmail} loading={busy}>
              {sent ? 'Email sent' : 'Send verification email'}
            </Button>
          </div>
        )}

        {step === 'idle' && verified && factors.length === 0 && (
          <div>
            <div className="mb-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
              <ShieldAlert size={14} className="mt-0.5 shrink-0" />
              <span>
                Your account is protected by a password alone. If you administer this
                organization, turning this on is the single biggest thing you can do for it.
              </span>
            </div>
            <Button onClick={begin} loading={busy}>Set up two-factor</Button>
          </div>
        )}

        {step === 'idle' && verified && factors.length > 0 && (
          <Button variant="ghost" onClick={begin} loading={busy}>Add another device</Button>
        )}

        {/* Enrolment. The QR is the fast path; the typed key is there because
            plenty of corporate phones cannot scan one. */}
        {step === 'scan' && enrolment && (
          <form onSubmit={confirm} className="space-y-4 border-t border-ink-100 pt-4">
            <div className="flex flex-wrap items-start gap-5">
              <div className="rounded-xl bg-white p-3 shadow-clay-sm">
                <QRCodeSVG value={enrolment.uri} size={148} />
              </div>
              <div className="min-w-[16rem] flex-1 space-y-2">
                <p className="text-xs leading-relaxed text-ink-600">
                  Scan this with Google Authenticator, Microsoft Authenticator, 1Password
                  or any TOTP app. Cannot scan? Enter this key by hand:
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 break-all rounded-lg bg-ink-50 px-2.5 py-2 text-[11px] tracking-wide text-ink-700">
                    {enrolment.sharedSecretKey}
                  </code>
                  <Button
                    type="button"
                    variant="ghost"
                    className="px-2 py-1"
                    icon={copied ? Check : Copy}
                    onClick={copySecret}
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
              </div>
            </div>

            <Field label="Enter the 6-digit code to finish" htmlFor="enrolcode">
              <Input
                id="enrolcode"
                inputMode="numeric"
                autoComplete="one-time-code"
                // Last step of enrolment, revealed only after the QR code has
                // been scanned. See the no-autofocus note in eslint.config.js.
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                maxLength={7}
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                className="max-w-[12rem] text-center text-lg tracking-[0.4em]"
              />
            </Field>

            <div className="flex gap-2">
              <Button type="submit" loading={busy} disabled={!isCodeComplete(code)}>Turn on</Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => { setStep('idle'); setEnrolment(null); setCode('') }}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}

        {step === 'reauth' && (
          <form onSubmit={reauth} className="space-y-3 border-t border-ink-100 pt-4">
            <p className="text-xs text-ink-600">
              Confirm your password to continue — changing two-factor settings needs a recent sign-in.
            </p>
            <Field label="Password" htmlFor="reauthpw">
              <Input
                id="reauthpw"
                type="password"
                autoComplete="current-password"
                // Re-authentication prompt: it appears in place of whatever the
                // user was doing, and it is the only thing on it. See the
                // no-autofocus note in eslint.config.js.
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                required
                className="max-w-sm"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" loading={busy}>Confirm</Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => { setStep('idle'); setPassword(''); setAfterReauth(null) }}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </section>
    </div>
  )
}

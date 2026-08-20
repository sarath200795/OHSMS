// ─────────────────────────────────────────────────────────────────────────────
// The operator sign-in. A separate door, on purpose.
//
// The console decides what OTHER organizations may use, and doing that from
// inside a tenant's own app — signed in as an admin of one customer, looking at
// a header that says that customer's name — is how an operator ends up editing
// the wrong organization. So this screen shares no shell, no branding and no
// navigation with the product.
//
// It also refuses to be a general entrance. Signing in here with an ordinary
// account does not drop that person into the tenant app; the session is ended
// immediately and the screen says only that this account cannot operate the
// platform. Whether an email exists as a customer login is not something this
// page is willing to answer.
//
// Note on browsers: Firebase Auth holds ONE session per browser profile, so
// signing in here signs you out of the tenant app in this browser and vice
// versa. That is the desired behaviour — you cannot be a customer and the
// operator at the same time — but it means holding both open needs a second
// browser profile or a private window.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { useAuth } from '../../shared/auth/AuthContext'
import { operatorLoginMessage, REFUSED } from './loginErrors'
import { isCodeComplete } from '../../shared/auth/mfa'
import { platformAdminRef } from '../../shared/auth/platformAdmin'
import { getDoc } from 'firebase/firestore'
import { Button, Field, Input } from '../../shared/ui'

export default function PlatformLogin() {
  const { login, completeMfa, signOut, isAuthed, isPlatformAdmin, platformAdminReady } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '' })
  const [busy, setBusy] = useState(false)
  const [resolver, setResolver] = useState(null)
  const [code, setCode] = useState('')
  const [refused, setRefused] = useState('')

  // Already an operator with a live session — go straight in.
  if (isAuthed && platformAdminReady && isPlatformAdmin) return <Navigate to="/platform" replace />

  /**
   * The grant is read here rather than waited for through the context, because
   * the decision has to be made before this component yields: an account
   * without it must not hold a session for even one render.
   */
  const admit = async (result) => {
    if (result?.status === 'mfa') {
      setResolver(result.resolver)
      setCode('')
      return
    }
    if (result?.status !== 'signed-in') return

    const uid = result.user?.uid
    let granted = false
    try {
      granted = uid ? (await getDoc(platformAdminRef(uid))).exists() : false
    } catch {
      granted = false
    }

    if (!granted) {
      await signOut().catch(() => {})
      setResolver(null)
      setCode('')
      setForm({ email: '', password: '' })
      // The same sentence a wrong password gets — see loginErrors. This branch
      // is the one that must not be distinguishable: reaching it means the
      // credentials were RIGHT, so a different message here would confirm a
      // working account and tell the holder it is not an operator, which is
      // half of what they would need to find one that is.
      setRefused(REFUSED)
      return
    }

    setRefused('')
    toast.success('Signed in')
    navigate('/platform', { replace: true })
  }

  const run = async (fn) => {
    setBusy(true)
    setRefused('')
    try {
      await admit(await fn())
    } catch (err) {
      setRefused(operatorLoginMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const submit = (e) => { e.preventDefault(); run(() => login(form)) }
  const verify = (e) => { e.preventDefault(); run(() => completeMfa(resolver, code)) }

  return (
    <div className="grid min-h-screen place-items-center bg-ink-900 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-ink-800 text-ink-200">
            <SlidersHorizontal size={22} />
          </span>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white">Platform console</h1>
            <p className="mt-0.5 text-[12.5px] text-ink-400">
              Operator access only. This is not the customer sign-in.
            </p>
          </div>
        </div>

        <div className="rounded-2xl bg-clay-surface p-6 shadow-clay">
          {refused && (
            <p
              role="alert"
              className="mb-4 rounded-xl bg-red-50 px-3 py-2.5 text-[12.5px] font-semibold text-red-700"
            >
              {refused}
            </p>
          )}

          {resolver ? (
            <form onSubmit={verify} className="space-y-4">
              <div className="flex items-start gap-2 rounded-xl bg-brand-50 px-3 py-2.5 text-xs text-brand-800">
                <ShieldCheck size={14} className="mt-0.5 shrink-0" />
                <span>Enter the 6-digit code from your authenticator app.</span>
              </div>
              <Field label="6-digit code" htmlFor="op-code">
                <Input
                  id="op-code"
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
              <button
                type="button"
                onClick={() => { setResolver(null); setCode('') }}
                className="w-full text-center text-xs font-semibold text-ink-500 hover:underline"
              >
                Use a different account
              </button>
            </form>
          ) : (
            // No SSO, no password reset, no "create an account". Every one of
            // those is a way in that this door does not need, and each would be
            // one more thing to get right on the highest-privilege screen.
            <form onSubmit={submit} className="space-y-4">
              <Field label="Email" htmlFor="op-email">
                <Input
                  id="op-email"
                  type="email"
                  autoComplete="username"
                  required
                  autoFocus
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="operator@example.com"
                />
              </Field>
              <Field label="Password" htmlFor="op-password">
                <Input
                  id="op-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="••••••••"
                />
              </Field>
              <Button type="submit" loading={busy} className="w-full">
                Sign in
              </Button>
            </form>
          )}
        </div>

        <p className="mt-5 text-center text-[11.5px] text-ink-500">
          Looking for your organization&apos;s OHS app? It is at a different address — ask your
          administrator for the link.
        </p>
      </div>
    </div>
  )
}

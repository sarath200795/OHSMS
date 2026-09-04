// ─────────────────────────────────────────────────────────────────────────────
// The inactivity logout, as one component both shells mount.
//
// It was inline in AppChrome, and that is how the platform console came to be
// the only screen in the product without it. Every tenant route goes through
// AppChrome; /platform deliberately does NOT — it has its own shell precisely
// so a customer's name never sits above a list of every other customer — and
// the timeout was never noticed missing on the way past.
//
// So the single highest-privilege account in the system, the one that decides
// which modules every tenant may use, was the one that stayed signed in on an
// unattended laptop indefinitely. The others logged out in fifteen minutes.
//
// Extracted rather than copied. A second inline copy would be a second thing to
// remember when the timeout changes, and this file exists because the first
// copy was already the thing nobody remembered.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect } from 'react'
import { useIdleTimeout } from './useIdleTimeout'

/**
 * Signs `signOut` out on expiry and offers a countdown before it happens.
 *
 * Renders nothing until the warning phase, so it costs a shell one line and no
 * layout.
 */
export default function IdleGuard({ signOut }) {
  const { isWarning, isExpired, remainingSeconds, resetActivity } = useIdleTimeout()

  useEffect(() => {
    if (isExpired && signOut) signOut()
  }, [isExpired, signOut])

  if (!isWarning) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4 backdrop-blur-sm animate-fade-in"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="idle-title"
    >
      <div className="w-full max-w-sm rounded-2xl bg-clay-surface p-6 shadow-clay-lg">
        <h2 id="idle-title" className="mb-2 text-lg font-bold text-ink-900">Session expiring soon</h2>
        <p className="mb-6 text-[14px] text-ink-600">
          You have been inactive for a while. You will be signed out in{' '}
          <span className="font-bold text-red-600">{remainingSeconds}</span> seconds to protect
          your account.
        </p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => signOut?.()}
            className="rounded-xl px-4 py-2 text-[13px] font-bold text-ink-600 transition-colors hover:bg-clay-100"
          >
            Sign out
          </button>
          <button
            type="button"
            onClick={resetActivity}
            className="rounded-xl bg-brand-600 px-4 py-2 text-[13px] font-bold text-white shadow-brand-sm transition-colors hover:bg-brand-500"
          >
            Stay signed in
          </button>
        </div>
      </div>
    </div>
  )
}

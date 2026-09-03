// ─────────────────────────────────────────────────────────────────────────────
// The operator's shell. Deliberately not AppChrome.
//
// AppChrome exists to make a person feel located inside their organization: it
// carries the tenant's name, their profile, their training record, the safety
// assistant. Every one of those is wrong here, and the org name is worse than
// wrong — it is the operator's own tenant, sitting above a list of everybody
// else's, which is precisely the confusion this separation removes.
//
// Dark, and it says "Platform console" and nothing else. Whoever is looking at
// this screen should never have to check which app they are in.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect } from 'react'
import { LogOut, SlidersHorizontal } from 'lucide-react'
import { useAuth } from '../../shared/auth/AuthContext'
import { useIdleTimeout } from '../../shared/auth/useIdleTimeout'
import ErrorBoundary from '../../shared/ErrorBoundary'

export default function PlatformShell({ children }) {
  const { user, signOut } = useAuth()

  // The idle timeout, which this shell did without.
  //
  // useIdleTimeout was mounted in exactly one place — AppChrome. Tenant routes
  // and the customer portal both go through AppChrome; /platform deliberately
  // does not, for the reasons at the top of this file. The effect of that
  // deliberate separation was that the single highest-privilege account in the
  // product — the one that toggles module entitlements for EVERY tenant — was
  // the only account in the system with no inactivity logout, on exactly the
  // kind of screen most likely to be left open on a shared machine.
  //
  // No "stay signed in" dialog here, unlike AppChrome. That prompt exists so a
  // safety officer does not lose a half-written incident report; there is
  // nothing to lose on an operator console, and a warning that can be dismissed
  // by whoever happens to be at the keyboard is worth less than simply signing
  // out.
  const { isExpired } = useIdleTimeout()
  useEffect(() => {
    if (isExpired && signOut) signOut()
  }, [isExpired, signOut])

  return (
    <div className="min-h-screen bg-clay-bg">
      <header className="sticky top-0 z-30 flex items-center gap-3 bg-ink-900 px-5 py-3 sm:px-7">
        <span className="grid h-8 w-8 flex-none place-items-center rounded-[10px] bg-ink-800 text-ink-200">
          <SlidersHorizontal size={16} />
        </span>
        <span className="leading-tight">
          <span className="block text-[13px] font-extrabold tracking-[-0.01em] text-white">
            Platform console
          </span>
          <span className="block text-[11px] text-ink-400">Operator — all organizations</span>
        </span>

        <div className="flex-1" />

        {/* The operator's own address, so a shared machine cannot leave someone
            editing customers as an account they did not realise was signed in. */}
        <span className="hidden truncate text-[12px] text-ink-300 sm:block">{user?.email}</span>
        <button
          type="button"
          onClick={() => signOut?.()}
          className="flex items-center gap-2 rounded-xl px-3 py-2 text-[12.5px] font-semibold text-ink-200 transition-colors hover:bg-ink-800"
        >
          <LogOut size={15} />
          Sign out
        </button>
      </header>

      <main id="main" tabIndex={-1} className="mx-auto max-w-[1180px] px-5 pb-24 pt-6 sm:px-7">
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>
    </div>
  )
}

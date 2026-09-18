// ─────────────────────────────────────────────────────────────────────────────
// The operator's shell. Deliberately not AppChrome.
//
// AppChrome exists to make a person feel located inside their organization: it
// carries the tenant's name, their profile, their training record, the safety
// assistant. Every one of those is wrong here, and the org name is worse than
// wrong — it is the operator's own tenant, sitting above a list of everybody
// else's, which is precisely the confusion this separation removes.
//
// Quiet, and it says "Platform console" and nothing else. Whoever is looking at
// this screen should never have to check which app they are in.
// ─────────────────────────────────────────────────────────────────────────────
import { LogOut, SlidersHorizontal } from 'lucide-react'
import { useAuth } from '../../shared/auth/AuthContext'
import ErrorBoundary from '../../shared/ErrorBoundary'
import IdleGuard from '../../shared/auth/IdleGuard'

export default function PlatformShell({ children }) {
  const { user, signOut } = useAuth()

  return (
    <div className="min-h-screen bg-canvas">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-2xl focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to main content
      </a>
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-ink-200/80 bg-white/72 px-5 py-3 backdrop-blur-2xl sm:px-7">
        <span className="grid h-8 w-8 flex-none place-items-center rounded-xl bg-white/70 text-ink-400 ring-1 ring-ink-200">
          <SlidersHorizontal size={16} />
        </span>
        <span className="leading-tight">
          <span className="block text-[13px] font-extrabold tracking-[-0.01em] text-ink-900">
            Platform console
          </span>
          <span className="block text-[11px] text-ink-400">Operator — all organizations</span>
        </span>

        <div className="flex-1" />

        {/* The operator's own address, so a shared machine cannot leave someone
            editing customers as an account they did not realise was signed in. */}
        <span className="hidden truncate text-[12px] text-ink-400 sm:block">{user?.email}</span>
        <button
          type="button"
          onClick={() => signOut?.()}
          className="flex items-center gap-2 rounded-2xl px-3 py-2 text-[12.5px] font-semibold text-ink-700 transition-colors hover:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          <LogOut size={15} />
          Sign out
        </button>
      </header>

      <main id="main" tabIndex={-1} className="mx-auto max-w-[1180px] px-5 pb-24 pt-6 sm:px-7">
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>

      {/* Deliberately NOT AppChrome is what left this screen without an
          inactivity logout: every tenant route inherited one from that shell,
          and this one inherited nothing. The account it protects is the only
          one that can change what every other customer may use — the last one
          that should sit unattended on a signed-in laptop. */}
      <IdleGuard signOut={signOut} />
    </div>
  )
}

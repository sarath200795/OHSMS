import { Link } from 'react-router-dom'

/**
 * The "Internal Audit" logo: a rounded-square audit document + magnifier icon
 * next to the wordmark. `tone` switches the wordmark color for dark vs light
 * backgrounds.
 */
export default function Brand({ tone = 'dark', size = 'md', to = '/' }) {
  const wordmark =
    tone === 'light' ? 'text-white' : 'text-ink-800'
  const dims = size === 'lg' ? 'h-12 w-12' : 'h-10 w-10'
  const text = size === 'lg' ? 'text-2xl' : 'text-xl'

  const Logo = (
    <span className="inline-flex items-center gap-3">
      <span
        className={`grid ${dims} place-items-center rounded-2xl bg-ink-800 shadow-md ring-1 ring-white/10`}
      >
        <LogoMark className="h-6 w-6" />
      </span>
      <span className={`font-extrabold tracking-tight ${text} ${wordmark}`}>
        Internal Audit
      </span>
    </span>
  )

  if (!to) return Logo
  return (
    <Link to={to} className="inline-flex" aria-label="Internal Audit home">
      {Logo}
    </Link>
  )
}

export function LogoMark({ className = 'h-6 w-6' }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="brandmark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3b82f6" />
          <stop offset="1" stopColor="#2563eb" />
        </linearGradient>
      </defs>
      <rect x="16" y="12" width="24" height="30" rx="3" fill="#e2e8f0" />
      <rect x="20" y="19" width="16" height="2.5" rx="1.25" fill="#94a3b8" />
      <rect x="20" y="25" width="16" height="2.5" rx="1.25" fill="#94a3b8" />
      <rect x="20" y="31" width="10" height="2.5" rx="1.25" fill="#94a3b8" />
      <circle
        cx="40"
        cy="42"
        r="10"
        fill="#0f172a"
        stroke="url(#brandmark)"
        strokeWidth="4"
      />
      <line
        x1="47"
        y1="49"
        x2="55"
        y2="57"
        stroke="url(#brandmark)"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M35 42l3.5 3.5L46 38"
        fill="none"
        stroke="#60a5fa"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

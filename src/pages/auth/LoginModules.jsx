// ─────────────────────────────────────────────────────────────────────────────
// Public module roster on the sign-in screen.
//
// Visitors see what the platform covers before they authenticate. Copy comes
// from `MODULES` in the registry — the same names and descriptions the signed-in
// dashboard already uses — so inventing a second catalogue cannot drift. Rows
// are not links: there is nowhere to go until sign-in succeeds.
//
// A line list, not tiles. Glass cards (even text-forward ones) still read as a
// gallery. Each module is a name and its brief, stacked with a hairline.
// ─────────────────────────────────────────────────────────────────────────────
import { MODULES } from '../../shared/modules/registry'

export default function LoginModules() {
  return (
    <section
      aria-labelledby="login-modules-heading"
      className="min-w-0 border-t border-ink-200/70 pt-6 lg:border-t-0 lg:pt-0"
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-700">
        Platform modules
      </p>
      <h2
        id="login-modules-heading"
        className="mt-1 text-[18px] font-extrabold tracking-[-0.02em] text-ink-900 sm:text-[20px]"
      >
        What you can run in WEHS
      </h2>
      <p className="mt-1.5 max-w-[52ch] text-[12.5px] leading-relaxed text-ink-500 sm:text-[13px]">
        A short brief for each practice — from incident reporting to permits,
        training and emergency response.
      </p>
      <ul className="mt-4 list-none divide-y divide-ink-200/70 p-0 sm:mt-5">
        {MODULES.map((m) => (
          <li key={m.key} className="py-3 first:pt-0 last:pb-0">
            <p className="text-[14px] font-bold tracking-[-0.015em] text-ink-900">{m.label}</p>
            <p className="mt-0.5 break-words text-[13px] leading-relaxed text-ink-500">
              {m.description}
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}

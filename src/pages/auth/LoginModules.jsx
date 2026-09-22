// ─────────────────────────────────────────────────────────────────────────────
// Public module roster on the sign-in screen.
//
// Visitors see what the platform covers before they authenticate. Copy comes
// from `MODULES` in the registry — the same names and descriptions the signed-in
// dashboard already uses — so inventing a second catalogue cannot drift. Tiles
// are not links: there is nowhere to go until sign-in succeeds.
//
// Layout is text-forward on purpose. An earlier pass put a large centred mark
// above a short label and read as a logo gallery; the brief is the point here.
// ─────────────────────────────────────────────────────────────────────────────
import { MODULES } from '../../shared/modules/registry'

/**
 * One Liquid Glass entry: module name + readable brief, with a small icon accent.
 */
function ModuleBrief({ tone, icon: Icon, label, description }) {
  return (
    <article
      data-tone={tone}
      className="glass-tile relative flex items-start gap-3 rounded-2xl p-4 text-left"
    >
      {/* Accent only — sized so it never competes with the brief. */}
      <span
        className="mt-0.5 grid h-7 w-7 flex-none place-items-center rounded-lg bg-white/35 ring-1 ring-white/50"
        aria-hidden="true"
      >
        <Icon size={14} strokeWidth={2.2} className="block opacity-80" />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-[14px] font-bold tracking-[-0.015em] text-ink-900">{label}</h3>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">{description}</p>
      </div>
    </article>
  )
}

export default function LoginModules() {
  return (
    <section aria-labelledby="login-modules-heading" className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-700">
        Platform modules
      </p>
      <h2
        id="login-modules-heading"
        className="mt-1 text-[20px] font-extrabold tracking-[-0.02em] text-ink-900"
      >
        What you can run in WEHS
      </h2>
      <p className="mt-1.5 max-w-[52ch] text-[13px] leading-relaxed text-ink-500">
        A short brief for each practice — from incident reporting to permits,
        training and emergency response — under one amber glass shell.
      </p>
      <ul className="mt-5 grid list-none gap-3 p-0 sm:grid-cols-2">
        {MODULES.map((m) => (
          <li key={m.key}>
            <ModuleBrief
              tone={m.tone}
              icon={m.icon}
              label={m.label}
              description={m.description}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}

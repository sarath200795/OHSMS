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
// On phones: single column, compact padding, hairline under the form so the
// stack stays readable without oversized marks.
// ─────────────────────────────────────────────────────────────────────────────
import { MODULES } from '../../shared/modules/registry'

/**
 * One Liquid Glass entry: module name + readable brief, with a small icon accent.
 */
function ModuleBrief({ tone, icon: Icon, label, description }) {
  return (
    <article
      data-tone={tone}
      className="glass-tile relative flex items-start gap-2.5 rounded-2xl p-3.5 text-left sm:gap-3 sm:p-4"
    >
      {/* Accent only — sized so it never competes with the brief. */}
      <span
        className="mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-md bg-white/35 ring-1 ring-white/50 sm:h-7 sm:w-7 sm:rounded-lg"
        aria-hidden="true"
      >
        <Icon
          size={14}
          strokeWidth={2.2}
          className="block size-[13px] opacity-80 sm:size-[14px]"
        />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-[13.5px] font-bold tracking-[-0.015em] text-ink-900 sm:text-[14px]">
          {label}
        </h3>
        <p className="mt-1 break-words text-[12px] leading-relaxed text-ink-500 sm:text-[12.5px]">
          {description}
        </p>
      </div>
    </article>
  )
}

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
        training and emergency response — under one amber glass shell.
      </p>
      {/* Single column on phones; two columns only once there is real width
          (md), so briefs stay readable instead of squashed side-by-side. */}
      <ul className="mt-4 grid list-none gap-2.5 p-0 sm:mt-5 sm:gap-3 md:grid-cols-2">
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

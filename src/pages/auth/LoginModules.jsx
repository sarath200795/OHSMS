// ─────────────────────────────────────────────────────────────────────────────
// Public module roster on the sign-in screen.
//
// Visitors see what the platform covers before they authenticate. Copy comes
// from `MODULES` in the registry — the same names and descriptions the signed-in
// dashboard already uses — so inventing a second catalogue cannot drift. Tiles
// are not links: there is nowhere to go until sign-in succeeds.
// ─────────────────────────────────────────────────────────────────────────────
import { MODULES } from '../../shared/modules/registry'

/**
 * One Liquid Glass tile: centred mark, module name, brief description.
 */
function ModuleTile({ tone, icon: Icon, label, description }) {
  return (
    <article
      data-tone={tone}
      className="glass-tile relative flex min-h-[152px] flex-col items-center justify-center gap-2.5 rounded-3xl p-4 text-center"
    >
      {/* Fixed square + place-items-center so lucide glyphs (and any future
          raster marks) share one optical centre — icons alone sat high-left
          when the tile used justify without a sized slot. */}
      <span className="grid h-11 w-11 flex-none place-items-center" aria-hidden="true">
        <Icon size={22} strokeWidth={2} />
      </span>
      <div className="min-w-0">
        <h3 className="text-[14px] font-bold tracking-[-0.015em] text-ink-900">{label}</h3>
        <p className="mt-1 line-clamp-3 text-[12px] leading-snug text-ink-500">{description}</p>
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
        Each module is a workplace health and safety practice — from incident
        reporting to permits, training and emergency response — under one amber
        glass shell.
      </p>
      <ul className="mt-5 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
        {MODULES.map((m) => (
          <li key={m.key}>
            <ModuleTile
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

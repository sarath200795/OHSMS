// ─────────────────────────────────────────────────────────────────────────────
// Portal primitives.
//
// The portal is built from the same tokens as the rest of the app — card,
// well, elev, brand / ink / canvas / surface. Nothing here introduces a
// colour or a shadow; these are just the four shapes the portal repeats
// often enough that spelling them out each time obscures the layout.
// ─────────────────────────────────────────────────────────────────────────────

/** A raised panel — the portal's default surface. */
export function Raised({ as: Tag = 'div', className = '', children, ...rest }) {
  return (
    <Tag className={`card ${className}`} {...rest}>
      {children}
    </Tag>
  )
}

/** A muted panel — used for stat tiles, inputs and segmented controls. */
export function Inset({ as: Tag = 'div', className = '', children, ...rest }) {
  return (
    <Tag className={`well ${className}`} {...rest}>
      {children}
    </Tag>
  )
}

/** The small uppercase label that introduces every section. */
export function SectionLabel({ className = '', children }) {
  return (
    <p
      className={`text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400 ${className}`}
    >
      {children}
    </p>
  )
}

/**
 * A progress ring drawn with conic-gradient rather than SVG.
 *
 * The ring is decoration around a number that is already displayed, so it
 * carries no information the text does not — which is why it needs no label of
 * its own and no accessible name.
 */
export function Ring({ pct, color, size = 46 }) {
  const safe = Math.max(0, Math.min(100, Number(pct) || 0))
  return (
    <span
      aria-hidden="true"
      className="grid flex-none place-items-center rounded-full"
      style={{
        height: size,
        width: size,
        background: `conic-gradient(${color} ${safe * 3.6}deg, #3f342a 0deg)`,
      }}
    >
      <span
        className="grid place-items-center rounded-full bg-surface text-[11px] font-extrabold"
        style={{ height: size - 10, width: size - 10, color }}
      >
        {safe}%
      </span>
    </span>
  )
}

/** Page heading with an icon tile, used at the top of every inner screen. */
export function PortalHeading({ icon: Icon, title, subtitle, action }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 items-center gap-3.5">
        <span className="grid h-10 w-10 flex-none place-items-center rounded-2xl bg-brand-50 text-brand-700 ring-1 ring-brand-200/70">
          <Icon size={20} strokeWidth={2.1} />
        </span>
        <div className="min-w-0">
          <h1 className="text-[22px] font-extrabold tracking-[-0.02em] text-ink-900">{title}</h1>
          {subtitle && <p className="mt-0.5 text-[13px] text-ink-500">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="sm:ml-auto sm:flex-none">{action}</div>}
    </div>
  )
}

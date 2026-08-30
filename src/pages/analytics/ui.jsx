// Shared furniture for the analytics tabs — a chart frame, a stat, and the
// empty state. Kept in one place so every tab frames its charts identically;
// a dashboard where each panel is a slightly different shape is harder to read
// than one where the eye can stop noticing the frame.
import { Inset } from '../portal/ui'

export function Panel({ title, subtitle, right, children, className = '' }) {
  return (
    <div className={`card p-5 ${className}`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-bold tracking-[-0.015em] text-ink-900">{title}</p>
          {subtitle && <p className="mt-0.5 text-[11.5px] text-ink-400">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </div>
  )
}

export function Stat({ icon: Icon, label, value, sub, tone }) {
  return (
    <div className="card p-4">
      {Icon && (
        <span className="grid h-9 w-9 place-items-center rounded-xl text-white" style={{ background: tone }}>
          <Icon size={17} strokeWidth={2.2} />
        </span>
      )}
      <p className="mt-3 text-[26px] font-extrabold leading-none tracking-[-0.03em] text-ink-900">{value}</p>
      <p className="mt-1.5 text-[12px] font-semibold leading-snug text-ink-700">{label}</p>
      {sub && <p className="text-[11px] text-ink-400">{sub}</p>}
    </div>
  )
}

export function NoData({ height = 240, children }) {
  return (
    <Inset className="grid place-items-center px-6 text-center" style={{ height }}>
      <p className="max-w-[34ch] text-[13px] leading-relaxed text-ink-400">{children}</p>
    </Inset>
  )
}

/** A labelled select styled as a pressed well, used across every filter bar. */
export function Picker({ id, label, value, onChange, children }) {
  return (
    <div className="min-w-0 flex-1">
      <label htmlFor={id} className="mb-1 block text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-400">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={onChange}
        className="w-full appearance-none rounded-2xl border border-transparent bg-clay-surface px-3 py-2.5 text-[13px] font-semibold text-ink-900 shadow-clay-inset outline-none"
      >
        {children}
      </select>
    </div>
  )
}

/**
 * One labelled band of a filter bar.
 *
 * The label is the whole point. A dozen controls in an undifferentiated wrap is
 * a wall you read end to end to find the one you want; a few small groups with
 * a word in front of each is something you scan. The word sits in a fixed
 * gutter on wide screens so the controls line up down the page, and stacks
 * above them when there is no room for that.
 *
 * Shared by the ODIN and Auditors bars so the two cannot drift apart.
 */
export function FilterRow({ label, children }) {
  return (
    <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-end sm:gap-4">
      <p className="w-full pt-1 text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-400 sm:w-20 sm:flex-none">
        {label}
      </p>
      <div className="flex flex-1 flex-wrap items-end gap-3">{children}</div>
    </div>
  )
}

/** A date input matching the Picker well, for the From/To ends of a range. */
export function DateField({ id, label, value, min, max, onChange }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-400">
        {label}
      </label>
      <input
        id={id}
        type="date"
        value={value}
        min={min || undefined}
        max={max || undefined}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-2xl bg-clay-surface px-3 py-2.5 text-[12.5px] font-semibold text-ink-700 shadow-clay-sm"
      />
    </div>
  )
}

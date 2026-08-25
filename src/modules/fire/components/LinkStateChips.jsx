import { Link2, Link2Off } from 'lucide-react'

/**
 * Filter a register down to what is attached to a site, or what is not.
 *
 * The site link was only ever visible in aggregate — a count on the sites page,
 * a button that appears when something is matchable. Neither answers the
 * question asked while looking at the list itself: which of THESE rows is
 * attached to a site? So: two chips, in the same bar as every other filter,
 * carrying their own counts.
 *
 * `value` is 'linked' | 'unlinked' | null, and clicking the active chip clears
 * it — the same toggle behaviour as the condition chips beside them.
 *
 * Props: value, onChange, linkedCount, unlinkedCount
 */
export default function LinkStateChips({ value, onChange, linkedCount = 0, unlinkedCount = 0 }) {
  // Nothing to narrow when every row is on the same side of the line.
  if (!linkedCount || !unlinkedCount) return null

  const chip = (key, label, Icon, count, tone) => {
    const on = value === key
    return (
      <button
        key={key}
        onClick={() => onChange(on ? null : key)}
        aria-pressed={on}
        className={`chip transition ${on ? tone.on : tone.off}`}
        title={key === 'linked'
          ? 'Attached to a site in the registry'
          : 'No site link — findable only by the name typed on the record'}
      >
        <Icon size={13} /> {label} ({count})
      </button>
    )
  }

  return (
    <>
      {chip('linked', 'Linked to site', Link2, linkedCount, {
        on: 'bg-emerald-700 text-white',
        off: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200',
      })}
      {chip('unlinked', 'Not linked', Link2Off, unlinkedCount, {
        on: 'bg-ink-700 text-white',
        off: 'bg-ink-100 text-ink-600 hover:bg-ink-200',
      })}
    </>
  )
}

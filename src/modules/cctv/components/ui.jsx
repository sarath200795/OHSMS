import { Badge } from '../../../shared/ui'
import { STATUS, CAUSE, CAUSE_LABEL } from '../lib/constants'

/**
 * A device's status, showing the cascade rather than hiding it.
 *
 * "Offline" on its own invites the wrong conclusion: someone reads a list of
 * forty offline cameras and books forty callouts. So when a device is dark
 * because of something upstream, the chip says which device to go and look at
 * instead, and is toned differently from a real fault — amber for collateral,
 * red for something actually broken.
 */
export function StatusChip({ health, className = '' }) {
  if (!health) return null
  if (health.effective === STATUS.UNKNOWN) {
    return <Badge tone="slate" className={className}>Not reported</Badge>
  }
  if (health.working) return <Badge tone="emerald" className={className}>Online</Badge>
  if (health.cause === CAUSE.SELF) return <Badge tone="red" className={className}>Offline</Badge>
  return (
    <Badge tone="amber" className={className} title={`Dark because ${health.blamedOn?.name || 'an upstream device'} is down`}>
      Dark · {CAUSE_LABEL[health.cause]}
    </Badge>
  )
}

/** A percentage with the band's colour, used on every summary card. */
export function HealthPill({ pct, band, className = '' }) {
  return (
    <Badge tone={band?.tone || 'slate'} className={className}>
      {pct}% · {band?.label || '—'}
    </Badge>
  )
}

export function DefectChips({ keys = [], table = {}, className = '' }) {
  if (!keys.length) return <span className="text-xs text-ink-400">—</span>
  return (
    <span className={`flex flex-wrap gap-1 ${className}`}>
      {keys.map((k) => (
        <Badge key={k} tone={table[k]?.tone || 'slate'}>{table[k]?.label || k}</Badge>
      ))}
    </span>
  )
}

/** A big number with a label, for the top of the dashboard. */
export function Stat({ label, value, sub, tone = 'ink' }) {
  const toneClass =
    { emerald: 'text-emerald-600', red: 'text-red-600', amber: 'text-amber-600', ink: 'text-ink-900' }[tone] ||
    'text-ink-900'
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-400">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${toneClass}`}>{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-ink-500">{sub}</div> : null}
    </div>
  )
}

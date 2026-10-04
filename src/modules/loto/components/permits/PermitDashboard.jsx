import { dashboardStats } from '../../utils/permitExport'

const TILES = [
  { key: 'open', label: 'Open', hint: 'Waiting, approved or running', tone: 'text-steel-100' },
  { key: 'overdue', label: 'Overdue', hint: 'Past the end of the window', tone: 'text-danger' },
  { key: 'due', label: 'Due soon', hint: 'In the last 30 minutes', tone: 'text-amber-600' },
  { key: 'closed', label: 'Closed', hint: 'Returned, rejected or withdrawn', tone: 'text-safe' },
]

/**
 * Four counts over the permits the screen already holds. Each tile is a button
 * that applies the matching list filter, so a number is one tap from the
 * permits behind it. `now` is passed in so the tile and the row badge use the
 * same clock.
 */
export default function PermitDashboard({ permits, now, onPick }) {
  const stats = dashboardStats(permits, now)
  return (
    <section aria-label="Permit summary" className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {TILES.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onPick?.(t.key)}
          className="rounded-xl border border-steel-700 bg-steel-900 p-4 text-left transition-colors hover:border-steel-500"
        >
          <div
            className={`text-3xl font-bold tabular-nums ${stats[t.key] > 0 ? t.tone : 'text-steel-400'}`}
          >
            {stats[t.key]}
          </div>
          <div className="mt-1 text-sm font-semibold text-steel-100">{t.label}</div>
          <div className="text-xs text-steel-400">{t.hint}</div>
        </button>
      ))}
      {stats.emergency > 0 && (
        <p className="col-span-full text-xs text-steel-400">
          {stats.emergency} permit{stats.emergency === 1 ? ' was' : 's were'} closed by emergency
          removal.
        </p>
      )}
    </section>
  )
}

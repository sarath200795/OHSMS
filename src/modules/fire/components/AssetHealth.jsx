import { AlertTriangle, ShieldCheck, Check, X } from 'lucide-react'
import { format } from 'date-fns'
import { toDate } from '../lib/extinguisherLogic'

// ── Health bar ────────────────────────────────────────────────────────────────
// A single stacked bar showing the share of each condition, with a count legend.
// segments: [{ label, value, color }]
export function HealthBar({ segments, title = 'Fleet health' }) {
  const total = segments.reduce((n, s) => n + s.value, 0)
  return (
    <div className="card p-4">
      <p className="mb-3 text-xs font-bold uppercase tracking-wide text-ink-500">{title}</p>
      <div className="flex h-4 w-full overflow-hidden rounded-full bg-ink-100">
        {total === 0
          ? <div className="h-full w-full bg-ink-100" />
          : segments.map((s) => (
              s.value > 0 && (
                <div key={s.label} style={{ width: `${(s.value / total) * 100}%`, backgroundColor: s.color }}
                  title={`${s.label}: ${s.value}`} />
              )
            ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
        {segments.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 text-ink-600">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
            <span className="font-semibold text-ink-800">{s.value}</span> {s.label}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Open defects panel ────────────────────────────────────────────────────────
// Pending QR-scan defect reports for this asset kind. When `onDecide` is provided
// (and the viewer may act), each defect can be Confirmed (asset → faulty / out of
// service) or Dismissed (false report), which closes the report.
export function OpenDefectsPanel({ defects, hint, onDecide, canDecide = false, busyId }) {
  const fmt = (v) => { const d = toDate(v); return d ? format(d, 'dd MMM yyyy') : '' }
  const actionable = canDecide && typeof onDecide === 'function'
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-clay-200/60 px-4 py-3">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink-500">
          <AlertTriangle size={13} className="text-amber-500" /> Open defects
        </p>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">{defects.length}</span>
      </div>
      {defects.length === 0 ? (
        <div className="flex flex-col items-center gap-1 px-4 py-8 text-center">
          <ShieldCheck size={22} className="text-green-500" />
          <p className="text-sm font-semibold text-ink-700">No open defects</p>
          <p className="text-xs text-ink-400">{hint || 'Reports from QR scans will appear here for approval.'}</p>
        </div>
      ) : (
        <ul className="divide-y divide-clay-200/60">
          {defects.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
              <AlertTriangle size={15} className="shrink-0 text-red-500" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink-800">{r.defect}</p>
                <p className="truncate text-xs text-ink-500">{r.assetLabel || '—'}{r.reportedAt ? ` · ${fmt(r.reportedAt)}` : ''}</p>
              </div>
              {actionable ? (
                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => onDecide(r, true)}
                    title="Confirm defect — mark the asset faulty / out of service and close the report"
                    className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-2.5 py-1 text-[11px] font-bold text-red-600 transition hover:bg-red-100 disabled:opacity-50"
                  >
                    <Check size={12} /> Confirm
                  </button>
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => onDecide(r, false)}
                    title="Dismiss — false report, close without changing the asset"
                    className="inline-flex items-center gap-1 rounded-lg bg-ink-100 px-2.5 py-1 text-[11px] font-bold text-ink-500 transition hover:bg-ink-200 disabled:opacity-50"
                  >
                    <X size={12} /> Dismiss
                  </button>
                </div>
              ) : (
                <span className="ml-auto shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Pending</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

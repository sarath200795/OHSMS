import { useState } from 'react'
import { History, ChevronDown, ChevronUp, Camera, AlertTriangle, CheckCircle2 } from 'lucide-react'

const fmt = (iso) => {
  const d = new Date(iso)
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : '—'
}

/**
 * What the previous run of this form found here, shown before the inspector
 * starts answering.
 *
 * Open by default when there were failures and collapsed when there were none:
 * a list of things to re-check is the reason to look, and "last time was clean"
 * needs one line, not a panel.
 */
export default function PreviousFindingsPanel({ previous }) {
  const hasFindings = previous ? previous.findings.length > 0 : false
  // Null means "nobody has touched it", so the default follows the data rather
  // than whatever was true on first render. Records arrive from a subscription
  // a moment after mount, so seeding useState from `hasFindings` left the panel
  // shut on exactly the inspections that had something to show.
  const [manual, setManual] = useState(null)
  const open = manual === null ? hasFindings : manual

  if (!previous) {
    return (
      <div className="card mb-4 flex items-center gap-2.5 p-4 text-sm text-ink-400">
        <History size={16} />
        First inspection of this form at this site — nothing to compare against yet.
      </div>
    )
  }

  const { findings, completedAt, inspector, score, result, docId } = previous

  return (
    <div className={`card mb-4 overflow-hidden p-0 ${hasFindings ? 'border-l-4 border-amber-400' : ''}`}>
      <button
        type="button"
        onClick={() => setManual(!open)}
        className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-clay-100/60"
      >
        <span className={`grid h-9 w-9 flex-none place-items-center rounded-xl ${hasFindings ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
          {hasFindings ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-ink-900">
            {hasFindings
              ? `${findings.length} point${findings.length === 1 ? '' : 's'} failed last inspection`
              : 'Last inspection passed every point'}
          </span>
          <span className="block truncate text-xs text-ink-400">
            {fmt(completedAt)}
            {inspector ? ` · ${inspector}` : ''}
            {score != null ? ` · ${score}%${result ? ` ${result}` : ''}` : ''}
            {docId ? ` · ${docId}` : ''}
          </span>
        </span>
        {hasFindings && (open ? <ChevronUp size={16} className="text-ink-400" /> : <ChevronDown size={16} className="text-ink-400" />)}
      </button>

      {open && hasFindings && (
        <ul className="border-t border-ink-100 px-4 py-3">
          {findings.map((f) => (
            <li key={f.fieldId} className="flex gap-2.5 border-b border-ink-50 py-2 last:border-0">
              <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-amber-500" />
              <span className="min-w-0">
                <span className="text-[13px] font-semibold text-ink-800">{f.label}</span>
                {f.observation && (
                  <span className="block text-xs leading-snug text-ink-500">{f.observation}</span>
                )}
                {f.hasPhoto && (
                  <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-ink-400">
                    <Camera size={10} /> photo on record
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * The same fact, on the question itself.
 *
 * The panel above is read once and scrolled past; this is what the inspector
 * sees at the moment they are about to answer, which is when it changes what
 * they do.
 */
export function PreviousFindingNote({ finding }) {
  if (!finding) return null
  return (
    <p className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2 py-1 text-[11px] leading-snug text-amber-800">
      <AlertTriangle size={11} className="mt-0.5 flex-none" />
      <span>
        <span className="font-bold">Failed last time.</span>
        {finding.observation ? ` ${finding.observation}` : ' Verify it has been fixed.'}
      </span>
    </p>
  )
}

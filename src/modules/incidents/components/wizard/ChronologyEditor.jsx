// ─────────────────────────────────────────────────────────────────────────────
// The chronology table, as it is typed.
//
// Rows stay in the order they were entered while the editor is open. People
// remember an incident in fragments — the alarm, then something from before it,
// then the ambulance — and a table that re-sorts under the cursor moves the row
// being typed into, which is how an entry gets lost. Ordering happens on save
// and on print (sortChronology), where nobody is mid-sentence.
//
// There is always one empty row at the bottom so there is somewhere to type
// without hunting for a button; meaningfulChronology drops it on the way out.
// ─────────────────────────────────────────────────────────────────────────────
import { Clock, Plus, Trash2, ArrowDownUp } from 'lucide-react'
import { blankChronologyEntry, sortChronology, chronologySpan, meaningfulChronology } from '../../lib/chronology'

export default function ChronologyEditor({ incident, rows, onChange }) {
  const set = (id, patch) => onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const addRow = () => onChange([...rows, blankChronologyEntry(incident)])
  const removeRow = (id) => {
    const next = rows.filter((r) => r.id !== id)
    onChange(next.length ? next : [blankChronologyEntry(incident)])
  }

  const filled = meaningfulChronology(rows)
  const span = chronologySpan(filled)

  return (
    <div className="card p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-bold text-ink-900">
          <Clock size={18} className="text-brand-600" /> Chronology of the event
        </h3>
        <button
          type="button"
          className="btn-ghost px-3 py-1.5 text-xs"
          onClick={() => onChange(sortChronology(rows))}
          disabled={filled.length < 2}
          title={filled.length < 2 ? 'Add at least two events first' : 'Put the rows in time order'}
        >
          <ArrowDownUp size={13} /> Order by time
        </button>
      </div>
      <p className="mb-3 text-xs text-ink-500">
        What happened, in what order, and how you know. Rows are printed in time order on the
        investigation report regardless of the order you type them in. Leave a time blank where it
        was never established — the gap is a finding too.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink-200 text-left text-[10.5px] font-bold uppercase tracking-[0.08em] text-ink-400">
              <th className="w-[7.5rem] py-1.5 pr-2">Date</th>
              <th className="w-[5.5rem] py-1.5 pr-2">Time</th>
              <th className="py-1.5 pr-2">Event</th>
              <th className="w-[11rem] py-1.5 pr-2">Established from</th>
              <th className="w-8 py-1.5" aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className="border-b border-ink-100 align-top">
                <td className="py-1.5 pr-2">
                  <input
                    type="date"
                    className="input !py-1.5 !text-[13px]"
                    aria-label={`Event ${i + 1} date`}
                    value={r.date}
                    onChange={(e) => set(r.id, { date: e.target.value })}
                  />
                </td>
                <td className="py-1.5 pr-2">
                  <input
                    type="time"
                    className="input !py-1.5 !text-[13px]"
                    aria-label={`Event ${i + 1} time`}
                    value={r.time}
                    onChange={(e) => set(r.id, { time: e.target.value })}
                  />
                </td>
                <td className="py-1.5 pr-2">
                  <textarea
                    className="input min-h-[38px] resize-y !py-1.5 !text-[13px]"
                    rows={1}
                    aria-label={`Event ${i + 1} description`}
                    placeholder="e.g. Operator reported a burning smell to the shift supervisor"
                    value={r.event}
                    onChange={(e) => set(r.id, { event: e.target.value })}
                  />
                </td>
                <td className="py-1.5 pr-2">
                  <input
                    className="input !py-1.5 !text-[13px]"
                    aria-label={`Event ${i + 1} source`}
                    placeholder="CCTV, shift log, witness…"
                    value={r.source}
                    onChange={(e) => set(r.id, { source: e.target.value })}
                  />
                </td>
                <td className="py-1.5">
                  <button
                    type="button"
                    className="grid h-7 w-7 place-items-center rounded-lg text-ink-400 hover:bg-red-50 hover:text-red-600"
                    onClick={() => removeRow(r.id)}
                    title="Remove this event"
                    aria-label={`Remove event ${i + 1}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="btn-soft px-3 py-1.5 text-xs" onClick={addRow}>
          <Plus size={13} /> Add event
        </button>
        <p className="text-xs text-ink-400">
          {filled.length === 0
            ? 'No events recorded yet.'
            : `${filled.length} event${filled.length === 1 ? '' : 's'}${span ? ` spanning ${span}` : ''}.`}
        </p>
      </div>
    </div>
  )
}

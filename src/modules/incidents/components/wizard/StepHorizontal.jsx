import { Share2 } from 'lucide-react'
import { LOCATIONS } from '../../lib/constants'

/**
 * Step 5 — Horizontal deployment. Verify whether the corrective action should be
 * deployed across other locations. `value`={ required, locations[], details }.
 */
export default function StepHorizontal({ value = {}, onChange }) {
  const set = (patch) => onChange({ ...value, ...patch })
  const toggleLoc = (loc) => {
    const cur = value.locations || []
    set({ locations: cur.includes(loc) ? cur.filter((l) => l !== loc) : [...cur, loc] })
  }
  return (
    <div className="card p-6">
      <div className="mb-4 flex items-center gap-2">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-brand-500/10 text-brand-600"><Share2 size={18} /></div>
        <div>
          <h3 className="font-bold text-ink-900">Horizontal Deployment</h3>
          <p className="text-xs text-ink-400">Should this action be replicated at other sites to prevent recurrence?</p>
        </div>
      </div>

      <label className="label">Requires horizontal deployment?</label>
      <div className="mb-4 flex gap-2">
        {[{ v: true, l: 'Yes' }, { v: false, l: 'No' }].map((o) => (
          <button key={o.l} type="button" onClick={() => set({ required: o.v })}
            className={`btn ${value.required === o.v ? 'bg-brand-500 text-white shadow-clay-brand' : 'bg-clay-surface text-ink-600'}`}>
            {o.l}
          </button>
        ))}
      </div>

      {value.required && (
        <div className="mb-4">
          <label className="label">Deploy to locations</label>
          <div className="flex flex-wrap gap-2">
            {LOCATIONS.map((l) => {
              const on = (value.locations || []).includes(l)
              return (
                <button key={l} type="button" onClick={() => toggleLoc(l)}
                  className="chip transition" style={on ? { backgroundColor: '#6d4c41', color: '#fff' } : { backgroundColor: '#efebe9', color: '#5d4037' }}>
                  {l}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <label className="label">Details / deployment plan</label>
      <textarea className="input min-h-[100px] resize-y" placeholder="Describe how and where this learning will be applied…" value={value.details || ''} onChange={(e) => set({ details: e.target.value })} />
    </div>
  )
}

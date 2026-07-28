import { Plus, Trash2, ListChecks } from 'lucide-react'
import { ACTION_KINDS, ACTION_STATUS } from '../lib/constants'
import DeptPersonPicker from '../../../shared/org/DeptPersonPicker'

const uid = () => (crypto?.randomUUID ? crypto.randomUUID() : `a_${Date.now()}_${Math.random().toString(36).slice(2)}`)

/**
 * Editable list of corrective/preventive actions. Shared by incident CAPA
 * (Step 4) and illness corrective actions. `value`=array; `onChange(next)`.
 * Action shape: { id, kind, description, ownerUid, ownerName, dueDate, status, closedAt }
 */
export default function ActionEditor({ value = [], onChange, users = [] }) {
  const set = (id, patch) => onChange(value.map((a) => (a.id === id ? { ...a, ...patch } : a)))
  const remove = (id) => onChange(value.filter((a) => a.id !== id))
  const add = () => onChange([...value, { id: uid(), kind: 'corrective', description: '', ownerUid: '', ownerName: '', dueDate: '', status: 'open', closedAt: null }])
  const pickOwner = (id, ownerUid) => {
    const u = users.find((x) => x.uid === ownerUid)
    set(id, { ownerUid, ownerName: u?.name || '' })
  }

  return (
    <div className="space-y-3">
      {value.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-2xl bg-clay-surface py-8 text-center text-ink-400 shadow-clay-inset">
          <ListChecks size={28} />
          <p className="text-sm">No actions yet. Add corrective or preventive actions.</p>
        </div>
      )}
      {value.map((a, i) => (
        <div key={a.id} className="rounded-2xl bg-clay-surface p-4 shadow-clay-inset">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-500 text-xs font-bold text-white">{i + 1}</span>
              <div className="flex gap-1 rounded-lg bg-white/60 p-0.5">
                {ACTION_KINDS.map((k) => (
                  <button key={k.key} type="button" onClick={() => set(a.id, { kind: k.key })}
                    className={`rounded-md px-2.5 py-1 text-xs font-bold transition ${a.kind === k.key ? 'bg-brand-500 text-white' : 'text-ink-500'}`}>
                    {k.label}
                  </button>
                ))}
              </div>
            </div>
            <button type="button" onClick={() => remove(a.id)} className="rounded-lg p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={15} /></button>
          </div>

          <textarea className="input min-h-[60px] resize-y" placeholder="Describe the corrective/preventive action…" maxLength={1000} value={a.description} onChange={(e) => set(a.id, { description: e.target.value })} />

          <div className="mt-2 space-y-2">
            {/* Owner via Department → person drill-down */}
            <DeptPersonPicker
              users={users.filter((u) => u.status === 'approved')}
              value={a.ownerUid || ''}
              onChange={(v) => pickOwner(a.id, v)}
              personPlaceholder="Assign owner…"
            />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input type="date" className="input" value={a.dueDate || ''} onChange={(e) => set(a.id, { dueDate: e.target.value })} />
              <select className="input" value={a.status || 'open'} onChange={(e) => set(a.id, { status: e.target.value, closedAt: e.target.value === 'closed' ? new Date().toISOString() : null })}>
                {ACTION_STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
          </div>
        </div>
      ))}
      <button type="button" className="btn-soft" onClick={add}><Plus size={15} /> Add action</button>
    </div>
  )
}

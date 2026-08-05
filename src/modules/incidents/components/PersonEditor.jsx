import { UserPlus, Trash2, User, Building2 } from 'lucide-react'
import { PERSON_KINDS } from '../lib/constants'
import DeptPersonPicker from '../../../shared/org/DeptPersonPicker'

const uid = () => (crypto?.randomUUID ? crypto.randomUUID() : `p_${Date.now()}_${Math.random().toString(36).slice(2)}`)

/**
 * Editable list of people, each Internal (picked from org users) or External
 * (free text). Reused by affected-personnel, investigation team, and illness
 * reporting. `value`=array of person objects; `onChange(next)`.
 *  - internal: { id, kind:'internal', uid, name, dept }
 *  - external: { id, kind:'external', name, company, contact }
 *  - allowRole adds a free-text `role` field (e.g. team member roles).
 */
export default function PersonEditor({ value = [], onChange, users = [], allowRole = false }) {
  const set = (id, patch) => onChange(value.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  const remove = (id) => onChange(value.filter((p) => p.id !== id))
  const add = (kind) =>
    onChange([...value, kind === 'internal'
      ? { id: uid(), kind: 'internal', uid: '', name: '', dept: '', ...(allowRole ? { role: '' } : {}) }
      : { id: uid(), kind: 'external', name: '', company: '', contact: '', ...(allowRole ? { role: '' } : {}) }])

  const pickInternal = (id, userUid) => {
    const u = users.find((x) => x.uid === userUid)
    set(id, { uid: userUid, name: u?.name || '', dept: u?.department || u?.dept || '' })
  }

  return (
    <div className="space-y-3">
      {value.length === 0 && (
        <p className="rounded-xl bg-clay-surface px-3 py-2 text-sm text-ink-400 shadow-clay-inset">No people added yet.</p>
      )}
      {value.map((p) => (
        <div key={p.id} className="rounded-2xl bg-clay-surface p-3 shadow-clay-inset">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex gap-1 rounded-lg bg-white/60 p-0.5">
              {PERSON_KINDS.map((k) => (
                <button
                  key={k.key}
                  type="button"
                  onClick={() => set(p.id, { kind: k.key })}
                  className={`rounded-md px-2.5 py-1 text-xs font-bold transition ${
                    p.kind === k.key ? 'bg-brand-500 text-white' : 'text-ink-500'
                  }`}
                >
                  {k.key === 'internal' ? <User size={12} className="mr-1 inline" /> : <Building2 size={12} className="mr-1 inline" />}
                  {k.label}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => remove(p.id)} className="rounded-lg p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-600">
              <Trash2 size={15} />
            </button>
          </div>

          {p.kind === 'internal' ? (
            <div className="grid grid-cols-1 gap-2">
              {/* Department → person drill-down (dept narrows the list; picking
                  a person back-fills their department onto the record). */}
              <DeptPersonPicker
                users={users.filter((u) => u.status === 'approved')}
                value={p.uid || ''}
                onChange={(v) => pickInternal(p.id, v)}
                personPlaceholder="Select member…"
              />
              {allowRole && <input className="input" placeholder="Role on team (e.g. Lead Investigator)" value={p.role || ''} onChange={(e) => set(p.id, { role: e.target.value })} />}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <input className="input" placeholder="Full name" value={p.name || ''} onChange={(e) => set(p.id, { name: e.target.value })} />
              <input className="input" placeholder="Company" value={p.company || ''} onChange={(e) => set(p.id, { company: e.target.value })} />
              <input className="input" placeholder="Contact (phone / email)" value={p.contact || ''} onChange={(e) => set(p.id, { contact: e.target.value })} />
              {allowRole && <input className="input sm:col-span-3" placeholder="Role (e.g. External Expert)" value={p.role || ''} onChange={(e) => set(p.id, { role: e.target.value })} />}
            </div>
          )}
        </div>
      ))}

      <div className="flex gap-2">
        <button type="button" className="btn-soft" onClick={() => add('internal')}><UserPlus size={15} /> Internal</button>
        <button type="button" className="btn-ghost" onClick={() => add('external')}><UserPlus size={15} /> External</button>
      </div>
    </div>
  )
}

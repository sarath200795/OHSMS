import { Plus, X } from 'lucide-react'
import { Button, Input, Select } from '../../../shared/ui'

const STATUSES = [
  { key: 'open', label: 'Open' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'closed', label: 'Closed' },
]

const EMPTY = { description: '', owner: '', dueDate: '', status: 'open' }

/**
 * Corrective and preventive actions on a stakeholder record.
 *
 * Same shape as the incident and audit CAPA arrays on purpose: the central
 * Action Tracker reads every module through one extractor, so these rows appear
 * there beside everything else rather than being a fourth private to-do list
 * nobody looks at.
 *
 * "Final action taken" already exists on the escalation and stays — it is the
 * narrative of how the complaint was closed with the customer. This is the
 * different question of what the ORGANISATION has to change so it does not
 * happen again, which has an owner and a date and outlives the complaint.
 */
export default function CapaEditor({ value = [], onChange, disabled = false }) {
  const rows = Array.isArray(value) ? value : []

  const add = () => onChange([...rows, { ...EMPTY, id: `capa-${Math.random().toString(36).slice(2, 10)}` }])
  const set = (i, patch) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const remove = (i) => onChange(rows.filter((_, idx) => idx !== i))

  const open = rows.filter((r) => r.status !== 'closed').length

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-ink-800">Corrective &amp; preventive actions</h2>
          <p className="text-xs text-ink-500">
            What has to change so this does not recur. These appear in the central Action Tracker.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {rows.length > 0 && (
            <span className="text-xs text-ink-500">{open} open of {rows.length}</span>
          )}
          <Button variant="ghost" className="px-2.5 py-1 text-xs" icon={Plus} onClick={add} disabled={disabled}>
            Add action
          </Button>
        </div>
      </div>

      {!rows.length ? (
        <p className="rounded-xl bg-ink-50 px-3 py-2.5 text-xs text-ink-500">
          No actions raised. Add one if something needs to change beyond settling this case.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div
              key={r.id || i}
              className="grid grid-cols-1 gap-2 rounded-xl bg-ink-50 p-2.5 sm:grid-cols-[2.2fr_1fr_1fr_1fr_auto]"
            >
              <Input
                placeholder="What needs to be done"
                value={r.description}
                onChange={(e) => set(i, { description: e.target.value })}
                disabled={disabled}
              />
              <Input
                placeholder="Owner"
                value={r.owner}
                onChange={(e) => set(i, { owner: e.target.value })}
                disabled={disabled}
              />
              <Input
                type="date"
                value={r.dueDate}
                onChange={(e) => set(i, { dueDate: e.target.value })}
                disabled={disabled}
              />
              <Select value={r.status} onChange={(e) => set(i, { status: e.target.value })} disabled={disabled}>
                {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </Select>
              <Button variant="ghost" className="px-2 py-1" icon={X} onClick={() => remove(i)} disabled={disabled} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

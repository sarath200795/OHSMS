import { ListChecks } from 'lucide-react'
import ActionEditor from '../ActionEditor'

/** Step 4 — CAPA actions (corrective & preventive). */
export default function StepCapa({ value = [], onChange, users }) {
  return (
    <div className="card p-6">
      <div className="mb-4 flex items-center gap-2">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-brand-500/10 text-brand-600"><ListChecks size={18} /></div>
        <div>
          <h3 className="font-bold text-ink-900">Corrective & Preventive Actions</h3>
          <p className="text-xs text-ink-400">Assign an owner and a due date — these feed the Action Tracker.</p>
        </div>
      </div>
      <ActionEditor value={value} onChange={onChange} users={users} />
    </div>
  )
}

import { Users } from 'lucide-react'
import PersonEditor from '../PersonEditor'

/** Step 2 — Investigation team (internal + external, with roles). */
export default function StepTeam({ value = [], onChange, users }) {
  return (
    <div className="card p-6">
      <div className="mb-4 flex items-center gap-2">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-brand-500/10 text-brand-600"><Users size={18} /></div>
        <div>
          <h3 className="font-bold text-ink-900">Investigation Team</h3>
          <p className="text-xs text-ink-400">Form the team that will investigate this incident.</p>
        </div>
      </div>
      <PersonEditor value={value} onChange={onChange} users={users} allowRole />
    </div>
  )
}

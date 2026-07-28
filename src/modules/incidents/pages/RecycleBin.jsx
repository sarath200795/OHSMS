import toast from 'react-hot-toast'
import { motion } from 'framer-motion'
import { Trash2, RotateCcw, X, ClipboardList, Activity } from 'lucide-react'
import { PageHeader, EmptyState } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useIncidents } from '../context/IncidentContext'
import { restoreIncident, purgeIncident } from '../lib/incidents'
import { restoreIllness, purgeIllness } from '../lib/illnesses'

export default function RecycleBin() {
  const { deletedIncidents, deletedIllnesses } = useIncidents()
  const { orgId, profile, user } = useAuth()
  const actor = { uid: user?.uid, name: profile?.name }

  const items = [
    ...deletedIncidents.map((i) => ({ ...i, _kind: 'incident' })),
    ...deletedIllnesses.map((i) => ({ ...i, _kind: 'illness' })),
  ]

  const restore = async (it) => {
    try {
      if (it._kind === 'incident') await restoreIncident(orgId, it.id, actor)
      else await restoreIllness(orgId, it.id, actor)
      toast.success(`${it.refNo} restored`)
    } catch (e) { toast.error(e.message || 'Could not restore') }
  }
  const purge = async (it) => {
    if (!window.confirm(`Permanently delete ${it.refNo}? This cannot be undone.`)) return
    try {
      if (it._kind === 'incident') await purgeIncident(orgId, it.id, actor, it.refNo)
      else await purgeIllness(orgId, it.id, actor, it.refNo)
      toast.success(`${it.refNo} permanently deleted`)
    } catch (e) { toast.error(e.message || 'Could not purge') }
  }

  return (
    <div>
      <PageHeader title="Recycle Bin" subtitle="Soft-deleted incidents & illnesses" icon={Trash2} />
      {items.length === 0 ? (
        <EmptyState icon={Trash2} title="Recycle bin is empty" hint="Deleted records can be restored from here." />
      ) : (
        <div className="space-y-2">
          {items.map((it) => (
            <motion.div key={`${it._kind}:${it.id}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="card flex items-center gap-3 p-4">
              <div className="grid h-10 w-10 place-items-center rounded-xl text-white" style={{ backgroundColor: it._kind === 'incident' ? '#795548' : '#0891b2' }}>
                {it._kind === 'incident' ? <ClipboardList size={18} /> : <Activity size={18} />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-ink-900">{it.refNo}</p>
                <p className="truncate text-sm text-ink-500 capitalize">{it._kind} · deleted by {it.deletedBy || 'unknown'}</p>
              </div>
              <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => restore(it)}><RotateCcw size={14} /> Restore</button>
              <button className="btn-danger px-3 py-1.5 text-xs" onClick={() => purge(it)}><X size={14} /> Delete forever</button>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}

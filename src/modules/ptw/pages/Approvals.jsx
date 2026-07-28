import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ClipboardCheck, MapPin, ChevronRight, Clock, Lock, TimerReset } from 'lucide-react'
import { PageHeader, EmptyState } from '../components/ui'
import StatusBadge from '../components/StatusBadge'
import { usePermits } from '../context/PermitContext'

const fmt = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** What is this permit waiting on from me? */
function pendingKind(p) {
  if (p.closure && (p.closure.engineering?.status === 'pending' || p.closure.operations?.status === 'pending')) {
    return { icon: Lock, label: 'Closure approval', color: '#0ea5e9' }
  }
  if (p.extension && (p.extension.engineering?.status === 'pending' || p.extension.operations?.status === 'pending')) {
    return { icon: TimerReset, label: 'Extension approval', color: '#7c3aed' }
  }
  return { icon: Clock, label: 'Permit approval', color: '#a16207' }
}

export default function Approvals() {
  const navigate = useNavigate()
  const { approvalQueue } = usePermits()

  return (
    <div>
      <PageHeader icon={ClipboardCheck} title="Approvals" subtitle="Permits awaiting your team's decision" tourId="approvals-header" />

      {approvalQueue.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="Nothing to approve" hint="You're all caught up — new requests for your team will appear here." />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {approvalQueue.map((p, i) => {
            const kind = pendingKind(p)
            const Icon = kind.icon
            return (
              <motion.button
                key={p.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.03, 0.3) }}
                onClick={() => navigate(`/permits/${p.id}`)}
                className="card pressable p-4 text-left"
                style={{ borderLeft: `4px solid ${kind.color}` }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-ink-900">{p.permitNo}</span>
                      <StatusBadge status={p.status} />
                    </div>
                    <p className="mt-0.5 text-sm text-ink-600">{p.typeOfWork}</p>
                  </div>
                  <ChevronRight size={18} className="shrink-0 text-ink-300" />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-500">
                  <span className="inline-flex items-center gap-1"><MapPin size={12} /> {p.jobLocation || '—'}</span>
                  <span>Valid {fmt(p.validFrom)}</span>
                </div>
                <div className="mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold" style={{ backgroundColor: `${kind.color}1a`, color: kind.color }}>
                  <Icon size={13} /> {kind.label} needed
                </div>
              </motion.button>
            )
          })}
        </div>
      )}
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Eye, CheckCircle2, AlertTriangle, FileText, QrCode, Monitor } from 'lucide-react'
import { PageHeader, EmptyState, Spinner } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { subscribeObservations } from '../lib/firestore'

const fmt = (ts) => {
  if (!ts) return ''
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'safe', label: 'Safe' },
  { key: 'unsafe', label: 'Unsafe' },
]

export default function Observations() {
  const { profile } = useAuth()
  const [obs, setObs] = useState(null)
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    if (!profile?.orgId) return undefined
    return subscribeObservations(profile.orgId, setObs)
  }, [profile?.orgId])

  const visible = useMemo(() => {
    if (!obs) return []
    return filter === 'all' ? obs : obs.filter((o) => o.type === filter)
  }, [obs, filter])

  return (
    <div>
      <PageHeader icon={Eye} title="Observations" subtitle="Safety observations logged against permits" tourId="observations-header" />

      <div className="mb-5 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`chip transition ${filter === f.key ? 'bg-brand-500 text-white' : 'bg-clay-surface text-ink-600 hover:bg-clay-100'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {obs === null ? (
        <div className="grid place-items-center py-20"><Spinner size={28} /></div>
      ) : visible.length === 0 ? (
        <EmptyState icon={Eye} title="No observations yet" hint="Observations logged via QR scan or in-app will appear here." />
      ) : (
        <div className="space-y-2.5">
          {visible.map((o, i) => {
            const unsafe = o.type === 'unsafe'
            const color = unsafe ? '#991b1b' : '#16a34a'
            const Icon = unsafe ? AlertTriangle : CheckCircle2
            return (
              <motion.div key={o.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.02, 0.3) }}
                className="card p-4" style={{ borderLeft: `4px solid ${color}` }}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="chip" style={{ backgroundColor: `${color}1a`, color }}><Icon size={13} /> {unsafe ? 'Unsafe' : 'Safe'}</span>
                  <Link to={`/permits/${o.permitId}`} className="inline-flex items-center gap-1 font-bold text-ink-900 hover:text-brand-600">
                    <FileText size={14} /> {o.permitNo || o.permitId}
                  </Link>
                  <span className="ml-auto inline-flex items-center gap-1 text-xs text-ink-400">
                    {o.source === 'qr' ? <QrCode size={12} /> : <Monitor size={12} />} {o.source === 'qr' ? 'QR scan' : 'Portal'}
                  </span>
                </div>
                {o.note && <p className="mt-2 text-sm text-ink-700">{o.note}</p>}
                <p className="mt-1.5 text-xs text-ink-400">
                  {o.observedByName || 'Unknown'} · {fmt(o.at)}
                  {unsafe && <span className="font-semibold text-red-600"> · permit closed for non-compliance</span>}
                </p>
              </motion.div>
            )
          })}
        </div>
      )}
    </div>
  )
}

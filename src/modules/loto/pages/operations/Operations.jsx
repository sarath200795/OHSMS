import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useOrgProcedures } from '../../hooks/useOrgProcedures'
import { PROCEDURE_STATUS, LOCK_STATUS, LOCK_STATUS_META } from '../../constants/procedures'
import PageHeader, { HdrIcon } from '../../components/PageHeader'
import EmptyState from '../../components/EmptyState'
import Card from '../../components/ui/Card'
import Spinner from '../../components/ui/Spinner'
import Badge from '../../components/ui/Badge'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: LOCK_STATUS.UNLOCKED, label: 'Not locked' },
  { key: LOCK_STATUS.PARTIAL, label: 'Partially locked' },
  { key: LOCK_STATUS.LOCKED, label: 'Equipment locked' },
]

export default function Operations() {
  const navigate = useNavigate()
  const { procedures, loading } = useOrgProcedures()
  const [filter, setFilter] = useState('all')

  const approved = useMemo(
    () => procedures.filter((p) => p.status === PROCEDURE_STATUS.APPROVED),
    [procedures],
  )
  const filtered = approved.filter((p) => {
    const st = p.lockSummary?.status || LOCK_STATUS.UNLOCKED
    return filter === 'all' ? true : st === filter
  })

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <PageHeader
        icon={<HdrIcon d={<><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>} />}
        title="LOTO Operations"
        subtitle="Approved equipment ready to lock out / unlock. Open one to perform LOTO."
      />

      <div className="mt-6 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-all ${
              filter === f.key
                ? 'bg-hazard/15 text-amber-600 shadow-clay-inset'
                : 'bg-steel-800 text-steel-300'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="mt-5 space-y-3">
        {loading ? (
          <div className="py-16">
            <Spinner label="Loading equipment…" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No equipment to operate"
            subtitle={
              approved.length === 0
                ? 'Approve a procedure first — only approved procedures can be operated.'
                : 'No equipment matches this filter.'
            }
          />
        ) : (
          filtered.map((p) => {
            const status = p.lockSummary?.status || LOCK_STATUS.UNLOCKED
            const lm = LOCK_STATUS_META[status]
            return (
              <Card key={p.id} animate={false} className="!p-0">
                <button
                  onClick={() => navigate(`/loto/operations/${p.id}`)}
                  className="flex w-full items-center justify-between gap-3 p-5 text-left"
                >
                  <div className="min-w-0">
                    <div className="truncate text-lg font-bold text-steel-50">{p.equipment}</div>
                    <div className="truncate text-xs text-steel-400">
                      {p.site} · <span className="font-mono">{p.procedureCode}</span>
                      {p.primaryTech ? ` · Primary: ${p.primaryTech.name}` : ''}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-xs text-steel-400">
                      {p.lockSummary?.lockedCount || 0}/{p.lockSummary?.total || 0}
                    </span>
                    <Badge className={lm.accent}>
                      {status === LOCK_STATUS.LOCKED && '🔒 '}
                      {lm.label}
                    </Badge>
                    <span className="text-steel-400">→</span>
                  </div>
                </button>
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}

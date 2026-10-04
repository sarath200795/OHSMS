import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { toastCaught } from '../../../../shared/lib/toastCaught'
import { useAuth } from '../../context/AuthContext'
import { PERMISSIONS } from '../../constants/roles'
import { usePermits, useNow } from '../../hooks/usePermits'
import { CLOSED_STATUSES, OPEN_STATUSES, PERMIT_STATUS, workTypeLabel } from '../../constants/permits'
import { permitClock, toMs } from '../../utils/permitWindow'
import PageHeader, { HdrIcon } from '../../components/PageHeader'
import EmptyState from '../../components/EmptyState'
import Card from '../../components/ui/Card'
import Spinner from '../../components/ui/Spinner'
import Button from '../../components/ui/Button'
import { PermitClockBadge, PermitStatusBadge } from '../../components/permits/PermitBadges'
import PermitStandard from '../../components/permits/PermitStandard'
import PermitDashboard from '../../components/permits/PermitDashboard'

// `match` gets the clock so "Overdue" and "Due soon" agree with the row badges
// and the dashboard tiles (server flags first, then this browser's clock).
const FILTERS = [
  { key: 'open', label: 'Open', match: (p) => OPEN_STATUSES.includes(p.status) },
  { key: 'overdue', label: 'Overdue', match: (p, now) => permitClock(p, now)?.state === 'overdue' },
  { key: 'due', label: 'Due soon', match: (p, now) => permitClock(p, now)?.state === 'due' },
  { key: 'requested', label: 'Awaiting approval', match: (p) => p.status === PERMIT_STATUS.REQUESTED },
  { key: 'active', label: 'Active', match: (p) => p.status === PERMIT_STATUS.ACTIVE },
  { key: 'closed', label: 'Closed', match: (p) => CLOSED_STATUSES.includes(p.status) },
  { key: 'all', label: 'All', match: () => true },
]

const fmt = (ms) =>
  Number.isFinite(ms)
    ? new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : '—'

export default function Permits() {
  const navigate = useNavigate()
  const { can, platformRole } = useAuth()
  const { permits, loading } = usePermits()
  const now = useNow()
  const [filter, setFilter] = useState('open')
  const canRaise = can(PERMISSIONS.PERMIT_REQUEST) && platformRole !== 'auditor'

  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter) || FILTERS[0]
    return permits.filter((p) => f.match(p, now))
  }, [permits, filter, now])

  const onExport = async () => {
    if (!shown.length) return toast.error('Nothing to export')
    try {
      const { exportPermitsXlsx } = await import('../../utils/permitExcel')
      const day = new Date().toISOString().slice(0, 10)
      const { permits: n, points } = exportPermitsXlsx(shown, `LOTO_Permits_${day}.xlsx`)
      toast.success(`Exported ${n} permit${n === 1 ? '' : 's'} and ${points} isolation point${points === 1 ? '' : 's'}`)
    } catch (err) {
      toastCaught(err, 'Export failed')
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <PageHeader
        icon={<HdrIcon d={<><path d="M9 4h6l1 2h3v14H5V6h3l1-2Z" /><path d="M9 12h6M9 16h4" /></>} />}
        title="LOTO Permits"
        subtitle="One permit per job: who, what equipment, which approved procedure, and the shift window."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="steel" onClick={onExport}>
              Export Excel
            </Button>
            {canRaise && <Button onClick={() => navigate('/loto/permits/new')}>Raise a permit</Button>}
          </div>
        }
      />
      <PermitStandard />
      {!loading && <PermitDashboard permits={permits} now={now} onPick={setFilter} />}

      <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Filter permits">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-all ${
              filter === f.key ? 'bg-hazard/15 text-amber-600' : 'bg-steel-800 text-steel-300'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="mt-5 space-y-3">
        {loading ? (
          <div className="py-16">
            <Spinner label="Loading permits…" />
          </div>
        ) : shown.length === 0 ? (
          <EmptyState
            title="No permits here"
            subtitle={filter === 'open' ? 'Nothing is waiting or running.' : 'No permit matches this filter.'}
          />
        ) : (
          shown.map((p) => (
            <Link key={p.id} to={`/loto/permits/${encodeURIComponent(p.id)}`} className="block">
              <Card animate={false} className="!p-4 transition-colors hover:border-steel-500">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-bold text-steel-100">{p.permitNo || p.id}</span>
                      <PermitStatusBadge status={p.status} />
                      <PermitClockBadge clock={permitClock(p, now)} />
                    </div>
                    <p className="mt-1 truncate text-sm text-steel-200">
                      {workTypeLabel(p.workType)}
                      {p.equipment ? ` · ${p.equipment}` : ''}
                      {p.site ? ` · ${p.site}` : ''}
                    </p>
                    <p className="mt-0.5 line-clamp-1 text-xs text-steel-400">{p.reason}</p>
                  </div>
                  <div className="text-right text-xs text-steel-400">
                    <div>{fmt(toMs(p.windowStart))}</div>
                    <div>to {fmt(toMs(p.windowEnd))}</div>
                    {p.pointCount > 0 && <div>{p.pointCount} isolation point{p.pointCount === 1 ? '' : 's'}</div>}
                  </div>
                </div>
              </Card>
            </Link>
          ))
        )}
      </div>
    </div>
  )
}

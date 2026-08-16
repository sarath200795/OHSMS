import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { useOrgEvents, useOrgProcedures } from '../../hooks/useOrgProcedures'
import { numberIsolationPoints } from '../../utils/codes'
import { LOCK_STATUS, LOCK_STATUS_META } from '../../constants/procedures'
import Card from '../../components/ui/Card'
import Spinner from '../../components/ui/Spinner'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import PageHeader, { HdrIcon } from '../../components/PageHeader'
import EmptyState from '../../components/EmptyState'
import { Pager } from '../../../../shared/ui'
import { usePagination } from '../../../../shared/ui/usePagination'
import { downloadRegisterCsv, downloadEventsCsv } from '../../utils/registerExport'

const FILTERS = [
  { key: 'active', label: 'Locked / partial' },
  { key: LOCK_STATUS.LOCKED, label: 'Equipment locked' },
  { key: LOCK_STATUS.PARTIAL, label: 'Partially locked' },
  { key: LOCK_STATUS.UNLOCKED, label: 'Unlocked' },
  { key: 'all', label: 'All' },
]

const timeStr = (iso) => (iso ? new Date(iso).toLocaleString() : '')
const tsStr = (ts) => {
  if (!ts) return '—'
  const d = ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

export default function Register() {
  const navigate = useNavigate()
  const { procedures, loading } = useOrgProcedures()
  const { events, loading: eventsLoading } = useOrgEvents()
  const [tab, setTab] = useState('live') // 'live' | 'log'
  const [filter, setFilter] = useState('active')

  const stats = useMemo(() => {
    const s = { locked: 0, partial: 0, unlocked: 0 }
    procedures.forEach((p) => {
      const st = p.lockSummary?.status || LOCK_STATUS.UNLOCKED
      s[st] = (s[st] || 0) + 1
    })
    return s
  }, [procedures])

  const filtered = useMemo(
    () =>
      procedures.filter((p) => {
        const st = p.lockSummary?.status || LOCK_STATUS.UNLOCKED
        if (filter === 'all') return true
        if (filter === 'active') return st !== LOCK_STATUS.UNLOCKED
        return st === filter
      }),
    [procedures, filter],
  )

  function exportCsv() {
    if (tab === 'log') {
      if (!events.length) return toast.error('No activity to export')
      downloadEventsCsv(events)
    } else {
      if (!procedures.length) return toast.error('Nothing to export')
      downloadRegisterCsv(procedures)
    }
    toast.success('CSV exported')
  }
  function exportPdf() {
    const log = tab === 'log'
    if (log ? !events.length : !procedures.length) return toast.error('Nothing to export')
    toast.promise(
      import('../../utils/pdf').then((m) =>
        log ? m.generateActivityLogPdf(events) : m.generateRegisterPdf(procedures),
      ),
      { loading: 'Building PDF…', success: 'PDF exported', error: 'Export failed' },
    )
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <PageHeader
        icon={<HdrIcon d={<><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>} />}
        title="LOTO Register"
        subtitle="Live lock state and a permanent record of every lock / unlock action."
        actions={
          <>
            <Button size="sm" variant="steel" onClick={exportCsv}>
              Export CSV
            </Button>
            <Button size="sm" variant="steel" onClick={exportPdf}>
              Export PDF
            </Button>
          </>
        }
      />

      {/* Tabs */}
      <div className="mt-5 inline-flex rounded-2xl bg-steel-800 p-1 shadow-clay-inset">
        {[
          { k: 'live', label: 'Live Status' },
          { k: 'log', label: `Activity Log${events.length ? ` (${events.length})` : ''}` },
        ].map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            className={`rounded-xl px-4 py-1.5 text-sm font-semibold transition-all ${
              tab === t.k ? 'bg-claySurface text-steel-50 shadow-clay' : 'text-steel-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'live' ? (
        <LiveStatus
          loading={loading}
          stats={stats}
          filter={filter}
          setFilter={setFilter}
          filtered={filtered}
          navigate={navigate}
        />
      ) : (
        <ActivityLog loading={eventsLoading} events={events} />
      )}
    </div>
  )
}

function LiveStatus({ loading, stats, filter, setFilter, filtered, navigate }) {
  const { pageItems, page, setPage, pageCount, total, pageSize } = usePagination(filtered)
  return (
    <>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <StatCard label="Equipment locked" value={stats.locked || 0} className="bg-danger/10 text-danger" />
        <StatCard label="Partially locked" value={stats.partial || 0} className="bg-hazard/10 text-amber-600" />
        <StatCard label="Unlocked" value={stats.unlocked || 0} className="bg-steel-800 text-steel-300" />
      </div>

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
            <Spinner label="Loading register…" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState title="Nothing to show" subtitle="No equipment matches this filter." />
        ) : (
          pageItems.map((p, i) => {
            const status = p.lockSummary?.status || LOCK_STATUS.UNLOCKED
            const lm = LOCK_STATUS_META[status]
            const points = numberIsolationPoints(p.isolationPoints || [])
            const lockedPoints = points.filter((pt) => pt.lockState?.locked)
            const remaining = points.filter((pt) => !pt.lockState?.locked)
            return (
              <motion.div key={p.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                <Card animate={false} className="!p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <button
                        onClick={() => navigate(`/loto/procedures/${p.id}`)}
                        className="text-left text-lg font-bold text-steel-50 hover:text-amber-600"
                      >
                        {p.equipment}
                      </button>
                      <div className="text-xs text-steel-400">
                        {p.site} · <span className="font-mono">{p.procedureCode}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge className={lm.accent}>
                        {status === LOCK_STATUS.LOCKED && '🔒 '}
                        {lm.label}
                      </Badge>
                      <div className="mt-1 text-xs text-steel-400">
                        {p.lockSummary?.lockedCount || 0}/{p.lockSummary?.total || 0} points
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {points.map((pt) => (
                      <span
                        key={pt.key}
                        title={pt.lockState?.locked ? `Locked by ${pt.lockState.lockedByName}` : 'Unlocked'}
                        className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold"
                        style={{
                          borderColor: pt.color,
                          background: pt.lockState?.locked ? pt.color : 'transparent',
                          color: pt.lockState?.locked ? pt.textColor : pt.color,
                        }}
                      >
                        {pt.lockState?.locked ? '🔒' : '○'} {pt.pointId}
                      </span>
                    ))}
                  </div>

                  {status === LOCK_STATUS.PARTIAL && remaining.length > 0 && (
                    <div className="mt-3 rounded-lg bg-hazard/10 px-3 py-2 text-xs text-amber-600">
                      <span className="font-semibold">Needs locking to complete:</span>{' '}
                      {remaining.map((pt) => pt.pointId).join(', ')}
                    </div>
                  )}

                  {lockedPoints.length > 0 && (
                    <div className="mt-4 space-y-1 border-t border-steel-700 pt-3">
                      {lockedPoints.map((pt) => (
                        <div key={pt.key} className="flex items-center justify-between text-xs text-steel-300">
                          <span>
                            <span className="font-semibold text-steel-100">{pt.pointId}</span> locked by{' '}
                            {pt.lockState.lockedByName}
                          </span>
                          <span className="text-steel-400">{timeStr(pt.lockState.lockedAt)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </motion.div>
            )
          })
        )}
        <Pager
          className="border-t border-steel-700/60 px-1 pt-3"
          page={page} pageCount={pageCount} onPage={setPage} total={total} pageSize={pageSize}
        />
      </div>
    </>
  )
}

function ActivityLog({ loading, events }) {
  // Its own pager — sharing one with the live list would blank whichever tab
  // you are not paging. The CSV/PDF exports upstream still take all `events`.
  const { pageItems, page, setPage, pageCount, total, pageSize } = usePagination(events)
  if (loading) {
    return (
      <div className="py-16">
        <Spinner label="Loading activity…" />
      </div>
    )
  }
  if (!events.length) {
    return (
      <div className="mt-6">
        <EmptyState
          title="No activity yet"
          subtitle="Lock or unlock an isolation point to start the log."
        />
      </div>
    )
  }
  return (
    <Card animate={false} className="mt-6 overflow-hidden !p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-steel-800 text-xs uppercase tracking-wider text-steel-300">
            <tr>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Equipment</th>
              <th className="px-4 py-3">Point</th>
              <th className="px-4 py-3">Energy</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">By</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((e) => (
              <tr key={e.id} className="border-t border-steel-700/60">
                <td className="whitespace-nowrap px-4 py-2.5 text-steel-300">{tsStr(e.at)}</td>
                <td className="px-4 py-2.5 text-steel-100">
                  {e.equipment}
                  <span className="block text-xs text-steel-400">{e.site}</span>
                </td>
                <td className="px-4 py-2.5 font-semibold text-steel-100">{e.pointId}</td>
                <td className="px-4 py-2.5 text-steel-300">{(e.energy || '').replace(' Energy', '')}</td>
                <td className="px-4 py-2.5">
                  {(() => {
                    // Group lock applied counts as a LOCK action, not unlock.
                    const isLock = e.action === 'lock' || e.action === 'group_join'
                    const label =
                      e.action === 'group_join'
                        ? '🔒 Group lock'
                        : e.action === 'group_leave'
                          ? '🔓 Group removed'
                          : isLock
                            ? '🔒 Locked'
                            : '🔓 Unlocked'
                    return (
                      <Badge className={isLock ? 'bg-danger/15 text-danger' : 'bg-safe/15 text-safe'}>
                        {label}
                      </Badge>
                    )
                  })()}
                </td>
                <td className="px-4 py-2.5 text-steel-300">{e.byName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager
        className="border-t border-steel-700/60 px-4 py-3"
        page={page} pageCount={pageCount} onPage={setPage} total={total} pageSize={pageSize}
      />
    </Card>
  )
}

function StatCard({ label, value, className }) {
  return (
    <div className={`rounded-2xl p-4 shadow-clay ${className}`}>
      <div className="text-3xl font-extrabold">{value}</div>
      <div className="text-xs font-medium uppercase tracking-wider opacity-80">{label}</div>
    </div>
  )
}

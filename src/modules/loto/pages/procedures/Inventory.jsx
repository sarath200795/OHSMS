import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '../../context/AuthContext'
import { useOrgProcedures } from '../../hooks/useOrgProcedures'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import Spinner from '../../components/ui/Spinner'
import Badge from '../../components/ui/Badge'
import PageHeader, { HdrIcon } from '../../components/PageHeader'
import EmptyState from '../../components/EmptyState'
import { PERMISSIONS } from '../../constants/roles'
import {
  LOCK_STATUS_META,
  PROCEDURE_STATUS,
  PROCEDURE_STATUS_META,
} from '../../constants/procedures'
import { deleteProcedure, getProcedurePhotos } from '../../services/procedures'

const loadPdf = () => import('../../utils/pdf')

const inputCls =
  'rounded-xl bg-clay px-3 py-2 text-sm text-steel-100 shadow-clay-inset outline-none ring-2 ring-transparent focus:ring-hazard/50'

export default function Inventory() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const { procedures, loading } = useOrgProcedures()
  const [site, setSite] = useState('all')
  const [status, setStatus] = useState('all')
  const [equipment, setEquipment] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  const sites = useMemo(
    () => [...new Set(procedures.map((p) => p.site).filter(Boolean))].sort(),
    [procedures],
  )

  const filtered = useMemo(
    () =>
      procedures.filter((p) => {
        if (site !== 'all' && p.site !== site) return false
        if (status !== 'all' && p.status !== status) return false
        if (
          equipment.trim() &&
          !p.equipment?.toLowerCase().includes(equipment.trim().toLowerCase())
        )
          return false
        return true
      }),
    [procedures, site, status, equipment],
  )

  const statusCounts = useMemo(() => {
    const c = { total: procedures.length }
    Object.values(PROCEDURE_STATUS).forEach((s) => (c[s] = 0))
    procedures.forEach((p) => {
      if (c[p.status] != null) c[p.status] += 1
    })
    return c
  }, [procedures])

  async function onDelete(p) {
    if (!window.confirm(`Delete "${p.equipment}"? This cannot be undone.`)) return
    try {
      await deleteProcedure(p)
      toast.success('Deleted')
    } catch (err) {
      toast.error(err.message || 'Delete failed')
    }
  }

  const allSelected = filtered.length > 0 && filtered.every((p) => selected.has(p.id))
  const toggleSel = (id) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  const toggleAll = () =>
    setSelected((prev) => {
      if (filtered.every((p) => prev.has(p.id))) {
        const next = new Set(prev)
        filtered.forEach((p) => next.delete(p.id))
        return next
      }
      return new Set([...prev, ...filtered.map((p) => p.id)])
    })

  // Bulk print: a separate file per selected procedure (sequenced so the
  // browser doesn't drop concurrent downloads).
  async function bulkPrint(kind) {
    const items = filtered.filter((p) => selected.has(p.id))
    if (!items.length) return
    setBulkBusy(true)
    const id = toast.loading(`Preparing 0/${items.length}…`)
    try {
      const m = await loadPdf()
      let done = 0
      for (const p of items) {
        if (kind === 'tags') {
          await m.generateTagsPdf(p)
        } else {
          const ph = await getProcedurePhotos(p.id)
          await m.generateProcedurePdf(p, ph)
        }
        done += 1
        toast.loading(`Preparing ${done}/${items.length}…`, { id })
        await new Promise((r) => setTimeout(r, 350))
      }
      toast.success(
        `Downloaded ${done} ${kind === 'tags' ? 'tag sheet(s)' : 'procedure(s)'}`,
        { id },
      )
    } catch {
      toast.error('Some downloads failed', { id })
    } finally {
      setBulkBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <PageHeader
        icon={<HdrIcon d={<><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v12h14V8" /><path d="M9 12h6" /></>} />}
        title="Procedure Inventory"
        subtitle="Analyse procedures by status; filter, regenerate documents, revise or delete."
        actions={
          can(PERMISSIONS.PROCEDURE_CREATE) ? (
            <Button onClick={() => navigate('/loto/procedures/new')}>+ New procedure</Button>
          ) : null
        }
      />

      {/* Status summary */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatCard label="Total" value={statusCounts.total} className="border-steel-600 bg-steel-800/60 text-steel-100" />
        <StatCard label="Draft" value={statusCounts[PROCEDURE_STATUS.DRAFT]} className="border-steel-600 bg-steel-800/60 text-steel-300" />
        <StatCard label="Pending" value={statusCounts[PROCEDURE_STATUS.PENDING_APPROVAL]} className="border-hazard/40 bg-hazard/10 text-amber-600" />
        <StatCard label="Approved" value={statusCounts[PROCEDURE_STATUS.APPROVED]} className="border-safe/40 bg-safe/10 text-safe" />
        <StatCard label="Rejected" value={statusCounts[PROCEDURE_STATUS.REJECTED]} className="border-danger/40 bg-danger/10 text-danger" />
      </div>

      {/* Filters */}
      <div className="mt-6 flex flex-wrap gap-3 rounded-xl border border-steel-800 bg-steel-900/40 p-3">
        <select value={site} onChange={(e) => setSite(e.target.value)} className={inputCls}>
          <option value="all">All sites</option>
          {sites.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className={inputCls}
        >
          <option value="all">All statuses</option>
          {Object.values(PROCEDURE_STATUS).map((s) => (
            <option key={s} value={s}>
              {PROCEDURE_STATUS_META[s].label}
            </option>
          ))}
        </select>
        <input
          value={equipment}
          onChange={(e) => setEquipment(e.target.value)}
          placeholder="Search equipment…"
          className={`${inputCls} flex-1 min-w-[180px]`}
        />
        <div className="flex items-center px-2 text-sm text-steel-400">
          {filtered.length} of {procedures.length}
        </div>
      </div>

      {/* Bulk selection bar */}
      {selected.size > 0 && (
        <div className="sticky top-16 z-20 mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-claySurface px-4 py-2.5 shadow-clay lg:top-3">
          <span className="text-sm font-semibold text-steel-100">{selected.size} selected</span>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={bulkBusy} onClick={() => bulkPrint('procedures')}>
              Print procedures ({selected.size})
            </Button>
            <Button size="sm" variant="steel" loading={bulkBusy} onClick={() => bulkPrint('tags')}>
              Print tags ({selected.size})
            </Button>
            <Button size="sm" variant="ghost" disabled={bulkBusy} onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* List */}
      <div className="mt-5">
        {loading ? (
          <div className="py-16">
            <Spinner label="Loading procedures…" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No procedures found"
            subtitle={
              procedures.length === 0
                ? 'Create your first LOTO procedure to get started.'
                : 'Try adjusting your filters.'
            }
            icon={
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v12h14V8" /><path d="M9 12h6" />
              </svg>
            }
          />
        ) : (
          <Card animate={false} className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="bg-steel-800 text-xs uppercase tracking-wider text-steel-300">
                  <tr>
                    <th className="w-10 px-3 py-3">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-hazard"
                        checked={allSelected}
                        onChange={toggleAll}
                        aria-label="Select all"
                      />
                    </th>
                    <th className="px-3 py-3">Equipment</th>
                    <th className="px-3 py-3">Code</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Lock</th>
                    <th className="px-3 py-3">Rev</th>
                    <th className="px-3 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => {
                    const sm = PROCEDURE_STATUS_META[p.status]
                    const lm = LOCK_STATUS_META[p.lockSummary?.status || 'unlocked']
                    const checked = selected.has(p.id)
                    return (
                      <tr
                        key={p.id}
                        className={`border-t border-steel-700/60 transition-colors hover:bg-steel-800/40 ${
                          checked ? 'bg-hazard/5' : ''
                        }`}
                      >
                        <td className="px-3 py-2.5">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-hazard"
                            checked={checked}
                            onChange={() => toggleSel(p.id)}
                            aria-label={`Select ${p.equipment}`}
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <button
                            onClick={() => navigate(`/loto/procedures/${p.id}`)}
                            className="text-left font-semibold text-steel-50 hover:text-amber-600"
                          >
                            {p.equipment}
                          </button>
                          <div className="text-xs text-steel-400">{p.site}</div>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs text-amber-600">{p.procedureCode}</td>
                        <td className="px-3 py-2.5">{sm && <Badge className={sm.accent}>{sm.label}</Badge>}</td>
                        <td className="px-3 py-2.5">
                          <Badge className={lm.accent}>{lm.label}</Badge>
                          <div className="mt-0.5 text-[11px] text-steel-400">
                            {p.lockSummary?.lockedCount || 0}/{p.lockSummary?.total || 0}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-steel-400">R{p.revision ?? 0}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex justify-end gap-1.5">
                            <button
                              onClick={() => navigate(`/loto/procedures/${p.id}`)}
                              className="rounded-lg bg-steel-700 px-2.5 py-1 text-xs font-semibold text-steel-100 hover:bg-steel-600"
                            >
                              View
                            </button>
                            <button
                              onClick={() =>
                                toast.promise(
                                  Promise.all([loadPdf(), getProcedurePhotos(p.id)]).then(
                                    ([m, ph]) => m.generateProcedurePdf(p, ph),
                                  ),
                                  { loading: 'PDF…', success: 'PDF downloaded', error: 'Failed' },
                                )
                              }
                              className="rounded-lg bg-steel-800 px-2.5 py-1 text-xs font-medium text-steel-200 hover:bg-steel-700"
                            >
                              PDF
                            </button>
                            <button
                              onClick={() =>
                                toast.promise(
                                  loadPdf().then((m) => m.generateTagsPdf(p)),
                                  { loading: 'Tags…', success: 'Tags downloaded', error: 'Failed' },
                                )
                              }
                              className="rounded-lg bg-steel-800 px-2.5 py-1 text-xs font-medium text-steel-200 hover:bg-steel-700"
                            >
                              Tags
                            </button>
                            {can(PERMISSIONS.PROCEDURE_REVISE) && (
                              <button
                                onClick={() => navigate(`/loto/procedures/${p.id}/revise`)}
                                className="rounded-lg bg-steel-800 px-2.5 py-1 text-xs font-medium text-steel-200 hover:bg-steel-700"
                              >
                                Revise
                              </button>
                            )}
                            {can(PERMISSIONS.PROCEDURE_DELETE) && (
                              <button
                                onClick={() => onDelete(p)}
                                className="rounded-lg px-2.5 py-1 text-xs font-medium text-danger hover:bg-danger/10"
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, className }) {
  return (
    <div className={`rounded-xl border p-3 text-center ${className}`}>
      <div className="text-2xl font-extrabold">{value ?? 0}</div>
      <div className="text-[10px] font-medium uppercase tracking-wider opacity-80">{label}</div>
    </div>
  )
}

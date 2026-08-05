import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Wrench, CalendarDays, AlertTriangle, ArrowRight } from 'lucide-react'
import { useOrgData } from '../../context/OrgDataContext'
import PageHeader from '../../components/PageHeader'
import Button from '../../components/ui/Button'
import Select from '../../components/ui/Select'
import Modal from '../../components/ui/Modal'
import EmptyState from '../../components/ui/EmptyState'
import { labelize } from '../../components/ui/Badge'
import { CAPA_STATUSES, updateCapa } from '../../services/capa'
import { updateFinding } from '../../services/findings'
import { formatDate, isOverdue } from '../../lib/format'

const COLUMN_TONE = {
  open: 'border-t-rose-400',
  in_progress: 'border-t-amber-400',
  verified: 'border-t-brand-400',
  closed: 'border-t-emerald-400',
}

export default function Capa() {
  const { orgId, capas, userById, findingById } = useOrgData()
  const [selected, setSelected] = useState(null)
  const [saving, setSaving] = useState(false)

  const byStatus = (status) => capas.filter((c) => (c.status || 'open') === status)

  const save = async (e) => {
    e.preventDefault()
    const el = e.target
    const newStatus = el.status.value
    setSaving(true)
    try {
      await updateCapa(orgId, selected.id, {
        status: newStatus,
        verificationNote: el.verificationNote.value,
        closedAt: newStatus === 'closed' ? new Date().toISOString() : null,
      })
      // Closing the CAPA closes its linked finding.
      if (newStatus === 'closed' && selected.findingId) {
        await updateFinding(orgId, selected.findingId, { status: 'closed' })
      }
      setSelected(null)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="CAPA"
        subtitle="Corrective & preventive actions — from root cause to verified closure."
      />

      {capas.length === 0 ? (
        <EmptyState
          icon={Wrench}
          title="No corrective actions yet"
          message="Open a CAPA from a finding to start driving it to closure."
          action={
            <Link
              to="/audit/findings"
              className="inline-flex items-center gap-2 rounded-xl bg-brand-gradient px-4 py-2.5 text-sm font-semibold text-white shadow-brand"
            >
              Go to Findings <ArrowRight className="h-4 w-4" />
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {CAPA_STATUSES.map((status) => {
            const items = byStatus(status)
            return (
              <div
                key={status}
                className={`rounded-2xl border border-slate-200 border-t-4 bg-slate-50/50 ${COLUMN_TONE[status]}`}
              >
                <div className="flex items-center justify-between px-4 py-3">
                  <h3 className="text-sm font-bold text-ink-800">{labelize(status)}</h3>
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold text-slate-500">
                    {items.length}
                  </span>
                </div>
                <div className="space-y-2 px-3 pb-3">
                  {items.map((c) => {
                    const overdue = isOverdue(c.dueDate, c.status === 'closed')
                    const finding = findingById[c.findingId]
                    return (
                      <button
                        key={c.id}
                        onClick={() => setSelected(c)}
                        className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:shadow-md"
                      >
                        <p className="line-clamp-2 text-sm font-medium text-ink-800">
                          {c.action}
                        </p>
                        {finding && (
                          <p className="mt-1 flex items-center gap-1 text-xs text-slate-400">
                            <AlertTriangle className="h-3 w-3" />
                            <span className="truncate">{finding.description}</span>
                          </p>
                        )}
                        <div className="mt-2 flex items-center justify-between">
                          <span className="text-xs text-slate-400">
                            {userById[c.assigneeUid]?.name || 'Unassigned'}
                          </span>
                          <span
                            className={`flex items-center gap-1 text-xs ${
                              overdue ? 'font-semibold text-rose-600' : 'text-slate-400'
                            }`}
                          >
                            <CalendarDays className="h-3 w-3" />
                            {formatDate(c.dueDate)}
                          </span>
                        </div>
                      </button>
                    )
                  })}
                  {items.length === 0 && (
                    <p className="px-1 py-4 text-center text-xs text-slate-300">
                      Nothing here
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title="Corrective action"
        subtitle={selected ? labelize(selected.status) : ''}
      >
        {selected && (
          <form onSubmit={save} className="space-y-5">
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-sm font-medium text-ink-800">{selected.action}</p>
              {selected.rootCause && (
                <p className="mt-1 text-xs text-slate-500">
                  <span className="font-semibold">Root cause:</span> {selected.rootCause}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                <span>Owner: {userById[selected.assigneeUid]?.name || 'Unassigned'}</span>
                <span>Due: {formatDate(selected.dueDate)}</span>
              </div>
              {selected.findingId && findingById[selected.findingId] && (
                <Link
                  to={`/findings/${selected.findingId}`}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700"
                >
                  View linked finding <ArrowRight className="h-3 w-3" />
                </Link>
              )}
            </div>

            <Select label="Status" name="status" defaultValue={selected.status || 'open'}>
              {CAPA_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {labelize(s)}
                </option>
              ))}
            </Select>

            <div>
              <label className="field-label">Verification note</label>
              <textarea
                name="verificationNote"
                rows={3}
                defaultValue={selected.verificationNote || ''}
                placeholder="How was effectiveness verified before closure?"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-400/30"
              />
            </div>

            <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700">
              Marking a CAPA <strong>Closed</strong> also closes its linked finding.
            </p>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setSelected(null)}>
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                Save
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}

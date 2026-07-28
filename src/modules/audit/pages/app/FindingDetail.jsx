import { useEffect, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Wrench,
  Trash2,
  CalendarDays,
  ClipboardCheck,
  Plus,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useOrgData } from '../../context/OrgDataContext'
import PageHeader from '../../components/PageHeader'
import Card, { CardHeader } from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Select from '../../components/ui/Select'
import Input from '../../components/ui/Input'
import Modal from '../../components/ui/Modal'
import Badge, {
  SEVERITY_TONES,
  STATUS_TONES,
  labelize,
} from '../../components/ui/Badge'
import { FullPageSpinner } from '../../components/ui/Spinner'
import {
  subscribeFinding,
  updateFinding,
  deleteFinding,
} from '../../services/findings'
import { createCapa } from '../../services/capa'
import { formatDate, dateInputValue, isOverdue } from '../../lib/format'

export default function FindingDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { orgId, siteById, userById, capas, users } = useOrgData()
  const { isAdmin } = useAuth()
  const [finding, setFinding] = useState(undefined)
  const [capaOpen, setCapaOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!orgId) return undefined
    return subscribeFinding(orgId, id, setFinding)
  }, [orgId, id])

  if (finding === undefined) return <FullPageSpinner />
  if (finding === null) {
    return (
      <div className="text-center">
        <p className="text-slate-500">Finding not found.</p>
        <Link to="/audit/findings" className="link-accent mt-3 inline-block">
          Back to findings
        </Link>
      </div>
    )
  }

  const linkedCapas = capas.filter((c) => c.findingId === id)
  const approvedUsers = users.filter((u) => u.status === 'approved')
  const overdue = isOverdue(finding.dueDate, finding.status === 'closed')

  const patch = (data) => updateFinding(orgId, id, data)

  const remove = async () => {
    if (window.confirm('Delete this finding?')) {
      await deleteFinding(orgId, id)
      navigate('/audit/findings')
    }
  }

  const submitCapa = async (e) => {
    e.preventDefault()
    const el = e.target
    setSaving(true)
    try {
      await createCapa(orgId, {
        findingId: id,
        action: el.action.value,
        rootCause: el.rootCause.value,
        assigneeUid: el.assigneeUid.value || null,
        dueDate: el.dueDate.value ? new Date(el.dueDate.value).toISOString() : null,
      })
      // Move the finding into progress once a CAPA exists.
      if (finding.status === 'open') patch({ status: 'in_progress' })
      setCapaOpen(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <Link
        to="/audit/findings"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="h-4 w-4" /> Findings
      </Link>

      <PageHeader
        title={finding.description || 'Finding'}
        subtitle={`Clause ${finding.clause || '—'} · ${siteById[finding.siteId]?.name || 'Unassigned site'}`}
        action={
          isAdmin && (
            <Button variant="ghost" icon={Trash2} onClick={remove} aria-label="Delete finding" />
          )
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Details */}
        <Card className="lg:col-span-2">
          <CardHeader title="Details" />
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Severity
              </dt>
              <dd className="mt-1">
                <Badge tone={SEVERITY_TONES[finding.severity]}>
                  {labelize(finding.severity)}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Raised
              </dt>
              <dd className="mt-1 text-ink-800">{formatDate(finding.raisedAt)}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Raised by
              </dt>
              <dd className="mt-1 text-ink-800">
                {userById[finding.raisedByUid]?.name || '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Target close
              </dt>
              <dd className={`mt-1 ${overdue ? 'font-semibold text-rose-600' : 'text-ink-800'}`}>
                {formatDate(finding.dueDate)}
                {overdue && ' (overdue)'}
              </dd>
            </div>
          </dl>

          <div className="mt-5 border-t border-slate-100 pt-5">
            <label className="field-label">Description</label>
            <textarea
              defaultValue={finding.description}
              onBlur={(e) =>
                e.target.value !== finding.description &&
                patch({ description: e.target.value })
              }
              rows={3}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-400/30"
            />
          </div>

          {finding.auditId && (
            <Link
              to={`/audits/${finding.auditId}`}
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:text-brand-700"
            >
              <ClipboardCheck className="h-4 w-4" /> View source audit
            </Link>
          )}
        </Card>

        {/* Status control */}
        <Card>
          <CardHeader title="Status" />
          <Select value={finding.status} onChange={(e) => patch({ status: e.target.value })}>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="closed">Closed</option>
          </Select>
          <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
            <p className="font-semibold text-slate-600">Path to closure</p>
            <ol className="mt-2 list-decimal space-y-1 pl-4">
              <li>Open a corrective action (CAPA).</li>
              <li>Assign an owner & root cause.</li>
              <li>Verify the action is effective.</li>
              <li>Close the finding.</li>
            </ol>
          </div>
        </Card>
      </div>

      {/* Linked CAPAs */}
      <Card className="mt-6">
        <CardHeader
          title={`Corrective actions (${linkedCapas.length})`}
          action={
            <Button size="sm" icon={Plus} onClick={() => setCapaOpen(true)}>
              Add CAPA
            </Button>
          }
        />
        {linkedCapas.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">
            No corrective actions yet. Add one to drive this finding to closure.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {linkedCapas.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium text-ink-800">
                    <Wrench className="h-4 w-4 text-brand-500" />
                    {c.action}
                  </p>
                  {c.rootCause && (
                    <p className="mt-0.5 text-xs text-slate-400">Root cause: {c.rootCause}</p>
                  )}
                  <p className="mt-0.5 text-xs text-slate-400">
                    {userById[c.assigneeUid]?.name || 'Unassigned'} · due{' '}
                    {formatDate(c.dueDate)}
                  </p>
                </div>
                <Link to="/audit/capa">
                  <Badge tone={STATUS_TONES[c.status]}>{labelize(c.status)}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal open={capaOpen} onClose={() => setCapaOpen(false)} title="Add corrective action">
        <form onSubmit={submitCapa} className="space-y-5">
          <div>
            <label className="field-label">Action</label>
            <textarea
              name="action"
              required
              rows={2}
              placeholder="What will be done to correct this?"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-400/30"
            />
          </div>
          <div>
            <label className="field-label">Root cause</label>
            <textarea
              name="rootCause"
              rows={2}
              placeholder="Why did this happen?"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-400/30"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Select label="Assignee" name="assigneeUid">
              <option value="">Unassigned</option>
              {approvedUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
            <Input
              label="Due date"
              name="dueDate"
              type="date"
              icon={CalendarDays}
              defaultValue={dateInputValue(finding.dueDate)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setCapaOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Add CAPA
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

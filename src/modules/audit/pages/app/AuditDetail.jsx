import { useEffect, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  CalendarDays,
  MapPin,
  User,
  Trash2,
  Flag,
  CheckCircle2,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useOrgData } from '../../context/OrgDataContext'
import PageHeader from '../../components/PageHeader'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Select from '../../components/ui/Select'
import Input from '../../components/ui/Input'
import Modal from '../../components/ui/Modal'
import Badge, { STATUS_TONES, labelize } from '../../components/ui/Badge'
import { FullPageSpinner } from '../../components/ui/Spinner'
import {
  subscribeAudit,
  updateAudit,
  deleteAudit,
} from '../../services/audits'
import { createFinding } from '../../services/findings'
import { formatDate } from '../../lib/format'

const CONFORMITY = [
  { value: 'pending', label: 'Pending' },
  { value: 'conforming', label: 'Conforming' },
  { value: 'minor_nc', label: 'Minor NC' },
  { value: 'major_nc', label: 'Major NC' },
  { value: 'na', label: 'N/A' },
]

const CONFORMITY_TONE = {
  pending: 'slate',
  conforming: 'green',
  minor_nc: 'amber',
  major_nc: 'red',
  na: 'slate',
}

export default function AuditDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { orgId, siteById, userById, findings } = useOrgData()
  const { firebaseUser, isAdmin } = useAuth()
  const [audit, setAudit] = useState(undefined)
  const [findingFor, setFindingFor] = useState(null) // clause object
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!orgId) return undefined
    return subscribeAudit(orgId, id, setAudit)
  }, [orgId, id])

  if (audit === undefined) return <FullPageSpinner />
  if (audit === null) {
    return (
      <div className="text-center">
        <p className="text-slate-500">Audit not found.</p>
        <Link to="/audit" className="link-accent mt-3 inline-block">
          Back to audits
        </Link>
      </div>
    )
  }

  const auditFindings = findings.filter((f) => f.auditId === id)
  const clauses = audit.clauses || []

  const updateClause = (index, patch) => {
    const next = clauses.map((c, i) => (i === index ? { ...c, ...patch } : c))
    updateAudit(orgId, id, { clauses: next })
  }

  const setStatus = (status) => updateAudit(orgId, id, { status })

  const remove = async () => {
    if (window.confirm(`Delete audit "${audit.title}"?`)) {
      await deleteAudit(orgId, id)
      navigate('/audit')
    }
  }

  const submitFinding = async (e) => {
    e.preventDefault()
    const formEl = e.target
    setSaving(true)
    try {
      await createFinding(orgId, {
        auditId: id,
        siteId: audit.siteId || null,
        clause: findingFor.ref,
        description: formEl.description.value,
        severity: formEl.severity.value,
        dueDate: formEl.dueDate.value
          ? new Date(formEl.dueDate.value).toISOString()
          : null,
        raisedByUid: firebaseUser?.uid || null,
      })
      // Reflect the nonconformity on the clause row.
      const conformity = formEl.severity.value === 'major' ? 'major_nc' : 'minor_nc'
      const idx = clauses.findIndex((c) => c.ref === findingFor.ref)
      if (idx >= 0) updateClause(idx, { conformity })
      setFindingFor(null)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <Link
        to="/audit"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="h-4 w-4" /> Audits
      </Link>

      <PageHeader
        title={audit.title}
        subtitle={`${audit.standard || 'ISO 45001'} internal audit`}
        action={
          <div className="flex items-center gap-2">
            <Select
              value={audit.status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-40"
            >
              <option value="planned">Planned</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
            </Select>
            {isAdmin && (
              <Button variant="ghost" icon={Trash2} onClick={remove} aria-label="Delete audit" />
            )}
          </div>
        }
      />

      {/* Meta */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="flex items-center gap-3">
          <MapPin className="h-5 w-5 text-brand-500" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Site</p>
            <p className="text-sm font-medium text-ink-800">
              {siteById[audit.siteId]?.name || 'Unassigned'}
            </p>
          </div>
        </Card>
        <Card className="flex items-center gap-3">
          <CalendarDays className="h-5 w-5 text-brand-500" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Scheduled</p>
            <p className="text-sm font-medium text-ink-800">
              {formatDate(audit.scheduledDate)}
            </p>
          </div>
        </Card>
        <Card className="flex items-center gap-3">
          <User className="h-5 w-5 text-brand-500" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Lead auditor</p>
            <p className="text-sm font-medium text-ink-800">
              {userById[audit.auditorUid]?.name || 'Unassigned'}
            </p>
          </div>
        </Card>
      </div>

      {/* Clause checklist */}
      <Card className="p-0">
        <div className="border-b border-slate-100 px-5 py-4">
          <h3 className="text-base font-bold text-ink-800">Clause checklist</h3>
          <p className="text-sm text-slate-500">
            Assess each ISO 45001 clause and raise findings for nonconformities.
          </p>
        </div>
        <ul className="divide-y divide-slate-100">
          {clauses.map((c, i) => (
            <li key={c.ref} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
                      Clause {c.ref}
                    </span>
                    <Badge tone={CONFORMITY_TONE[c.conformity]}>
                      {CONFORMITY.find((x) => x.value === c.conformity)?.label}
                    </Badge>
                  </div>
                  <p className="mt-1.5 text-sm font-medium text-ink-800">
                    {c.requirement}
                  </p>
                  <input
                    defaultValue={c.notes}
                    onBlur={(e) =>
                      e.target.value !== c.notes && updateClause(i, { notes: e.target.value })
                    }
                    placeholder="Notes / evidence…"
                    className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-400/30"
                  />
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Select
                    value={c.conformity}
                    onChange={(e) => updateClause(i, { conformity: e.target.value })}
                    className="w-36"
                  >
                    {CONFORMITY.map((x) => (
                      <option key={x.value} value={x.value}>
                        {x.label}
                      </option>
                    ))}
                  </Select>
                  <Button
                    size="sm"
                    variant="subtle"
                    icon={Flag}
                    onClick={() => setFindingFor(c)}
                  >
                    Raise
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {/* Findings from this audit */}
      <Card className="mt-6">
        <h3 className="mb-3 text-base font-bold text-ink-800">
          Findings from this audit ({auditFindings.length})
        </h3>
        {auditFindings.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">
            No findings raised yet.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {auditFindings.map((f) => (
              <li key={f.id}>
                <Link
                  to={`/findings/${f.id}`}
                  className="flex items-center justify-between gap-3 py-3 hover:opacity-80"
                >
                  <span className="min-w-0 truncate text-sm text-ink-800">
                    Clause {f.clause} · {f.description}
                  </span>
                  <Badge tone={STATUS_TONES[f.status]}>{labelize(f.status)}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Completion hint */}
      {audit.status !== 'completed' && clauses.every((c) => c.conformity !== 'pending') && (
        <div className="mt-4 flex items-center justify-between rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            All clauses assessed — ready to mark this audit completed.
          </span>
          <Button size="sm" variant="secondary" onClick={() => setStatus('completed')}>
            Mark completed
          </Button>
        </div>
      )}

      {/* Raise finding modal */}
      <Modal
        open={!!findingFor}
        onClose={() => setFindingFor(null)}
        title="Raise finding"
        subtitle={findingFor ? `Clause ${findingFor.ref} — ${findingFor.requirement}` : ''}
      >
        {findingFor && (
          <form onSubmit={submitFinding} className="space-y-5">
            <div>
              <label className="field-label">Description</label>
              <textarea
                name="description"
                required
                rows={3}
                placeholder="Describe the nonconformity or observation…"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-400/30"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Select label="Severity" name="severity" defaultValue="minor">
                <option value="observation">Observation</option>
                <option value="minor">Minor</option>
                <option value="major">Major</option>
              </Select>
              <Input label="Target close date" name="dueDate" type="date" icon={CalendarDays} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setFindingFor(null)}>
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                Raise finding
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}

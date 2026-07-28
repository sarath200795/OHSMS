import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Plus, Search, CalendarDays, Flag } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useOrgData } from '../../context/OrgDataContext'
import PageHeader from '../../components/PageHeader'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import Modal from '../../components/ui/Modal'
import EmptyState from '../../components/ui/EmptyState'
import Badge, {
  SEVERITY_TONES,
  STATUS_TONES,
  labelize,
} from '../../components/ui/Badge'
import { createFinding } from '../../services/findings'
import { formatDate, isOverdue, toDate } from '../../lib/format'

export default function Findings() {
  const { orgId, findings, sites, audits, siteById } = useOrgData()
  const { firebaseUser } = useAuth()
  const [filters, setFilters] = useState({ q: '', severity: '', status: '', siteId: '' })
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const setF = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }))

  const filtered = useMemo(() => {
    return findings
      .filter((f) => (filters.severity ? f.severity === filters.severity : true))
      .filter((f) => (filters.status ? f.status === filters.status : true))
      .filter((f) => (filters.siteId ? f.siteId === filters.siteId : true))
      .filter((f) =>
        filters.q
          ? `${f.description} ${f.clause}`.toLowerCase().includes(filters.q.toLowerCase())
          : true,
      )
      .sort((a, b) => (toDate(b.raisedAt)?.getTime() || 0) - (toDate(a.raisedAt)?.getTime() || 0))
  }, [findings, filters])

  const submit = async (e) => {
    e.preventDefault()
    const el = e.target
    setSaving(true)
    try {
      await createFinding(orgId, {
        auditId: el.auditId.value || null,
        siteId: el.siteId.value || null,
        clause: el.clause.value || null,
        description: el.description.value,
        severity: el.severity.value,
        dueDate: el.dueDate.value ? new Date(el.dueDate.value).toISOString() : null,
        raisedByUid: firebaseUser?.uid || null,
      })
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Findings"
        subtitle="Every nonconformity and observation, tracked to closure."
        action={
          <Button icon={Plus} onClick={() => setOpen(true)}>
            Raise finding
          </Button>
        }
      />

      {/* Filters */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          icon={Search}
          placeholder="Search findings…"
          value={filters.q}
          onChange={setF('q')}
        />
        <Select value={filters.severity} onChange={setF('severity')}>
          <option value="">All severities</option>
          <option value="observation">Observation</option>
          <option value="minor">Minor</option>
          <option value="major">Major</option>
        </Select>
        <Select value={filters.status} onChange={setF('status')}>
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="closed">Closed</option>
        </Select>
        <Select value={filters.siteId} onChange={setF('siteId')}>
          <option value="">All sites</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </div>

      {findings.length === 0 ? (
        <EmptyState
          icon={AlertTriangle}
          title="No findings yet"
          message="Findings raised during audits will appear here."
          action={
            <Button icon={Plus} onClick={() => setOpen(true)}>
              Raise a finding
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <Card>
          <p className="py-6 text-center text-sm text-slate-400">
            No findings match your filters.
          </p>
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                <th className="px-5 py-3">Finding</th>
                <th className="px-3 py-3">Site</th>
                <th className="px-3 py-3">Clause</th>
                <th className="px-3 py-3">Severity</th>
                <th className="px-3 py-3">Due</th>
                <th className="px-3 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((f) => {
                const overdue = isOverdue(f.dueDate, f.status === 'closed')
                return (
                  <tr key={f.id} className="group hover:bg-slate-50/60">
                    <td className="px-5 py-3">
                      <Link
                        to={`/findings/${f.id}`}
                        className="font-medium text-ink-800 group-hover:text-brand-700"
                      >
                        {f.description || 'Untitled finding'}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-slate-500">
                      {siteById[f.siteId]?.name || '—'}
                    </td>
                    <td className="px-3 py-3 text-slate-500">{f.clause || '—'}</td>
                    <td className="px-3 py-3">
                      <Badge tone={SEVERITY_TONES[f.severity]}>
                        {labelize(f.severity)}
                      </Badge>
                    </td>
                    <td className={`px-3 py-3 ${overdue ? 'font-semibold text-rose-600' : 'text-slate-500'}`}>
                      {formatDate(f.dueDate)}
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={STATUS_TONES[f.status]}>{labelize(f.status)}</Badge>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Raise finding">
        <form onSubmit={submit} className="space-y-5">
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
            <Input label="Clause" name="clause" icon={Flag} placeholder="e.g. 8.1" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Select label="Site" name="siteId">
              <option value="">Unassigned</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <Input label="Target close date" name="dueDate" type="date" icon={CalendarDays} />
          </div>
          <Select label="Related audit (optional)" name="auditId">
            <option value="">None</option>
            {audits.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </Select>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Raise finding
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ClipboardCheck,
  Plus,
  CalendarDays,
  LayoutGrid,
  List,
  MapPin,
} from 'lucide-react'
import { useOrgData } from '../../context/OrgDataContext'
import PageHeader from '../../components/PageHeader'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import Modal from '../../components/ui/Modal'
import EmptyState from '../../components/ui/EmptyState'
import Badge, { STATUS_TONES, labelize } from '../../components/ui/Badge'
import { createAudit } from '../../services/audits'
import { formatDate, toDate } from '../../lib/format'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const STATUS_DOT = {
  planned: 'bg-sky-400',
  in_progress: 'bg-amber-400',
  completed: 'bg-emerald-400',
}

export default function Audits() {
  const { orgId, sites, audits, users, siteById, userById } = useOrgData()
  const [view, setView] = useState('matrix')
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ title: '', siteId: '', scheduledDate: '', auditorUid: '' })

  const approvedUsers = users.filter((u) => u.status === 'approved')
  const year = new Date().getFullYear()

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await createAudit(orgId, {
        title: form.title,
        siteId: form.siteId,
        auditorUid: form.auditorUid || null,
        scheduledDate: form.scheduledDate
          ? new Date(form.scheduledDate).toISOString()
          : null,
      })
      setOpen(false)
      setForm({ title: '', siteId: '', scheduledDate: '', auditorUid: '' })
    } finally {
      setSaving(false)
    }
  }

  const auditsFor = (siteId, monthIndex) =>
    audits.filter((a) => {
      if (a.siteId !== siteId) return false
      const d = toDate(a.scheduledDate)
      return d && d.getFullYear() === year && d.getMonth() === monthIndex
    })

  return (
    <div>
      <PageHeader
        title="Audits"
        subtitle="Schedule and execute ISO 45001 internal audits."
        action={
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
              <button
                onClick={() => setView('matrix')}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
                  view === 'matrix' ? 'bg-brand-50 text-brand-700' : 'text-slate-500'
                }`}
              >
                <LayoutGrid className="h-4 w-4" /> Matrix
              </button>
              <button
                onClick={() => setView('list')}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
                  view === 'list' ? 'bg-brand-50 text-brand-700' : 'text-slate-500'
                }`}
              >
                <List className="h-4 w-4" /> List
              </button>
            </div>
            <Button icon={Plus} onClick={() => setOpen(true)} disabled={sites.length === 0}>
              Schedule audit
            </Button>
          </div>
        }
      />

      {sites.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title="Add a site first"
          message="Audits are scheduled against sites. Create a site to get started."
          action={
            <Link
              to="/sites"
              className="inline-flex items-center gap-2 rounded-xl bg-brand-gradient px-4 py-2.5 text-sm font-semibold text-white shadow-brand"
            >
              Go to Sites
            </Link>
          }
        />
      ) : audits.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="No audits scheduled"
          message="Plan your first ISO 45001 audit and start tracking findings to closure."
          action={
            <Button icon={Plus} onClick={() => setOpen(true)}>
              Schedule audit
            </Button>
          }
        />
      ) : view === 'matrix' ? (
        <Card className="overflow-x-auto p-0">
          <div className="min-w-[820px]">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h3 className="text-sm font-bold text-ink-800">
                {year} audit schedule
              </h3>
              <div className="flex items-center gap-4 text-xs text-slate-500">
                {Object.entries(STATUS_DOT).map(([k, c]) => (
                  <span key={k} className="flex items-center gap-1.5">
                    <span className={`h-2.5 w-2.5 rounded-full ${c}`} />
                    {labelize(k)}
                  </span>
                ))}
              </div>
            </div>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 border-b border-r border-slate-100 bg-white px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Site
                  </th>
                  {MONTHS.map((m) => (
                    <th
                      key={m}
                      className="border-b border-slate-100 px-1 py-2 text-center text-xs font-semibold text-slate-400"
                    >
                      {m}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sites.map((site) => (
                  <tr key={site.id} className="hover:bg-slate-50/60">
                    <td className="sticky left-0 z-10 border-b border-r border-slate-100 bg-white px-4 py-2 font-medium text-ink-800">
                      <span className="block truncate">{site.name}</span>
                    </td>
                    {MONTHS.map((m, mi) => {
                      const cell = auditsFor(site.id, mi)
                      return (
                        <td
                          key={m}
                          className="border-b border-l border-slate-50 px-1 py-1.5 text-center align-top"
                        >
                          <div className="flex flex-col items-center gap-1">
                            {cell.map((a) => (
                              <Link
                                key={a.id}
                                to={`/audits/${a.id}`}
                                title={a.title}
                                className={`h-3 w-3 rounded-full ring-2 ring-white transition hover:scale-125 ${
                                  STATUS_DOT[a.status] || 'bg-slate-300'
                                }`}
                              />
                            ))}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {[...audits]
            .sort(
              (a, b) =>
                (toDate(a.scheduledDate)?.getTime() || 0) -
                (toDate(b.scheduledDate)?.getTime() || 0),
            )
            .map((a) => (
              <Link key={a.id} to={`/audits/${a.id}`}>
                <Card className="flex items-center justify-between gap-4 transition hover:shadow-md">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
                      <ClipboardCheck className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-ink-800">{a.title}</p>
                      <p className="truncate text-xs text-slate-400">
                        {siteById[a.siteId]?.name || 'Unassigned'} ·{' '}
                        <CalendarDays className="inline h-3 w-3" />{' '}
                        {formatDate(a.scheduledDate)}
                        {a.auditorUid && userById[a.auditorUid]
                          ? ` · ${userById[a.auditorUid].name}`
                          : ''}
                      </p>
                    </div>
                  </div>
                  <Badge tone={STATUS_TONES[a.status]}>{labelize(a.status)}</Badge>
                </Card>
              </Link>
            ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Schedule audit">
        <form onSubmit={submit} className="space-y-5">
          <Input
            label="Audit title"
            icon={ClipboardCheck}
            placeholder="Annual ISO 45001 internal audit"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            required
            autoFocus
          />
          <Select
            label="Site"
            icon={MapPin}
            value={form.siteId}
            onChange={(e) => setForm((f) => ({ ...f, siteId: e.target.value }))}
            required
          >
            <option value="">Select a site…</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Input
            label="Scheduled date"
            type="date"
            icon={CalendarDays}
            value={form.scheduledDate}
            onChange={(e) => setForm((f) => ({ ...f, scheduledDate: e.target.value }))}
            required
          />
          <Select
            label="Lead auditor (optional)"
            value={form.auditorUid}
            onChange={(e) => setForm((f) => ({ ...f, auditorUid: e.target.value }))}
          >
            <option value="">Unassigned</option>
            {approvedUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Schedule audit
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, Scale, UserPlus, X, MessageSquareWarning, Users } from 'lucide-react'
import {
  PageHeader, Button, Modal, Field, Input, Select, Textarea, EmptyState, SkeletonTable, Badge, Pager,
} from '../../../shared/ui'
import { usePagination } from '../../../shared/ui/usePagination'
import SiteScopePicker from '../../../shared/org/SiteScopePicker'
import { useAuth } from '../../../shared/auth/AuthContext'
import { useStakeholder } from '../context/StakeholderContext'
import { addEscalation, updateEscalation, deleteEscalation } from '../lib/firestore'
import {
  ESCALATION_STATUS, ESCALATION_STATUS_BY_KEY, ESCALATION_CHANNEL, SEVERITY, SEVERITY_BY_KEY,
  NOTICE_BY_KEY,
} from '../lib/constants'

const EMPTY = {
  title: '', scope: {}, channel: 'in_person', severity: 'medium', status: 'open',
  raisedOn: '', description: '', members: [],
  legalNoticeReceived: false, legalNoticeRef: '', legalNoticeDate: '',
  finalActionTaken: '', actionTakenOn: '', owner: '',
}

const EMPTY_MEMBER = { memberId: '', name: '', contact: '', note: '' }

export default function Escalations() {
  const { orgId, actor, isManager } = useAuth()
  const { escalations, sites, repeats, loading } = useStakeholder()
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return escalations.filter((e) => {
      if (statusFilter && e.status !== statusFilter) return false
      if (!needle) return true
      return [e.title, e.docId, e.description, e.scope?.siteName, e.finalActionTaken]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle))
        || (e.members || []).some((m) =>
          [m.memberId, m.name].filter(Boolean).some((v) => String(v).toLowerCase().includes(needle)))
    })
  }, [escalations, q, statusFilter])

  const { pageItems, page, setPage, pageCount, total, pageSize } = usePagination(filtered)

  const open = (row) => setForm(row ? { ...EMPTY, ...row } : { ...EMPTY })
  const patch = (p) => setForm((f) => ({ ...f, ...p }))

  const addMember = () => patch({ members: [...(form.members || []), { ...EMPTY_MEMBER }] })
  const setMember = (i, p) =>
    patch({ members: form.members.map((m, idx) => (idx === i ? { ...m, ...p } : m)) })
  const removeMember = (i) => patch({ members: form.members.filter((_, idx) => idx !== i) })

  const save = async () => {
    if (!form.title.trim()) return toast.error('Give the escalation a title')
    // A complaint with nobody attached cannot be followed up, and the repeat
    // -member view depends on this being filled in.
    if (!(form.members || []).some((m) => m.memberId.trim() || m.name.trim())) {
      return toast.error('Add at least one member — who raised this?')
    }
    setBusy(true)
    try {
      if (form.id) await updateEscalation(orgId, form.id, form, actor)
      else await addEscalation(orgId, form, actor)
      toast.success(form.id ? 'Saved' : 'Escalation logged')
      setForm(null)
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (row) => {
    const warn = row.legalCount
      ? `Delete ${row.title}? ${row.legalCount} legal issue(s) point at it and will show as a broken link.`
      : `Delete ${row.title}?`
    // eslint-disable-next-line no-alert
    if (!window.confirm(warn)) return
    try {
      await deleteEscalation(orgId, row.id, row.title, actor)
      toast.success('Deleted')
    } catch (e) {
      toast.error(e.message)
    }
  }

  return (
    <>
      <PageHeader
        title="Customer Escalations"
        subtitle={`${escalations.length} logged`}
        actions={isManager && <Button icon={Plus} onClick={() => open()}>Log escalation</Button>}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select className="w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {ESCALATION_STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </Select>
        <Input
          className="ml-auto max-w-xs"
          placeholder="Search title, member, site…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {/* Carried over from the removed overview tab. A member on their fourth
          complaint is a different conversation from one on their first, and no
          single row in the table below can show that. */}
      {repeats.length > 0 && (
        <div className="card mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm text-ink-600">
          <Users size={15} className="shrink-0 text-amber-600" />
          <span>
            <b>{repeats.length}</b> repeat complainant{repeats.length === 1 ? '' : 's'}:
          </span>
          {repeats.slice(0, 4).map((m) => (
            <button
              key={m.memberId || m.name}
              type="button"
              onClick={() => setQ(m.memberId || m.name)}
              className="rounded-lg bg-ink-100 px-2 py-0.5 text-xs font-semibold text-ink-700 hover:bg-ink-200"
              title="Show their escalations"
            >
              {m.name || m.memberId} ×{m.count}
            </button>
          ))}
          {repeats.length > 4 && <span className="text-xs text-ink-400">+{repeats.length - 4} more</span>}
        </div>
      )}

      {loading ? (
        <SkeletonTable rows={5} />
      ) : !filtered.length ? (
        <EmptyState
          icon={MessageSquareWarning}
          title={q || statusFilter ? 'Nothing matches' : 'No escalations logged'}
          hint={q || statusFilter ? 'Clear the filters to see everything.' : 'Log a customer complaint to start tracking it.'}
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-ink-50/60 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-3 py-2">Ref</th>
                <th className="px-3 py-2">Issue</th>
                <th className="px-3 py-2">Site</th>
                <th className="px-3 py-2">Members</th>
                <th className="px-3 py-2">Severity</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Legal</th>
                {isManager && <th className="px-3 py-2 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {pageItems.map((row) => (
                <tr key={row.id} className="border-t border-ink-100">
                  <td className="px-3 py-2 font-mono text-xs">{row.docId || '—'}</td>
                  <td className="px-3 py-2 font-medium text-ink-800">{row.title}</td>
                  <td className="px-3 py-2">{row.scope?.siteName || '—'}</td>
                  <td className="px-3 py-2">
                    {(row.members || []).length
                      ? `${row.members.length} · ${row.members.map((m) => m.memberId || m.name).filter(Boolean).slice(0, 2).join(', ')}${row.members.length > 2 ? '…' : ''}`
                      : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={SEVERITY_BY_KEY[row.severity]?.tone || 'slate'}>
                      {SEVERITY_BY_KEY[row.severity]?.label || row.severity}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={ESCALATION_STATUS_BY_KEY[row.status]?.tone || 'slate'}>
                      {ESCALATION_STATUS_BY_KEY[row.status]?.label || row.status}
                    </Badge>
                  </td>
                  {/* The column that stops a "resolved" complaint reading as
                      settled when it produced an FIR. */}
                  <td className="px-3 py-2">
                    {row.escalated ? (
                      <Badge tone={row.severeNotices.length ? 'red' : 'amber'} title={`${row.legalCount} legal issue(s)`}>
                        <Scale size={11} className="mr-1 inline" />
                        {row.worstNotice ? NOTICE_BY_KEY[row.worstNotice]?.label : `${row.legalCount}`}
                      </Badge>
                    ) : (
                      <span className="text-xs text-ink-400">—</span>
                    )}
                  </td>
                  {isManager && (
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" className="px-2 py-1 text-xs" icon={Pencil} onClick={() => open(row)} />
                        <Button variant="ghost" className="px-2 py-1 text-xs" icon={Trash2} onClick={() => remove(row)} />
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <Pager
            className="border-t border-ink-100 px-3 py-2"
            page={page} pageCount={pageCount} onPage={setPage} total={total} pageSize={pageSize}
          />
        </div>
      )}

      <Modal open={Boolean(form)} onClose={() => setForm(null)} title={form?.id ? 'Edit escalation' : 'Log customer escalation'} size="lg">
        {form && (
          <div className="space-y-4 p-6">
            <Field label="Title *" htmlFor="etitle">
              <Input id="etitle" value={form.title} onChange={(e) => patch({ title: e.target.value })}
                placeholder="e.g. Repeated equipment failure — refund demanded" />
            </Field>

            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">Site scope</div>
              <SiteScopePicker sites={sites} value={form.scope} onChange={(scope) => patch({ scope })} module="stakeholder" />
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Field label="Raised on" htmlFor="eraised">
                <Input id="eraised" type="date" value={form.raisedOn} onChange={(e) => patch({ raisedOn: e.target.value })} />
              </Field>
              <Field label="Channel" htmlFor="echan">
                <Select id="echan" value={form.channel} onChange={(e) => patch({ channel: e.target.value })}>
                  {ESCALATION_CHANNEL.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </Select>
              </Field>
              <Field label="Severity" htmlFor="esev">
                <Select id="esev" value={form.severity} onChange={(e) => patch({ severity: e.target.value })}>
                  {SEVERITY.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </Select>
              </Field>
              <Field label="Status" htmlFor="estat">
                <Select id="estat" value={form.status} onChange={(e) => patch({ status: e.target.value })}>
                  {ESCALATION_STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </Select>
              </Field>
            </div>

            <Field label="Description of the issue" htmlFor="edesc">
              <Textarea id="edesc" rows={4} value={form.description} onChange={(e) => patch({ description: e.target.value })}
                placeholder="What happened, in the customer's terms." />
            </Field>

            {/* Multiple members: one incident routinely involves several, and
                recording only the loudest loses the pattern. */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-400">Members involved *</span>
                <Button variant="ghost" className="px-2 py-1 text-xs" icon={UserPlus} onClick={addMember}>Add member</Button>
              </div>
              {!(form.members || []).length ? (
                <p className="rounded-xl bg-ink-50 px-3 py-3 text-xs text-ink-500">
                  Add everyone who raised this. Repeat complaints from the same member only show up if they are all recorded.
                </p>
              ) : (
                <div className="space-y-2">
                  {form.members.map((m, i) => (
                    <div key={i} className="grid grid-cols-1 gap-2 rounded-xl bg-ink-50 p-2.5 sm:grid-cols-[1fr_1.2fr_1fr_1.4fr_auto]">
                      <Input placeholder="Member ID" value={m.memberId} onChange={(e) => setMember(i, { memberId: e.target.value })} />
                      <Input placeholder="Name" value={m.name} onChange={(e) => setMember(i, { name: e.target.value })} />
                      <Input placeholder="Phone / email" value={m.contact} onChange={(e) => setMember(i, { contact: e.target.value })} />
                      <Input placeholder="Note" value={m.note} onChange={(e) => setMember(i, { note: e.target.value })} />
                      <Button variant="ghost" className="px-2 py-1 text-xs" icon={X} onClick={() => removeMember(i)} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* A customer can serve a notice directly, with no authority
                involved — that is different from a regulatory matter and is
                captured here rather than as a legal issue. */}
            <div className="rounded-xl border border-ink-200 p-3">
              <label className="flex items-center gap-2 text-sm font-semibold text-ink-700">
                <input
                  type="checkbox"
                  checked={form.legalNoticeReceived}
                  onChange={(e) => patch({ legalNoticeReceived: e.target.checked })}
                />
                A legal notice was received from the customer
              </label>
              {form.legalNoticeReceived && (
                <div className="mt-3 grid grid-cols-2 gap-4">
                  <Field label="Notice reference" htmlFor="enref">
                    <Input id="enref" value={form.legalNoticeRef} onChange={(e) => patch({ legalNoticeRef: e.target.value })} />
                  </Field>
                  <Field label="Notice date" htmlFor="endate">
                    <Input id="endate" type="date" value={form.legalNoticeDate} onChange={(e) => patch({ legalNoticeDate: e.target.value })} />
                  </Field>
                </div>
              )}
              <p className="mt-2 text-xs text-ink-500">
                If an authority became involved, record that as a Legal Issue and link it to this escalation.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr]">
              <Field label="Final action taken" htmlFor="eact">
                <Textarea id="eact" rows={3} value={form.finalActionTaken} onChange={(e) => patch({ finalActionTaken: e.target.value })}
                  placeholder="What was done to close it out with the customer." />
              </Field>
              <div className="space-y-4">
                <Field label="Action date" htmlFor="eacton">
                  <Input id="eacton" type="date" value={form.actionTakenOn} onChange={(e) => patch({ actionTakenOn: e.target.value })} />
                </Field>
                <Field label="Owner" htmlFor="eowner">
                  <Input id="eowner" value={form.owner} onChange={(e) => patch({ owner: e.target.value })} />
                </Field>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button>
              <Button loading={busy} onClick={save}>{form.id ? 'Save' : 'Log escalation'}</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}

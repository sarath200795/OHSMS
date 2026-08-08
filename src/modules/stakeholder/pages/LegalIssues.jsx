import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, Gavel, Link2Off, TriangleAlert } from 'lucide-react'
import {
  PageHeader, Button, Modal, Field, Input, Select, Textarea, EmptyState, SkeletonTable, Badge, Pager,
} from '../../../shared/ui'
import { usePagination } from '../../../shared/ui/usePagination'
import SiteScopePicker from '../../../shared/org/SiteScopePicker'
import { useAuth } from '../../../shared/auth/AuthContext'
import { useStakeholder } from '../context/StakeholderContext'
import { addLegalIssue, updateLegalIssue, deleteLegalIssue } from '../lib/firestore'
import {
  DEPARTMENTS, DEPARTMENT_BY_KEY, DEPARTMENT_GROUPS,
  NOTICE_TYPES, NOTICE_BY_KEY, LEGAL_STATUS, LEGAL_STATUS_BY_KEY,
} from '../lib/constants'

const EMPTY = {
  title: '', scope: {}, escalationId: '', incidentDate: '', description: '',
  departments: [], departmentOther: '', officials: '',
  noticeType: 'none', noticeRef: '', noticeDate: '', responseDueDate: '',
  status: 'open', actionTaken: '', penaltyAmount: '', owner: '',
}

export default function LegalIssues() {
  const { orgId, actor, isManager } = useAuth()
  const { legalIssues, sites, escalationOptions, loading } = useStakeholder()
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  const [deptFilter, setDeptFilter] = useState('')

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return legalIssues.filter((l) => {
      if (deptFilter && !(l.departments || []).includes(deptFilter)) return false
      if (!needle) return true
      return [l.title, l.docId, l.description, l.scope?.siteName, l.noticeRef, l.officials]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle))
    })
  }, [legalIssues, q, deptFilter])

  const { pageItems, page, setPage, pageCount, total, pageSize } = usePagination(filtered)

  const open = (row) => setForm(row ? { ...EMPTY, ...row } : { ...EMPTY })
  const patch = (p) => setForm((f) => ({ ...f, ...p }))

  const toggleDept = (key) =>
    patch({
      departments: form.departments.includes(key)
        ? form.departments.filter((d) => d !== key)
        : [...form.departments, key],
    })

  const save = async () => {
    if (!form.title.trim()) return toast.error('Give the legal issue a title')
    if (!form.departments.length) return toast.error('Which department was involved?')
    if (form.departments.includes('other') && !form.departmentOther.trim()) {
      return toast.error('Name the other department')
    }
    setBusy(true)
    try {
      if (form.id) await updateLegalIssue(orgId, form.id, form, actor)
      else await addLegalIssue(orgId, form, actor)
      toast.success(form.id ? 'Saved' : 'Legal issue logged')
      setForm(null)
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (row) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete ${row.title}?`)) return
    try {
      await deleteLegalIssue(orgId, row.id, row.title, actor)
      toast.success('Deleted')
    } catch (e) {
      toast.error(e.message)
    }
  }

  return (
    <>
      <PageHeader
        title="Legal Issues"
        subtitle={`${legalIssues.length} logged`}
        actions={isManager && <Button icon={Plus} onClick={() => open()}>Log legal issue</Button>}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select className="w-auto" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} aria-label="Filter by department">
          <option value="">All departments</option>
          {DEPARTMENTS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
        </Select>
        <Input
          className="ml-auto max-w-xs"
          placeholder="Search title, notice ref, official…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {loading ? (
        <SkeletonTable rows={5} />
      ) : !filtered.length ? (
        <EmptyState
          icon={Gavel}
          title={q || deptFilter ? 'Nothing matches' : 'No legal issues logged'}
          hint={q || deptFilter ? 'Clear the filters to see everything.' : 'Record a department visit or a notice served, including visits that produced nothing — that is the evidence an inspection happened and passed.'}
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-ink-50/60 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-3 py-2">Ref</th>
                <th className="px-3 py-2">Matter</th>
                <th className="px-3 py-2">Site</th>
                <th className="px-3 py-2">Department</th>
                <th className="px-3 py-2">Notice</th>
                <th className="px-3 py-2">From complaint</th>
                <th className="px-3 py-2">Status</th>
                {isManager && <th className="px-3 py-2 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {pageItems.map((row) => {
                const notice = NOTICE_BY_KEY[row.noticeType]
                return (
                  <tr key={row.id} className="border-t border-ink-100">
                    <td className="px-3 py-2 font-mono text-xs">{row.docId || '—'}</td>
                    <td className="px-3 py-2 font-medium text-ink-800">{row.title}</td>
                    <td className="px-3 py-2">{row.scope?.siteName || '—'}</td>
                    <td className="px-3 py-2">
                      <span className="flex flex-wrap gap-1">
                        {(row.departments || []).slice(0, 2).map((d) => (
                          <Badge key={d} tone="slate">{DEPARTMENT_BY_KEY[d]?.label || d}</Badge>
                        ))}
                        {(row.departments || []).length > 2 && (
                          <span className="text-xs text-ink-400">+{row.departments.length - 2}</span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={notice?.tone || 'slate'}>{notice?.label || row.noticeType}</Badge>
                      {row.noticeRef && <div className="mt-0.5 font-mono text-[11px] text-ink-400">{row.noticeRef}</div>}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {row.escalation ? (
                        <span className="text-ink-600">{row.escalation.docId || row.escalation.title}</span>
                      ) : row.brokenLink ? (
                        // "No complaint" and "the complaint was deleted" are
                        // different facts and must not look the same.
                        <span className="flex items-center gap-1 text-amber-700" title="The linked escalation no longer exists">
                          <Link2Off size={12} /> deleted
                        </span>
                      ) : (
                        <span className="text-ink-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={LEGAL_STATUS_BY_KEY[row.status]?.tone || 'slate'}>
                        {LEGAL_STATUS_BY_KEY[row.status]?.label || row.status}
                      </Badge>
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
                )
              })}
            </tbody>
          </table>
          <Pager
            className="border-t border-ink-100 px-3 py-2"
            page={page} pageCount={pageCount} onPage={setPage} total={total} pageSize={pageSize}
          />
        </div>
      )}

      <Modal open={Boolean(form)} onClose={() => setForm(null)} title={form?.id ? 'Edit legal issue' : 'Log legal issue'} size="lg">
        {form && (
          <div className="space-y-4 p-6">
            <Field label="Title *" htmlFor="ltitle">
              <Input id="ltitle" value={form.title} onChange={(e) => patch({ title: e.target.value })}
                placeholder="e.g. Fire NOC inspection — show cause notice" />
            </Field>

            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">Site scope</div>
              <SiteScopePicker sites={sites} value={form.scope} onChange={(scope) => patch({ scope })} module="stakeholder" />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* The join, stored only here — see linkage.js. */}
              <Field label="Connected customer escalation" htmlFor="lesc" hint="Leave blank if this did not come from a complaint">
                <Select id="lesc" value={form.escalationId} onChange={(e) => patch({ escalationId: e.target.value })}>
                  <option value="">Not linked to a complaint</option>
                  {escalationOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              </Field>
              <Field label="Date of incident / visit" htmlFor="ldate">
                <Input id="ldate" type="date" value={form.incidentDate} onChange={(e) => patch({ incidentDate: e.target.value })} />
              </Field>
            </div>

            <Field label="Description of the incident" htmlFor="ldesc">
              <Textarea id="ldesc" rows={4} value={form.description} onChange={(e) => patch({ description: e.target.value })}
                placeholder="What happened, what the officials asked for, what was shown to them." />
            </Field>

            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">Department(s) visited *</div>
              <div className="space-y-2">
                {DEPARTMENT_GROUPS.map((group) => (
                  <div key={group}>
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-400">{group}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {DEPARTMENTS.filter((d) => d.group === group).map((d) => (
                        <button
                          key={d.key}
                          type="button"
                          onClick={() => toggleDept(d.key)}
                          className={`rounded-xl px-2.5 py-1.5 text-xs font-semibold transition ${
                            form.departments.includes(d.key) ? 'bg-ink-900 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
                          }`}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {form.departments.includes('other') && (
                <Field className="mt-3" label="Name the other department *" htmlFor="ldeptother">
                  <Input id="ldeptother" value={form.departmentOther} onChange={(e) => patch({ departmentOther: e.target.value })} />
                </Field>
              )}
            </div>

            <Field label="Officials who attended" htmlFor="lofficials" hint="Names / designations, if noted">
              <Input id="lofficials" value={form.officials} onChange={(e) => patch({ officials: e.target.value })} />
            </Field>

            <div className="rounded-xl border border-ink-200 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Notice served</div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label="Type" htmlFor="lntype">
                  <Select id="lntype" value={form.noticeType} onChange={(e) => patch({ noticeType: e.target.value })}>
                    {NOTICE_TYPES.map((n) => <option key={n.key} value={n.key}>{n.label}</option>)}
                  </Select>
                </Field>
                <Field label="Reference no." htmlFor="lnref">
                  <Input id="lnref" value={form.noticeRef} onChange={(e) => patch({ noticeRef: e.target.value })} placeholder="FIR / notice number" />
                </Field>
                <Field label="Date served" htmlFor="lndate">
                  <Input id="lndate" type="date" value={form.noticeDate} onChange={(e) => patch({ noticeDate: e.target.value })} />
                </Field>
              </div>
              {NOTICE_BY_KEY[form.noticeType]?.severe && (
                <div className="mt-3 flex items-start gap-2 text-xs text-amber-800">
                  <TriangleAlert size={14} className="mt-0.5 shrink-0" />
                  <span>This notice has a clock on it — set the response due date so it is not missed.</span>
                </div>
              )}
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label="Response due" htmlFor="lndue">
                  <Input id="lndue" type="date" value={form.responseDueDate} onChange={(e) => patch({ responseDueDate: e.target.value })} />
                </Field>
                <Field label="Penalty / fine (₹)" htmlFor="lpen">
                  <Input id="lpen" type="number" min="0" value={form.penaltyAmount} onChange={(e) => patch({ penaltyAmount: e.target.value })} />
                </Field>
                <Field label="Status" htmlFor="lstat">
                  <Select id="lstat" value={form.status} onChange={(e) => patch({ status: e.target.value })}>
                    {LEGAL_STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </Select>
                </Field>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr]">
              <Field label="Action taken" htmlFor="lact">
                <Textarea id="lact" rows={3} value={form.actionTaken} onChange={(e) => patch({ actionTaken: e.target.value })}
                  placeholder="Reply filed, corrections made, compliance submitted…" />
              </Field>
              <Field label="Owner" htmlFor="lowner">
                <Input id="lowner" value={form.owner} onChange={(e) => patch({ owner: e.target.value })} />
              </Field>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button>
              <Button loading={busy} onClick={save}>{form.id ? 'Save' : 'Log legal issue'}</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}

import { useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { UserPlus, Upload, Download, KeyRound, CheckCircle2, AlertCircle } from 'lucide-react'
import { Button, Field, Input, Select, Modal, Badge } from '../../shared/ui'
import { useAuth } from '../../shared/auth/AuthContext'
import { orgDepartments } from '../../shared/auth/access'
import { roleLabel } from '../../shared/auth/permissions'
import {
  TEMP_PASSWORD, PROVISION_ROLES, provisionEmployee, provisionEmployees,
  parseEmployeesCsv, EMPLOYEES_CSV_TEMPLATE,
} from '../../shared/auth/provisioning'

const EMPTY = { name: '', email: '', role: 'member', department: '' }

function TempPasswordNote() {
  return (
    <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
      <KeyRound size={15} className="mt-0.5 shrink-0" />
      <span>
        New employees sign in with their email and the temporary password{' '}
        <b className="font-mono">{TEMP_PASSWORD}</b> — they must set their own password at first login.
      </span>
    </div>
  )
}

/** "Add employee" + "Bulk upload" buttons (with their modals) for the Employees page. */
export default function EmployeeProvisioning({ orgId, orgName, actor, existingEmails = [] }) {
  const { org } = useAuth()
  const departments = orgDepartments(org)
  const [mode, setMode] = useState(null) // 'one' | 'bulk' | null
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)

  // Bulk state
  const [parsed, setParsed] = useState(null) // { headerOk, rows, valid, invalid, fileName }
  const [progress, setProgress] = useState(null) // { done, total }
  const [result, setResult] = useState(null) // { created, failed[] }
  const fileRef = useRef(null)

  const closeAll = () => { setMode(null); setForm(EMPTY); setParsed(null); setProgress(null); setResult(null) }

  const addOne = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return toast.error('Enter the employee name')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return toast.error('Enter a valid email')
    if (existingEmails.some((x) => (x || '').toLowerCase() === form.email.trim().toLowerCase()))
      return toast.error('That email is already a user in this organization')
    setBusy(true)
    try {
      await provisionEmployee(form, { orgId, orgName }, actor)
      toast.success(`${form.name.trim()} added — they can log in with the temp password`)
      closeAll()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const res = await parseEmployeesCsv(file, existingEmails)
      setParsed({ ...res, fileName: file.name })
      setResult(null)
    } catch {
      toast.error('Could not read that CSV file')
    }
  }

  const downloadTemplate = () => {
    const blob = new Blob([EMPLOYEES_CSV_TEMPLATE], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'employees-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const runBulk = async () => {
    if (!parsed?.valid?.length) return
    setBusy(true)
    setProgress({ done: 0, total: parsed.valid.length })
    try {
      const res = await provisionEmployees(
        parsed.valid, { orgId, orgName }, actor,
        (done, total) => setProgress({ done, total }),
      )
      setResult(res)
      if (res.created) toast.success(`${res.created} employee(s) created`)
      if (res.failed.length) toast.error(`${res.failed.length} row(s) failed`)
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <>
      <Button variant="soft" icon={Upload} onClick={() => setMode('bulk')}>Bulk upload</Button>
      <Button icon={UserPlus} onClick={() => setMode('one')}>Add employee</Button>

      {/* ── Add one ── */}
      <Modal open={mode === 'one'} onClose={closeAll} title="Add employee">
        <form onSubmit={addOne} className="space-y-4 p-6">
          <TempPasswordNote />
          <Field label="Full name *" htmlFor="ename">
            <Input id="ename" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Ravi Menon" />
          </Field>
          <Field label="Email (login id) *" htmlFor="eemail">
            <Input id="eemail" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@company.com" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Role" htmlFor="erole" hint="Admins are promoted later from this page">
              <Select id="erole" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {PROVISION_ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
              </Select>
            </Field>
            <Field label="Department" htmlFor="edept">
              <Select id="edept" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
                <option value="">—</option>
                {departments.map((d) => <option key={d}>{d}</option>)}
              </Select>
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={closeAll}>Cancel</Button>
            <Button type="submit" loading={busy} icon={UserPlus}>Create account</Button>
          </div>
        </form>
      </Modal>

      {/* ── Bulk upload ── */}
      <Modal open={mode === 'bulk'} onClose={closeAll} title="Bulk upload employees" size="lg">
        <div className="space-y-4 p-6">
          <TempPasswordNote />
          <p className="text-sm text-ink-500">
            Upload a CSV with columns <b>Name, Email, Role, Department</b>. Role is one of{' '}
            <b>{PROVISION_ROLES.join(' / ')}</b> (blank = member).{' '}
            <button type="button" className="font-semibold text-brand-600 hover:underline" onClick={downloadTemplate}>
              <Download size={12} className="inline" /> Download template
            </button>
          </p>

          <label className="clay-inset flex cursor-pointer flex-col items-center gap-2 rounded-2xl p-6 text-center transition hover:bg-clay-100">
            <Upload size={22} className="text-brand-600" />
            <span className="text-sm font-medium text-ink-700">{parsed ? parsed.fileName : 'Choose a CSV file'}</span>
            <span className="text-xs text-ink-400">Click to browse — .csv</span>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
          </label>

          {parsed && !parsed.headerOk && (
            <div className="rounded-xl bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
              Couldn&apos;t find the required <b>Name</b> and <b>Email</b> columns — check the header row.
            </div>
          )}

          {parsed && parsed.headerOk && !result && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge tone="green">{parsed.valid.length} ready</Badge>
                {parsed.invalid.length > 0 && <Badge tone="red">{parsed.invalid.length} with errors (skipped)</Badge>}
              </div>
              {parsed.invalid.length > 0 && (
                <ul className="max-h-32 space-y-1 overflow-y-auto rounded-xl bg-clay-surface p-3 text-xs text-ink-600 shadow-clay-inset">
                  {parsed.invalid.map((r) => (
                    <li key={r.__row}>
                      <AlertCircle size={12} className="mr-1 inline text-red-500" />
                      Row {r.__row} ({r.email || r.name || '—'}): {r.__errors.join('; ')}
                    </li>
                  ))}
                </ul>
              )}
              {progress && (
                <div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-clay-200">
                    <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-ink-500">Creating accounts… {progress.done}/{progress.total}</p>
                </div>
              )}
            </div>
          )}

          {result && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-ink-800">
                <CheckCircle2 size={16} className="text-green-600" /> {result.created} account(s) created
              </div>
              {result.failed.length > 0 && (
                <ul className="max-h-32 space-y-1 overflow-y-auto rounded-xl bg-red-50 p-3 text-xs text-red-700">
                  {result.failed.map((r, i) => <li key={i}>{r.email}: {r.reason}</li>)}
                </ul>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={closeAll}>{result ? 'Done' : 'Cancel'}</Button>
            {!result && (
              <Button type="button" loading={busy} disabled={!parsed?.valid?.length} onClick={runBulk} icon={UserPlus}>
                Create {parsed?.valid?.length || 0} account{parsed?.valid?.length === 1 ? '' : 's'}
              </Button>
            )}
          </div>
        </div>
      </Modal>
    </>
  )
}

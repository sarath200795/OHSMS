import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { UserPlus, Trash2, MailCheck } from 'lucide-react'
import { Button, Field, IconButton, Input, Modal, Select } from '../../shared/ui'
import { ROLES, roleLabel } from '../../shared/auth/permissions'
import { inviteMember, listInvites, revokeInvite } from '../../shared/functions'
import OwnStackAutoJoin from './OwnStackAutoJoin'
import OwnStackDirectory from './OwnStackDirectory'

const REASONS = {
  'not-admin': 'Only an administrator can invite people.',
  email: 'Enter a valid email address.',
  role: 'Choose a role.',
  'already-member': 'That person already has an account here. Change their role in the list.',
  taken: 'That address is already invited elsewhere.',
  'too-many': 'Too many pending invites. Withdraw some first.',
}

const EMPTY = { email: '', name: '', role: 'member' }

/**
 * The Employees page on a dedicated (own-database) environment.
 *
 * There are no WEEHS passwords on this build: people sign in with their
 * company's identity provider. That proves who they are, not that they belong
 * here, so an admin invites them first and their first sign-in turns the
 * invite into an account with the invited role. EmployeeProvisioning, which
 * creates Firebase accounts, is the shared-site equivalent and does nothing
 * here. stack/invites.mjs is the enforcement; this is the form.
 */
export default function OwnStackInvites() {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [invites, setInvites] = useState(null)
  const [loadFailed, setLoadFailed] = useState(false)
  // Only the newest load may write the list. Opening the dialog and sending an
  // invite both load; if the older response arrived last, it overwrote the
  // newer list and a just-sent invite vanished from it.
  const loadSeq = useRef(0)

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    try {
      const list = await listInvites()
      if (seq !== loadSeq.current) return
      setInvites(list)
      setLoadFailed(false)
    } catch {
      if (seq !== loadSeq.current) return
      // Not an empty list: "No pending invites" after a failed load would tell
      // an admin there is nothing to withdraw when there may be.
      setInvites([])
      setLoadFailed(true)
    }
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const res = await inviteMember(form)
      toast.success(
        res.emailed
          ? `Invited ${res.email}. They have been emailed.`
          : `Invited ${res.email}. Tell them to sign in with their company account.`
      )
      setForm(EMPTY)
      await load()
    } catch (err) {
      toast.error(REASONS[err?.reason] || err?.message || 'The invite was not sent.')
    } finally {
      setBusy(false)
    }
  }

  const withdraw = async (email) => {
    try {
      const res = await revokeInvite(email)
      if (res?.removed === false) {
        // Already gone: they signed in and became a member, or another admin
        // withdrew it. Saying "withdrawn" would hide that they may have access.
        toast(`${email} had no pending invite. Check the employee list.`)
      } else {
        toast.success(`Invite for ${email} withdrawn`)
      }
      await load()
    } catch (err) {
      toast.error(REASONS[err?.reason] || 'The invite was not withdrawn.')
    }
  }

  return (
    <>
      <Button icon={UserPlus} onClick={() => setOpen(true)}>
        Invite employee
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Invite employees"
        subtitle="They sign in with your company account. An invite decides their role."
      >
        <form onSubmit={submit} className="space-y-4 p-6">
          <Field label="Work email" htmlFor="invite-email">
            <Input
              id="invite-email"
              type="email"
              required
              value={form.email}
              onChange={set('email')}
              placeholder="name@company.com"
              autoComplete="off"
            />
          </Field>
          <Field label="Name" htmlFor="invite-name" hint="Optional">
            <Input id="invite-name" value={form.name} onChange={set('name')} />
          </Field>
          <Field label="Role" htmlFor="invite-role">
            <Select id="invite-role" value={form.role} onChange={set('role')}>
              {ROLES.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" loading={busy} icon={MailCheck} className="w-full">
            Send invite
          </Button>

          <div className="border-t border-ink-100 pt-4">
            <h3 className="text-sm font-semibold text-ink-900">Pending invites</h3>
            {invites === null ? (
              <p className="mt-2 text-sm text-ink-500">Loading…</p>
            ) : loadFailed ? (
              <p className="mt-2 text-sm text-ink-500">
                Pending invites could not be loaded.{' '}
                <button
                  type="button"
                  className="font-medium text-brand-700 underline"
                  onClick={load}
                >
                  Try again
                </button>
              </p>
            ) : invites.length === 0 ? (
              <p className="mt-2 text-sm text-ink-500">No pending invites.</p>
            ) : (
              <ul className="mt-2 divide-y divide-ink-100">
                {invites.map((inv) => (
                  <li key={inv.email} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink-900">
                        {inv.email}
                      </span>
                      <span className="block text-xs text-ink-500">
                        {roleLabel(inv.role)}
                        {inv.name && inv.name !== inv.email ? ` · ${inv.name}` : ''}
                      </span>
                    </span>
                    <IconButton
                      type="button"
                      icon={Trash2}
                      label={`Withdraw invite for ${inv.email}`}
                      onClick={() => withdraw(inv.email)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </form>
        <OwnStackAutoJoin open={open} />
        <OwnStackDirectory open={open} />
      </Modal>
    </>
  )
}

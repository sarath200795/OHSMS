import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, Trash2, Copy } from 'lucide-react'
import { Button, Field, IconButton, Input, Select } from '../../shared/ui'
import { ROLES } from '../../shared/auth/permissions'
import {
  createScimToken,
  getGroupRoles,
  revokeScimToken,
  scimStatus,
  setGroupRoles,
} from '../../shared/functions'

const REASONS = {
  'not-admin': 'Only an administrator can change this.',
  rules: 'Every row needs a group name and a role.',
  'too-many': 'At most fifty group rows.',
}

/**
 * Following the company's identity provider instead of mirroring it by hand
 * (stack/directory.mjs): roles from its groups at every sign-in, and SCIM, the
 * standard Okta, Microsoft Entra and Google use to add, change and deactivate
 * people in every app they serve.
 */
export default function OwnStackDirectory({ open }) {
  const [rules, setRules] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [scim, setScim] = useState(null)
  const [token, setToken] = useState('')

  useEffect(() => {
    if (!open) return
    let live = true
    Promise.all([getGroupRoles(), scimStatus()])
      .then(([r, s]) => {
        if (!live) return
        setRules(r)
        setScim(s)
        setLoaded(true)
      })
      .catch(() => live && setLoaded(true))
    return () => {
      live = false
    }
  }, [open])

  const update = (i, key) => (e) =>
    setRules((list) => list.map((r, j) => (j === i ? { ...r, [key]: e.target.value } : r)))

  const saveRules = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const saved = await setGroupRoles(rules.map((r) => ({ group: r.group.trim(), role: r.role })))
      setRules(saved)
      toast.success(
        saved.length
          ? 'Saved. Roles follow these groups from each person’s next sign-in.'
          : 'Saved. Roles are no longer taken from groups.'
      )
    } catch (err) {
      toast.error(REASONS[err?.reason] || err?.message || 'That was not saved.')
    } finally {
      setBusy(false)
    }
  }

  const newToken = async () => {
    if (
      scim?.enabled &&
      !window.confirm(
        'A new token replaces the current one, which stops working at once. Continue?'
      )
    ) {
      return
    }
    try {
      setToken(await createScimToken())
      setScim(await scimStatus())
    } catch (err) {
      toast.error(REASONS[err?.reason] || err?.message || 'No token was made.')
    }
  }

  const revoke = async () => {
    try {
      await revokeScimToken()
      setToken('')
      setScim(await scimStatus())
      toast.success('Sync is off. The token no longer works.')
    } catch (err) {
      toast.error(REASONS[err?.reason] || err?.message || 'That did not work.')
    }
  }

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Copied')
    } catch {
      toast.error('Copy it by hand.')
    }
  }

  const base = `${window.location.origin}/scim/v2`

  return (
    <div className="border-t border-ink-100">
      <form onSubmit={saveRules} className="space-y-3 px-6 pb-4 pt-4">
        <h3 className="text-sm font-semibold text-ink-900">
          Roles from your identity provider’s groups
        </h3>
        <p className="text-sm text-ink-600">
          At every sign-in, someone in a group below gets that role, and can join without an invite.
          Use the group name or ID your identity provider sends. The last administrator is never
          moved.
        </p>
        {rules.map((r, i) => (
          <div key={i} className="flex items-end gap-2">
            <Field label="Group name or ID" htmlFor={`group-${i}`} className="flex-1">
              <Input
                id={`group-${i}`}
                value={r.group}
                onChange={update(i, 'group')}
                autoComplete="off"
              />
            </Field>
            <Field label="Role for this group" htmlFor={`group-role-${i}`}>
              <Select id={`group-role-${i}`} value={r.role} onChange={update(i, 'role')}>
                {ROLES.map((role) => (
                  <option key={role.key} value={role.key}>
                    {role.label}
                  </option>
                ))}
              </Select>
            </Field>
            <IconButton
              type="button"
              icon={Trash2}
              label={`Remove the row for ${r.group || 'this group'}`}
              onClick={() => setRules((list) => list.filter((_, j) => j !== i))}
            />
          </div>
        ))}
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            icon={Plus}
            disabled={!loaded}
            onClick={() => setRules((list) => [...list, { group: '', role: 'member' }])}
          >
            Add a group
          </Button>
          <Button type="submit" variant="soft" loading={busy} disabled={!loaded}>
            Save groups
          </Button>
        </div>
      </form>

      <div className="space-y-3 border-t border-ink-100 px-6 pb-6 pt-4">
        <h3 className="text-sm font-semibold text-ink-900">Automatic sync (SCIM)</h3>
        <p className="text-sm text-ink-600">
          Lets your identity provider (Okta, Microsoft Entra, Google…) add people here when they are
          assigned the app, and disable them the moment they are deactivated or removed there.
        </p>
        <p className="text-sm text-ink-600">
          {scim?.enabled
            ? `On, with a token made ${new Date(scim.createdAt).toLocaleDateString()}.`
            : 'Off.'}
        </p>
        <Field label="SCIM base URL" htmlFor="scim-base">
          <div className="flex gap-2">
            <Input id="scim-base" value={base} readOnly />
            <IconButton
              type="button"
              icon={Copy}
              label="Copy the SCIM base URL"
              onClick={() => copy(base)}
            />
          </div>
        </Field>
        {token && (
          <Field
            label="Token (shown once)"
            htmlFor="scim-token"
            hint="Paste it into your identity provider as the bearer token now. It is not shown again."
          >
            <div className="flex gap-2">
              <Input id="scim-token" value={token} readOnly />
              <IconButton
                type="button"
                icon={Copy}
                label="Copy the SCIM token"
                onClick={() => copy(token)}
              />
            </div>
          </Field>
        )}
        <div className="flex gap-2">
          <Button type="button" variant="soft" disabled={!loaded} onClick={newToken}>
            {scim?.enabled ? 'Make a new token' : 'Turn on sync'}
          </Button>
          {scim?.enabled && (
            <Button type="button" variant="ghost" onClick={revoke}>
              Turn off sync
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

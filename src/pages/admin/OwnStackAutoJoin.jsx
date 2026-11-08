import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Button, Field, Input, Select } from '../../shared/ui'
import { ROLES } from '../../shared/auth/permissions'
import { getAutoJoin, setAutoJoin } from '../../shared/functions'

// Never admin: stack/invites.mjs AUTO_JOIN_ROLES. An administrator is always
// a named decision, made by inviting that person.
const AUTO_ROLES = ROLES.filter((r) => r.key !== 'admin')

const REASONS = {
  'not-admin': 'Only an administrator can change this.',
  domains: 'Enter domains only, like yourcompany.com, separated by commas.',
  role: 'Choose a role.',
  'too-many': 'At most ten domains.',
}

/**
 * Joining without an invite, by email domain, for a company whose identity
 * provider already holds everyone: inviting thousands one at a time does not
 * fit. Their IdP still decides who can sign in at all; this decides who
 * belongs, and with what role.
 */
export default function OwnStackAutoJoin({ open }) {
  const [loaded, setLoaded] = useState(false)
  const [domains, setDomains] = useState('')
  const [role, setRole] = useState('member')
  const [current, setCurrent] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    let live = true
    getAutoJoin()
      .then((auto) => {
        if (!live) return
        setCurrent(auto)
        setDomains(auto ? auto.domains.join(', ') : '')
        setRole(auto?.role || 'member')
        setLoaded(true)
      })
      .catch(() => live && setLoaded(true))
    return () => {
      live = false
    }
  }, [open])

  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const list = domains
        .split(/[,\s]+/)
        .map((d) => d.trim())
        .filter(Boolean)
      const next = await setAutoJoin({ domains: list, role })
      setCurrent(next)
      toast.success(
        next
          ? `Anyone signing in with an address at ${next.domains.join(', ')} now joins.`
          : 'Automatic joining is off. Only invited people join.'
      )
    } catch (err) {
      toast.error(REASONS[err?.reason] || err?.message || 'That was not saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-3 border-t border-ink-100 px-6 pb-6 pt-4">
      <h3 className="text-sm font-semibold text-ink-900">Join automatically</h3>
      <p className="text-sm text-ink-600">
        {current
          ? `On: anyone your company sign-in admits with an address at ${current.domains.join(', ')} joins as ${AUTO_ROLES.find((r) => r.key === current.role)?.label || current.role}.`
          : 'Off: only invited people join. Turn it on to let everyone at your company in without an invite each.'}
      </p>
      <Field
        label="Email domains"
        htmlFor="autojoin-domains"
        hint="For example yourcompany.com. Leave empty to turn this off."
      >
        <Input
          id="autojoin-domains"
          value={domains}
          onChange={(e) => setDomains(e.target.value)}
          placeholder="yourcompany.com"
          autoComplete="off"
          disabled={!loaded}
        />
      </Field>
      <Field
        label="They join as"
        htmlFor="autojoin-role"
        hint="Change anyone’s role later in the list."
      >
        <Select id="autojoin-role" value={role} onChange={(e) => setRole(e.target.value)}>
          {AUTO_ROLES.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </Select>
      </Field>
      <Button type="submit" variant="soft" loading={busy} disabled={!loaded} className="w-full">
        Save
      </Button>
    </form>
  )
}

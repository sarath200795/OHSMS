import { useState } from 'react'
import { Link, useNavigate, Navigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '../../shared/auth/AuthContext'
import { findOrgByName } from '../../shared/org/orgData'
import { authErrorMessage } from '../../shared/lib/authErrors'
import { Button, Field, Input, Select } from '../../shared/ui'
import { DEPARTMENTS } from '../../shared/auth/access'
import AuthLayout from './AuthLayout'
import { validatePassword } from '../../shared/auth/passwordPolicy'

/**
 * Join an existing organization.
 *
 * The organization is TYPED, not chosen from a list, and that is a security
 * decision rather than a UX one. This form used to call listOrganizations() —
 * getDocs() over the whole public index — to fill a dropdown, so opening
 * /signup downloaded the name and orgId of every customer on the platform,
 * unauthenticated. See the /orgIndex block in firestore.rules; `list` is now
 * refused to everyone but the platform operator, so a dropdown is no longer
 * possible even if someone wanted one back.
 *
 * The name is resolved to an id by a single-document read of the index, which
 * stays public because this form has to work before there is an account to
 * authenticate with.
 */
export default function Signup() {
  const { signUpMember, isAuthed, profile } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ orgName: '', name: '', email: '', password: '', department: '' })
  // null = not looked up yet, false = looked for and not there, object = found.
  const [org, setOrg] = useState(null)
  const [checking, setChecking] = useState(false)
  const [busy, setBusy] = useState(false)

  if (isAuthed && profile) return <Navigate to={profile.status === 'approved' ? '/portal' : '/pending'} replace />

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  /**
   * Resolve the typed name.
   *
   * Runs on blur as well as on submit so the answer arrives while the person
   * still has the name in front of them — being told the organization does not
   * exist AFTER choosing a password is the version of this that makes people
   * retype everything.
   */
  const lookup = async (orgName) => {
    const wanted = orgName.trim()
    if (!wanted) { setOrg(null); return null }
    setChecking(true)
    try {
      const found = await findOrgByName(wanted)
      setOrg(found || false)
      return found
    } catch {
      // A lookup that could not run is not the same as a name that is not
      // there, and saying "no such organization" for a dropped connection
      // sends people to register a duplicate of their own company.
      setOrg(null)
      return null
    } finally {
      setChecking(false)
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    // Re-resolved here rather than trusted from the blur: the name may have
    // been edited since, and this is the value the account is created against.
    const found = org && form.orgName.trim().toLowerCase() === org.name.trim().toLowerCase()
      ? org
      : await lookup(form.orgName)
    if (!found) {
      return toast.error('We could not find an organization with that name. Check the spelling with your administrator.')
    }
    const pwError = validatePassword(form.password, { email: form.email, name: form.name })
    if (pwError) return toast.error(pwError)
    setBusy(true)
    try {
      await signUpMember({ ...form, orgId: found.id, orgName: found.name })
      toast.success('Account created — pending admin approval')
      navigate('/pending', { replace: true })
    } catch (err) {
      toast.error(authErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title="Join your organization"
      subtitle="An administrator will approve your access"
      footer={
        <>
          Don&apos;t see your org?{' '}
          <Link to="/register-org" className="font-semibold text-white underline-offset-2 hover:underline">
            Register it
          </Link>{' '}
          ·{' '}
          <Link to="/login" className="font-semibold text-white underline-offset-2 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field
          label="Organization"
          htmlFor="org"
          hint={checking ? 'Checking…' : org ? `Found ${org.name}` : 'Type the name exactly as your administrator registered it'}
          error={org === false ? 'No organization with that name. Check the spelling with your administrator, or register it below.' : ''}
        >
          <Input
            id="org"
            required
            value={form.orgName}
            onChange={(e) => { setOrg(null); set('orgName')(e) }}
            onBlur={(e) => lookup(e.target.value)}
            autoComplete="organization"
          />
        </Field>
        <Field label="Your name" htmlFor="name">
          <Input id="name" required value={form.name} onChange={set('name')} autoComplete="name" />
        </Field>
        <Field label="Department" htmlFor="dept" hint="Site access is requested after you join">
          <Select id="dept" value={form.department} onChange={set('department')}>
            <option value="">Select department…</option>
            {DEPARTMENTS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </Select>
        </Field>
        <Field label="Work email" htmlFor="email">
          <Input id="email" type="email" required value={form.email} onChange={set('email')} autoComplete="email" />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 6 characters">
          <Input id="password" type="password" required value={form.password} onChange={set('password')} autoComplete="new-password" />
        </Field>
        <Button type="submit" loading={busy} className="w-full">
          Request access
        </Button>
      </form>
    </AuthLayout>
  )
}

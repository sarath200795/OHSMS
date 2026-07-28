import { useEffect, useState } from 'react'
import { Link, useNavigate, Navigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '../../shared/auth/AuthContext'
import { listOrganizations } from '../../shared/org/orgData'
import { authErrorMessage } from '../../shared/lib/authErrors'
import { Button, Field, Input, Select } from '../../shared/ui'
import { DEPARTMENTS } from '../../shared/auth/access'
import AuthLayout from './AuthLayout'

export default function Signup() {
  const { signUpMember, isAuthed, profile } = useAuth()
  const navigate = useNavigate()
  const [orgs, setOrgs] = useState([])
  const [form, setForm] = useState({ orgId: '', name: '', email: '', password: '', department: '' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    listOrganizations()
      .then(setOrgs)
      .catch(() => setOrgs([]))
  }, [])

  if (isAuthed && profile) return <Navigate to={profile.status === 'approved' ? '/hub' : '/pending'} replace />

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const submit = async (e) => {
    e.preventDefault()
    if (!form.orgId) return toast.error('Please select your organization.')
    if (form.password.length < 6) return toast.error('Password must be at least 6 characters.')
    setBusy(true)
    try {
      const orgName = orgs.find((o) => o.id === form.orgId)?.name
      await signUpMember({ ...form, orgName })
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
        <Field label="Organization" htmlFor="org">
          <Select id="org" required value={form.orgId} onChange={set('orgId')}>
            <option value="">Select your organization…</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
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

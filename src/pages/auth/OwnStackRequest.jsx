import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Button, Field, Input, Select } from '../../shared/ui'
import { fileProvisioningRequest } from '../../shared/org/provisioningRequest'
import {
  AUTH_METHODS,
  BUCKET_MODES,
  HOSTING_MODES,
  authMethodLabel,
  hostingModeLabel,
  validateProvisioningRequest,
} from '../../shared/org/provisioningSchema'
import AuthLayout from './AuthLayout'

const EMPTY = {
  orgName: '',
  address: '',
  contactName: '',
  contactEmail: '',
  handoffContact: '',
  mode: '',
  engine: '',
  authMethod: '',
  authIssuer: '',
  authClientId: '',
  bucketMode: '',
  bucketName: '',
  bucketRegion: '',
  presignUrl: '',
}

/**
 * File an own-database provisioning request.
 *
 * This component does not import registerOrganization, createOrganization, or
 * Firebase Auth. Calling those from here is the bug the two-choice screen
 * exists to avoid: the company would land on the WEEHS database while the
 * label said otherwise. docs/CUSTOM-STACK.md.
 */
export default function OwnStackRequest({ onBack }) {
  const [form, setForm] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [filed, setFiled] = useState(null)

  const set = (key) => (e) => {
    const value = e.target.value
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const setMode = (e) => {
    const mode = e.target.value
    setForm((prev) => ({
      ...prev,
      mode,
      engine: mode === 'bring' ? prev.engine : mode ? 'postgres' : '',
    }))
  }

  const setAuth = (e) => {
    const authMethod = e.target.value
    setForm((prev) => ({
      ...prev,
      authMethod,
      authClientId: authMethod === 'supabase' ? '' : prev.authClientId,
    }))
  }

  const setBucket = (e) => {
    const bucketMode = e.target.value
    setForm((prev) => ({
      ...prev,
      bucketMode,
      ...(bucketMode === 'provision' ? { bucketName: '', bucketRegion: '', presignUrl: '' } : {}),
    }))
  }

  const submit = async (e) => {
    e.preventDefault()
    const payload = {
      ...form,
      handoffContact: form.handoffContact.trim() || form.contactEmail.trim(),
    }
    const checked = validateProvisioningRequest(payload)
    if (!checked.ok) {
      setErrors(checked.errors)
      toast.error(checked.errors.form || 'Check the highlighted fields.')
      return
    }
    setErrors({})
    setBusy(true)
    try {
      setFiled(await fileProvisioningRequest(checked.value))
    } catch (err) {
      if (err.fields) setErrors(err.fields)
      toast.error(err.message || 'The request was not filed.')
    } finally {
      setBusy(false)
    }
  }

  if (filed) {
    return (
      <AuthLayout
        title="Request filed"
        subtitle="Status: requested. Provisioning has not started."
        footer={
          <Link
            to="/login"
            className="font-semibold text-brand-700 underline-offset-2 hover:underline"
          >
            Back to sign in
          </Link>
        }
      >
        <div className="space-y-3 text-sm leading-relaxed text-ink-700">
          <p>
            Request <span className="font-mono text-ink-900">{filed.id}</span> is stored for{' '}
            <span className="font-semibold text-ink-900">{filed.orgName}</span>. Keep that id. This
            screen does not send email yet.
          </p>
          <p>
            An operator reads the request in the platform console and contacts{' '}
            <span className="font-semibold text-ink-900">{filed.handoffContact}</span> for status
            and for the secret handoff.
          </p>
          <p>
            Recorded hosting: {hostingModeLabel(filed.mode)}. Engine: {filed.engine}. Sign-in:{' '}
            {authMethodLabel(filed.authMethod)}.
          </p>
          <p>
            Your company will get its own URL and will sign in with that identity provider. That URL
            is assigned when the environment exists. It is not this site, and there is no sign-in
            for this organization here while the request stays requested.
          </p>
          <p>
            {filed.engine === 'postgres' || filed.engine === 'supabase'
              ? 'Postgres can back a dedicated environment. The supabase client driver is still reserved, so a Supabase Postgres uses the postgres driver. '
              : 'That engine has no adapter yet, so a build cannot select it. '}
            This request does not open a session. Sign-in starts after the secret handoff, on the
            address fulfillment assigns.
          </p>
          <p>
            Your company holds DATA_KEY_MASTER. Database passwords and service-role keys stay with
            your company. Hand them over on the channel the operator opens.
          </p>
        </div>
      </AuthLayout>
    )
  }

  const mode = HOSTING_MODES.find((m) => m.id === form.mode)
  const auth = AUTH_METHODS.find((m) => m.id === form.authMethod)
  const showEngine = form.mode === 'bring'
  const showIssuer = form.authMethod === 'oidc' || form.authMethod === 'saml'
  const showProjectUrl = form.authMethod === 'supabase'
  const showBucket = form.bucketMode === 'bring'

  return (
    <AuthLayout
      title="Use your own database"
      subtitle="This files a request. It does not create a WEEHS organization."
      footer={
        <>
          Already have an account?{' '}
          <Link
            to="/login"
            className="font-semibold text-brand-700 underline-offset-2 hover:underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Button type="button" variant="ghost" className="!px-0" onClick={onBack}>
          Back to database choice
        </Button>
        {errors.form && (
          <p role="alert" className="text-sm font-medium text-red-400">
            {errors.form}
          </p>
        )}
        <Field label="Organization name" htmlFor="own-org" error={errors.orgName}>
          <Input
            id="own-org"
            value={form.orgName}
            onChange={set('orgName')}
            placeholder="Northwind Metals"
            autoComplete="organization"
          />
        </Field>
        <Field label="Address" htmlFor="own-address" hint="Optional" error={errors.address}>
          <Input
            id="own-address"
            value={form.address}
            onChange={set('address')}
            placeholder="City, Country"
          />
        </Field>
        <Field label="Your name" htmlFor="own-name" error={errors.contactName}>
          <Input
            id="own-name"
            value={form.contactName}
            onChange={set('contactName')}
            autoComplete="name"
          />
        </Field>
        <Field label="Work email" htmlFor="own-email" error={errors.contactEmail}>
          <Input
            id="own-email"
            type="email"
            value={form.contactEmail}
            onChange={set('contactEmail')}
            autoComplete="email"
          />
        </Field>

        <div className="h-px bg-ink-100" />
        <Field
          label="Hosting"
          htmlFor="own-mode"
          hint={
            mode?.detail || 'All three modes can be requested. None of them is live from this form.'
          }
          error={errors.mode}
        >
          <Select id="own-mode" value={form.mode} onChange={setMode}>
            <option value="">Choose hosting…</option>
            {HOSTING_MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
        {showEngine && (
          <Field
            label="Database engine"
            htmlFor="own-engine"
            hint="Any database. postgres is the generic path. supabase is one flavor, not the only engine. A connection string will be rejected."
            error={errors.engine}
          >
            <Input
              id="own-engine"
              value={form.engine}
              onChange={set('engine')}
              placeholder="postgres"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
        )}
        {form.mode && !showEngine && (
          <p className="text-sm text-ink-600">
            Engine: Postgres. WEEHS provisions Postgres for this hosting mode. Naming another engine
            here would not match that mode.
          </p>
        )}

        <Field
          label="Sign-in"
          htmlFor="own-auth"
          hint={auth?.detail || 'Company OIDC, company SAML, or Supabase Auth.'}
          error={errors.authMethod}
        >
          <Select id="own-auth" value={form.authMethod} onChange={setAuth}>
            <option value="">Choose sign-in…</option>
            {AUTH_METHODS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
        {showIssuer && (
          <>
            <Field
              label="Issuer URL"
              htmlFor="own-issuer"
              hint="Public https address. No client secret in the URL."
              error={errors.authIssuer}
            >
              <Input
                id="own-issuer"
                type="url"
                value={form.authIssuer}
                onChange={set('authIssuer')}
                placeholder="https://login.example.com/realms/staff"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <Field
              label="Client id"
              htmlFor="own-client"
              hint="The public client id. Leave the client secret for the out-of-band handoff."
              error={errors.authClientId}
            >
              <Input
                id="own-client"
                value={form.authClientId}
                onChange={set('authClientId')}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
          </>
        )}
        {showProjectUrl && (
          <Field
            label="Project URL"
            htmlFor="own-project"
            hint="Optional. A public https address. Not the service-role key."
            error={errors.authIssuer}
          >
            <Input
              id="own-project"
              type="url"
              value={form.authIssuer}
              onChange={set('authIssuer')}
              placeholder="https://example.supabase.co"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
        )}

        <Field label="File store" htmlFor="own-bucket" error={errors.bucketMode}>
          <Select id="own-bucket" value={form.bucketMode} onChange={setBucket}>
            <option value="">Choose a file store…</option>
            {BUCKET_MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
        {showBucket && (
          <>
            <Field label="Bucket name" htmlFor="own-bucket-name" error={errors.bucketName}>
              <Input
                id="own-bucket-name"
                value={form.bucketName}
                onChange={set('bucketName')}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <Field
              label="Bucket region"
              htmlFor="own-bucket-region"
              hint="For example ap-south-1."
              error={errors.bucketRegion}
            >
              <Input
                id="own-bucket-region"
                value={form.bucketRegion}
                onChange={set('bucketRegion')}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <Field
              label="Presign endpoint URL"
              htmlFor="own-presign"
              hint="Optional. The endpoint URL only. No access key in the URL."
              error={errors.presignUrl}
            >
              <Input
                id="own-presign"
                type="url"
                value={form.presignUrl}
                onChange={set('presignUrl')}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
          </>
        )}

        <Field
          label="Secret-handoff contact"
          htmlFor="own-handoff"
          hint="Who the operator should reach. Leave blank to use your work email. Do not paste a key into this field."
          error={errors.handoffContact}
        >
          <Input
            id="own-handoff"
            type="email"
            value={form.handoffContact}
            onChange={set('handoffContact')}
            autoComplete="email"
          />
        </Field>

        <Button type="submit" loading={busy} className="w-full">
          File provisioning request
        </Button>
      </form>
    </AuthLayout>
  )
}

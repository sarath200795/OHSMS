// ─────────────────────────────────────────────────────────────────────────────
// Platform console — every organization, its activity, and its admins.
//
// The rows come from listPlatformOrganizations, a callable that checks
// platformAdmins/{uid} and returns this projection only. The page does not
// query /organizations or /users: the operator is a member of neither, and
// those rules are what keep one tenant from reading another's staff.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react'
import { Building2, Search, ShieldCheck } from 'lucide-react'
import { listPlatformOrganizations } from '../../shared/functions'
import { isPermissionDenied } from '../../shared/lib/permissionDenied'
import { formatDate, formatDateTime, fromNow } from '../../shared/lib/format'
import {
  PageHeader,
  Card,
  Button,
  Input,
  Select,
  Field,
  Badge,
  SkeletonTable,
  EmptyState,
  TableWrap,
} from '../../shared/ui'
import {
  STATUS_FILTERS,
  STATUS_LABEL,
  STATUS_TONE,
  activityFacts,
  activityLine,
  filterOrganizations,
  mailHref,
  organizationTitle,
} from './directoryQuery'

function ActivityDetails({ row, windowDays }) {
  return (
    <div className="space-y-1.5">
      <Badge tone={STATUS_TONE[row.status] || 'gray'}>
        {STATUS_LABEL[row.status] || 'Inactive'}
      </Badge>
      <p className="text-[12.5px] text-ink-600">Created {formatDate(row.createdAt)}</p>
      <p className="text-[12.5px] text-ink-600">
        Last activity{' '}
        {row.lastActivityAt
          ? `${formatDateTime(row.lastActivityAt)} (${fromNow(row.lastActivityAt)})`
          : '—'}
      </p>
      <p className="text-[12.5px] leading-snug text-ink-700">
        {activityLine(row.counts, windowDays)}
      </p>
    </div>
  )
}

function adminKey(admin, index) {
  return `${admin.uid || admin.email || 'admin'}-${index}`
}

function StatusMark({ status }) {
  if (status !== 'suspended' && status !== 'pending') return null
  return (
    <Badge tone={status === 'suspended' ? 'red' : 'amber'} className="ml-1.5 align-middle">
      {status}
    </Badge>
  )
}

function AdminNames({ admins }) {
  if (!admins?.length) return <span className="text-[12.5px] text-ink-400">No admin on file</span>
  return (
    <ul className="space-y-2">
      {admins.map((admin, index) => (
        <li
          key={adminKey(admin, index)}
          className="min-h-10 truncate"
          title={admin.name || undefined}
        >
          <span className="font-medium text-ink-900">{admin.name || '—'}</span>
          <StatusMark status={admin.status} />
        </li>
      ))}
    </ul>
  )
}

function AdminEmails({ admins }) {
  if (!admins?.length) return <span className="text-[12.5px] text-ink-400">—</span>
  return (
    <ul className="space-y-2">
      {admins.map((admin, index) => {
        const href = mailHref(admin.email)
        return (
          <li
            key={adminKey(admin, index)}
            className="min-h-10 truncate"
            title={admin.email || undefined}
          >
            {href ? (
              <a href={href} className="text-brand-700 underline-offset-2 hover:underline">
                {admin.email}
              </a>
            ) : (
              <span className="text-ink-400">{admin.email || '—'}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function AdminList({ admins }) {
  if (!admins?.length) return <p className="text-[12.5px] text-ink-400">No admin on file</p>
  return (
    <ul className="space-y-2">
      {admins.map((admin, index) => {
        const href = mailHref(admin.email)
        return (
          <li key={adminKey(admin, index)} className="min-w-0">
            <span className="text-[13px] font-medium text-ink-900">
              {admin.name || '—'}
              <StatusMark status={admin.status} />
            </span>
            {href ? (
              <a
                href={href}
                className="block break-all text-[12.5px] text-brand-700 underline-offset-2 hover:underline"
              >
                {admin.email}
              </a>
            ) : (
              <span className="block text-[12.5px] text-ink-400">{admin.email || '—'}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function OrgCard({ row, windowDays }) {
  return (
    <article className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold text-ink-900">
            {organizationTitle(row)}
          </h2>
          <p className="truncate font-mono text-[11px] text-ink-400">{row.id}</p>
        </div>
        <Badge tone={STATUS_TONE[row.status] || 'gray'}>
          {STATUS_LABEL[row.status] || 'Inactive'}
        </Badge>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[12.5px]">
        <div>
          <dt className="text-ink-400">Created</dt>
          <dd className="font-medium text-ink-800">{formatDate(row.createdAt)}</dd>
        </div>
        <div>
          <dt className="text-ink-400">Last activity</dt>
          <dd className="font-medium text-ink-800">
            {row.lastActivityAt ? formatDateTime(row.lastActivityAt) : '—'}
          </dd>
        </div>
        {activityFacts(row.counts, windowDays).map((fact) => (
          <div key={fact.label}>
            <dt className="text-ink-400">{fact.label}</dt>
            <dd className="font-medium text-ink-800">{fact.value}</dd>
          </div>
        ))}
      </dl>
      <h3 className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
        Admins
      </h3>
      <div className="mt-1.5">
        <AdminList admins={row.admins} />
      </div>
    </article>
  )
}

export default function Organizations() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [nameQuery, setNameQuery] = useState('')
  const [emailQuery, setEmailQuery] = useState('')
  const [status, setStatus] = useState('all')

  useEffect(() => {
    let live = true
    setError('')
    setData(null)
    listPlatformOrganizations()
      .then((res) => {
        if (live) setData(res && Array.isArray(res.rows) ? res : { rows: [] })
      })
      .catch((err) => {
        if (!live) return
        setError(
          isPermissionDenied(err)
            ? 'The directory could not be read. The operator grant may have been removed.'
            : err?.message || 'Could not load organizations.'
        )
      })
    return () => {
      live = false
    }
  }, [attempt])

  const windowDays = data?.recentWindowDays || 30
  const allRows = data?.rows
  const rows = useMemo(
    () => filterOrganizations(allRows || [], { name: nameQuery, email: emailQuery, status }),
    [allRows, nameQuery, emailQuery, status]
  )
  const total = allRows?.length || 0
  const filtering = Boolean(nameQuery.trim() || emailQuery.trim() || status !== 'all')
  const loading = data === null && !error

  return (
    <>
      <PageHeader
        title="Organizations"
        subtitle="Every organization, its activity, and the admins who run it"
        icon={Building2}
        actions={
          <Badge tone="brand">
            <ShieldCheck size={13} className="mr-1 inline" />
            Platform operator
          </Badge>
        }
      />

      {error && (
        <Card className="mb-4 border-l-4 border-l-red-500">
          <p className="text-[13.5px] font-semibold text-red-700" role="alert">
            {error}
          </p>
          <Button
            type="button"
            variant="soft"
            className="mt-3"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Try again
          </Button>
        </Card>
      )}

      {data?.orgTruncated || data?.userTruncated || data?.partial ? (
        <Card className="mb-4 border-l-4 border-l-amber-500">
          <p className="text-[13.5px] text-ink-700" role="status">
            {data.orgTruncated
              ? 'The organization list stopped at its read cap, so some customers are not shown. '
              : ''}
            {data.userTruncated
              ? 'The member read stopped at its cap, so user counts and admin lists may be short. '
              : ''}
            {data.partial
              ? 'Some activity counts could not be read. Those are shown as unavailable rather than zero.'
              : ''}
          </p>
        </Card>
      ) : null}

      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_180px_auto] lg:items-end">
          <Field label="Organization name">
            <Input
              value={nameQuery}
              onChange={(e) => setNameQuery(e.target.value)}
              placeholder="Filter by name"
              autoComplete="off"
            />
          </Field>
          <Field label="Admin email">
            <Input
              value={emailQuery}
              onChange={(e) => setEmailQuery(e.target.value)}
              placeholder="Filter by admin email"
              autoComplete="off"
              inputMode="email"
            />
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUS_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          {filtering ? (
            <Button
              type="button"
              variant="ghost"
              className="lg:mb-0.5"
              onClick={() => {
                setNameQuery('')
                setEmailQuery('')
                setStatus('all')
              }}
            >
              Clear
            </Button>
          ) : (
            <span className="hidden lg:block" />
          )}
        </div>
        {!error && (
          <p className="mt-3 flex items-center gap-2 text-[12.5px] text-ink-500" aria-live="polite">
            <Search size={14} className="text-ink-400" aria-hidden="true" />
            {loading
              ? 'Loading organizations…'
              : filtering
                ? `${rows.length} of ${total} organization${total === 1 ? '' : 's'}`
                : `${total} organization${total === 1 ? '' : 's'}`}
          </p>
        )}
      </Card>

      {loading ? (
        <SkeletonTable rows={6} cols={4} />
      ) : error ? null : rows.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={filtering ? 'No organizations match' : 'No organizations'}
          description={
            filtering
              ? 'Nothing matches that name, admin email, or status.'
              : 'No organization has registered yet.'
          }
        />
      ) : (
        <>
          <TableWrap className="hidden md:block">
            <table className="w-full min-w-[760px] text-left text-sm">
              <caption className="sr-only">
                Organizations with activity, admin names, and admin emails
              </caption>
              <thead>
                <tr className="text-xs uppercase tracking-wide text-ink-400">
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Organization
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Activity
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Admin name
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Admin email
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="align-top">
                    <th scope="row" className="px-4 py-3 text-left font-semibold text-ink-900">
                      <span className="block">{organizationTitle(row)}</span>
                      <span className="mt-0.5 block font-mono text-[11px] font-normal text-ink-400">
                        {row.id}
                      </span>
                    </th>
                    <td className="px-4 py-3">
                      <ActivityDetails row={row} windowDays={windowDays} />
                    </td>
                    <td className="px-4 py-3">
                      <AdminNames admins={row.admins} />
                    </td>
                    <td className="px-4 py-3">
                      <AdminEmails admins={row.admins} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>

          <ul className="space-y-3 md:hidden" aria-label="Organizations">
            {rows.map((row) => (
              <li key={row.id}>
                <OrgCard row={row} windowDays={windowDays} />
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}

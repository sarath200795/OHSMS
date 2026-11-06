// Platform console — own-database provisioning requests.
//
// Read-only. A request with status `requested` is not a customer and not a
// live stack. This page cannot mark one provisioned: that write is refused
// in firestore.rules, including for a platform operator, because a browser
// that can set the status is how a request starts looking served.
// docs/CUSTOM-STACK.md.
import { useEffect, useState } from 'react'
import { Database } from 'lucide-react'
import { isPermissionDenied } from '../../shared/lib/permissionDenied'
import { formatDateTime } from '../../shared/lib/format'
import { listProvisioningRequests } from '../../shared/org/provisioningRequest'
import { authMethodLabel, hostingModeLabel } from '../../shared/org/provisioningSchema'
import { PageHeader, Badge, EmptyState, TableWrap, AccessDenied } from '../../shared/ui'

export default function ProvisioningRequests() {
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    listProvisioningRequests()
      .then((list) => {
        if (live) setResult(list)
      })
      .catch((err) => {
        if (!live) return
        setResult({ capped: false, rows: [] })
        if (isPermissionDenied(err)) setError('denied')
        else setError(err?.message || 'Could not load provisioning requests.')
      })
    return () => {
      live = false
    }
  }, [])

  return (
    <div className="space-y-5">
      <PageHeader
        title="Own-database requests"
        subtitle="Requests waiting on a dedicated environment. Filing one does not create a WEEHS organization."
        icon={Database}
      />
      <p className="max-w-3xl text-sm leading-relaxed text-ink-600">
        Each row stays requested until the control plane fulfills it. This page cannot mark a
        company live: that write is refused to every browser, including an operator. Database
        passwords, service-role keys, and DATA_KEY_MASTER are not stored on the request.
      </p>
      {error === 'denied' && (
        <AccessDenied
          title="Operators only"
          description="Provisioning requests are readable by a platform operator."
        />
      )}
      {error && error !== 'denied' && (
        <p role="alert" className="text-sm font-medium text-red-400">
          {error}
        </p>
      )}
      {!error && result === null && <p role="status">Loading requests…</p>}
      {!error && result && result.rows.length === 0 && (
        <EmptyState
          icon={Database}
          title="No own-database requests"
          description="When someone chooses their own database at registration, the request shows up here. It stays requested until that company's environment exists."
        />
      )}
      {!error && result && result.rows.length > 0 && (
        <TableWrap>
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Own-database provisioning requests</caption>
            <thead>
              <tr className="border-b border-ink-200 text-xs uppercase tracking-wide text-ink-500">
                <th scope="col" className="px-4 py-3 font-semibold">
                  Organization
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Contact
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Hosting
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Engine
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Sign-in
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Status
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Dedicated URL
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Filed
                </th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.id} className="border-b border-ink-100 last:border-0">
                  <th scope="row" className="px-4 py-3 font-semibold text-ink-900">
                    {row.orgName || '—'}
                    <span className="mt-0.5 block font-mono text-[11px] font-normal text-ink-400">
                      {row.id}
                    </span>
                  </th>
                  <td className="px-4 py-3 text-ink-700">{row.contactEmail || '—'}</td>
                  <td className="px-4 py-3 text-ink-700">{hostingModeLabel(row.mode)}</td>
                  <td className="px-4 py-3 font-mono text-ink-700">{row.engine || '—'}</td>
                  <td className="px-4 py-3 text-ink-700">{authMethodLabel(row.authMethod)}</td>
                  <td className="px-4 py-3">
                    <Badge
                      tone={
                        row.status === 'live'
                          ? 'green'
                          : row.status === 'requested'
                            ? 'amber'
                            : 'slate'
                      }
                    >
                      {row.status || '—'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-ink-700">
                    {row.dedicatedUrl ? (
                      <a href={row.dedicatedUrl} className="underline-offset-2 hover:underline">
                        {row.dedicatedUrl}
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink-500">{formatDateTime(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.capped && (
            <p className="px-4 py-3 text-xs text-ink-500">Showing the 100 most recent requests.</p>
          )}
        </TableWrap>
      )}
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { ScrollText, Search } from 'lucide-react'
import { useAuth } from '../../shared/auth/AuthContext'
import { subscribeAuditLogs } from '../../shared/org/orgData'
import { auditLabel } from '../../shared/audit/audit'
import { MODULE_BY_KEY } from '../../shared/modules/registry'
import { PageHeader, Badge, Input, SkeletonTable, EmptyState } from '../../shared/ui'
import { formatDateTime } from '../../shared/lib/format'

export default function AuditLog() {
  const { orgId } = useAuth()
  const [logs, setLogs] = useState(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!orgId) return
    return subscribeAuditLogs(orgId, setLogs, 400)
  }, [orgId])

  const filtered = useMemo(() => {
    if (!logs) return []
    const q = search.trim().toLowerCase()
    if (!q) return logs
    return logs.filter((l) => JSON.stringify(l).toLowerCase().includes(q))
  }, [logs, search])

  return (
    <>
      <PageHeader title="Audit log" subtitle="Append-only record of every action across all modules" icon={ScrollText} />

      <div className="relative mb-4 max-w-xs">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
        <Input className="!py-2 pl-9" placeholder="Search activity…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {logs === null ? (
        <SkeletonTable rows={8} cols={4} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={ScrollText} title="No activity" description="Actions across the platform will appear here." />
      ) : (
        <div className="card table-crisp overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-ink-400">
                <th className="px-5 py-3 font-semibold">When</th>
                <th className="px-5 py-3 font-semibold">Who</th>
                <th className="px-5 py-3 font-semibold">Module</th>
                <th className="px-5 py-3 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => (
                <tr key={l.id} className="hover:bg-clay-100">
                  <td className="whitespace-nowrap px-5 py-3 text-ink-500">{formatDateTime(l.at)}</td>
                  <td className="px-5 py-3 font-medium text-ink-800">{l.actorName}</td>
                  <td className="px-5 py-3">
                    <Badge tone="gray">{MODULE_BY_KEY[l.module]?.label || l.module || 'Core'}</Badge>
                  </td>
                  <td className="px-5 py-3 text-ink-700">
                    {auditLabel(l.action)}
                    {l.targetLabel ? <span className="text-ink-500"> · {l.targetLabel}</span> : ''}
                    {l.summary && !l.targetLabel ? <span className="text-ink-500"> · {l.summary}</span> : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

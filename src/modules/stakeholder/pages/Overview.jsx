import { Link } from 'react-router-dom'
import { Scale, MessageSquareWarning, Gavel, TriangleAlert, Users } from 'lucide-react'
import { PageHeader, EmptyState, SkeletonTable, Badge, Button } from '../../../shared/ui'
import { useStakeholder } from '../context/StakeholderContext'
import { NOTICE_BY_KEY, DEPARTMENT_BY_KEY } from '../lib/constants'

const Stat = ({ label, value, sub, tone = 'ink' }) => {
  const toneClass = { red: 'text-red-600', amber: 'text-amber-600', ink: 'text-ink-900' }[tone] || 'text-ink-900'
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-400">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${toneClass}`}>{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-ink-500">{sub}</div> : null}
    </div>
  )
}

/**
 * The overview exists for one number: how many customer complaints stopped
 * being customer complaints.
 *
 * Each tab on its own answers a narrower question — how many are open, what was
 * served. The crossover between them is the thing nobody sees until it is
 * counted, and it is the reason the two are one module rather than two.
 */
export default function Overview() {
  const { summary, escalations, legalIssues, repeats, loading, error } = useStakeholder()

  if (error) {
    return (
      <>
        <PageHeader title="Stakeholder Issues" />
        <EmptyState
          icon={TriangleAlert}
          title="Could not load"
          hint="This is empty because it failed to load, not because there is nothing recorded. Refresh and try again."
        />
      </>
    )
  }

  if (loading) return (<><PageHeader title="Stakeholder Issues" /><SkeletonTable rows={5} /></>)

  const empty = !escalations.length && !legalIssues.length
  if (empty) {
    return (
      <>
        <PageHeader title="Stakeholder Issues" />
        <EmptyState
          icon={Scale}
          title="Nothing recorded yet"
          hint="Log a customer escalation, or a department visit — including visits that produced no notice, which is the evidence an inspection happened and passed."
          action={<Link to="/stakeholder/escalations"><Button>Log an escalation</Button></Link>}
        />
      </>
    )
  }

  const severeOpen = legalIssues.filter((l) => l.status !== 'closed' && NOTICE_BY_KEY[l.noticeType]?.severe)
  const dueSoon = legalIssues
    .filter((l) => l.responseDueDate && l.status !== 'closed')
    .sort((a, b) => String(a.responseDueDate).localeCompare(String(b.responseDueDate)))
    .slice(0, 5)

  // Which authorities actually turn up, most often first.
  const byDept = new Map()
  for (const l of legalIssues) {
    for (const d of l.departments || []) byDept.set(d, (byDept.get(d) || 0) + 1)
  }
  const departments = [...byDept.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)

  return (
    <>
      <PageHeader title="Stakeholder Issues" subtitle="Customer escalations and the legal matters they turn into" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Escalations" value={summary.escalations.total} sub={`${summary.escalations.open} open`} />
        {/* The number this page exists for. */}
        <Stat
          label="Became legal"
          value={summary.escalations.escalatedToLegal}
          sub="complaints that reached an authority"
          tone={summary.escalations.escalatedToLegal ? 'amber' : 'ink'}
        />
        <Stat label="Legal issues" value={summary.legal.total} sub={`${summary.legal.open} open`} />
        <Stat
          label="Serious notices"
          value={summary.legal.severe}
          sub="FIR, summons, closure, fines…"
          tone={summary.legal.severe ? 'red' : 'ink'}
        />
      </div>

      {severeOpen.length > 0 && (
        <div className="card mt-4 p-4">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-ink-800">
            <Gavel size={15} className="text-red-600" /> Open serious matters
          </h2>
          <ul className="space-y-1.5 text-sm">
            {severeOpen.slice(0, 6).map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-2">
                <Badge tone={NOTICE_BY_KEY[l.noticeType]?.tone || 'slate'}>{NOTICE_BY_KEY[l.noticeType]?.label}</Badge>
                <span className="font-medium text-ink-800">{l.title}</span>
                <span className="text-xs text-ink-500">{l.scope?.siteName || '—'}</span>
                {l.escalation && (
                  <span className="text-xs text-ink-400">from {l.escalation.docId || l.escalation.title}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {dueSoon.length > 0 && (
        <div className="card mt-4 p-4">
          <h2 className="mb-2 text-sm font-bold text-ink-800">Responses due</h2>
          <ul className="space-y-1 text-sm">
            {dueSoon.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3">
                <span className="truncate text-ink-700">{l.title}</span>
                <span className="shrink-0 font-mono text-xs text-ink-500">{l.responseDueDate}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {departments.length > 0 && (
          <div className="card p-4">
            <h2 className="mb-2 text-sm font-bold text-ink-800">Who visits most</h2>
            <ul className="space-y-1 text-sm">
              {departments.map(([key, n]) => (
                <li key={key} className="flex items-center justify-between">
                  <span className="text-ink-700">{DEPARTMENT_BY_KEY[key]?.label || key}</span>
                  <span className="font-semibold text-ink-500">{n}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* A member on their fourth complaint is a different conversation from
            one on their first, and no single record can show that. */}
        {repeats.length > 0 && (
          <div className="card p-4">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-ink-800">
              <Users size={15} /> Repeat complainants
            </h2>
            <ul className="space-y-1 text-sm">
              {repeats.slice(0, 6).map((m) => (
                <li key={m.memberId || m.name} className="flex items-center justify-between gap-2">
                  <span className="truncate text-ink-700">
                    {m.name || '—'}{m.memberId ? <span className="ml-1.5 font-mono text-xs text-ink-400">{m.memberId}</span> : null}
                  </span>
                  <span className="shrink-0 font-semibold text-ink-500">{m.count} complaints</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link to="/stakeholder/escalations">
          <Button variant="ghost" icon={MessageSquareWarning}>All escalations</Button>
        </Link>
        <Link to="/stakeholder/legal">
          <Button variant="ghost" icon={Gavel}>All legal issues</Button>
        </Link>
      </div>
    </>
  )
}

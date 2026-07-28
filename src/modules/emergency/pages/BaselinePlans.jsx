import { useEffect, useMemo, useState } from 'react'
import { Library, Info } from 'lucide-react'
import { PageHeader, Card, SkeletonCard } from '../../../shared/ui'
import { useAuth } from '../../../shared/auth/AuthContext'
import { subscribeOrgUsers } from '../../../shared/org/orgData'
import RescuePlans from '../components/RescuePlans'
import { subscribeRescuePlans, RESCUE_SCENARIOS } from '../lib/firestore'

/**
 * The org-wide baseline emergency response library. Sites recall these plans
 * and adapt them locally — the same pattern as baseline risk assessments.
 */
export default function BaselinePlans() {
  const { orgId } = useAuth()
  const [plans, setPlans] = useState(null)
  const [users, setUsers] = useState([])

  useEffect(() => {
    if (!orgId) return undefined
    const u1 = subscribeRescuePlans(orgId, setPlans)
    const u2 = subscribeOrgUsers(orgId, setUsers)
    return () => { u1(); u2() }
  }, [orgId])

  const approvedUsers = useMemo(() => users.filter((u) => u.status === 'approved'), [users])
  const baselines = useMemo(() => (plans || []).filter((p) => p.kind === 'baseline'), [plans])
  const coverage = useMemo(() => {
    const covered = new Set(baselines.map((b) => b.scenario))
    return RESCUE_SCENARIOS.filter((s) => s !== 'Other').filter((s) => !covered.has(s))
  }, [baselines])

  if (plans === null) {
    return (
      <>
        <PageHeader title="Baseline Emergency Response" subtitle="Standard rescue plans every site can recall" icon={Library} />
        <SkeletonCard className="max-w-3xl" />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Baseline Emergency Response"
        subtitle="Your organization's standard rescue plans — each site recalls these and adapts them locally"
        icon={Library}
      />

      <Card className="mb-4 !py-3">
        <p className="flex items-start gap-2 text-sm text-ink-600">
          <Info size={16} className="mt-0.5 shrink-0 text-brand-600" />
          <span>
            Write each scenario once here. On a site&apos;s <b>Rescue Plans</b> tab, use <b>Recall baseline</b> to copy
            them in — the site copy stays editable and is flagged <b>Adapted from baseline</b> once changed.
            {coverage.length > 0 && (
              <> Scenarios with no baseline yet: <b>{coverage.join(', ')}</b>.</>
            )}
          </span>
        </p>
      </Card>

      <RescuePlans baseline plans={plans} users={approvedUsers} />
    </>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Building2, CheckCircle2, Map, LifeBuoy } from 'lucide-react'
import { useAuth } from '../../../shared/auth/AuthContext'
import { toCsv } from '../../../shared/lib/csv'
import { downloadText } from '../../../shared/lib/download'
import { useAccessibleSites } from '../../../shared/org/useAccessibleSites'
import ModuleReportsPage from '../../../shared/reports/ModuleReportsPage'
import { Stat } from '../../../pages/analytics/ui'
import { subscribeContacts, subscribeLayouts, subscribeRescuePlans } from '../lib/firestore'

const COLUMNS = [
  { key: 'site', label: 'Site' },
  { key: 'region', label: 'Region' },
  { key: 'entity', label: 'Entity' },
  { key: 'internal', label: 'Internal contacts' },
  { key: 'external', label: 'External contacts' },
  { key: 'layout', label: 'Layout' },
  { key: 'plans', label: 'Approved plans' },
  { key: 'ready', label: 'Ready' },
]

export default function Reports() {
  const { orgId } = useAuth()
  const sites = useAccessibleSites()
  const [contacts, setContacts] = useState([])
  const [layouts, setLayouts] = useState({})
  const [plans, setPlans] = useState([])

  useEffect(() => {
    if (!orgId) return undefined
    const u1 = subscribeContacts(orgId, setContacts)
    const u2 = subscribeLayouts(orgId, setLayouts)
    const u3 = subscribeRescuePlans(orgId, setPlans)
    return () => {
      u1()
      u2()
      u3()
    }
  }, [orgId])

  const rows = useMemo(
    () =>
      sites.map((s) => {
        const mine = (contacts || []).filter((c) => !c.siteId || c.siteId === s.id)
        const internal = mine.filter((c) => c.kind === 'internal').length
        const external = mine.filter((c) => c.kind === 'external').length
        const sitePlans = (plans || []).filter(
          (p) => p.siteId === s.id && p.status === 'approved'
        ).length
        const hasLayout = !!layouts[s.id]
        return {
          site: s.name,
          region: s.region || '',
          entity: s.entity || '',
          internal,
          external,
          layout: hasLayout ? 'Yes' : 'No',
          plans: sitePlans,
          ready: internal > 0 && external > 0 && hasLayout && sitePlans > 0 ? 'Yes' : 'No',
        }
      }),
    [sites, contacts, layouts, plans]
  )

  const stats = useMemo(
    () => ({
      sites: rows.length,
      ready: rows.filter((r) => r.ready === 'Yes').length,
      withLayout: rows.filter((r) => r.layout === 'Yes').length,
      withPlans: rows.filter((r) => r.plans > 0).length,
    }),
    [rows]
  )

  return (
    <ModuleReportsPage
      moduleKey="emergency"
      subtitle="Per-site FERP readiness: contacts, layout and approved rescue plans on the shared organisation database."
      onExport={() => downloadText(toCsv(rows, COLUMNS), 'emergency-response-report.csv')}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Building2} label="Sites" value={stats.sites} tone="#0ea5e9" />
        <Stat icon={CheckCircle2} label="Ready" value={stats.ready} tone="#16a34a" />
        <Stat icon={Map} label="With layout" value={stats.withLayout} tone="#7c3aed" />
        <Stat icon={LifeBuoy} label="With approved plans" value={stats.withPlans} tone="#d97706" />
      </div>
      <p className="mt-4 text-[12.5px] text-ink-500">
        Ready means at least one internal contact, one external contact, a site layout and an
        approved rescue plan.
      </p>
    </ModuleReportsPage>
  )
}

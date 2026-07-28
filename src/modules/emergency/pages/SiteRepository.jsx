import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Building2, Search, PhoneCall, Phone, Map, LifeBuoy, ArrowRight, CheckCircle2, AlertTriangle } from 'lucide-react'
import { PageHeader, Card, StatCard, EmptyState, SkeletonCard, Badge } from '../../../shared/ui'
import { useAuth } from '../../../shared/auth/AuthContext'
import { subscribeSites } from '../../../shared/org/orgData'
import { resolveAccessibleSites } from '../../../shared/auth/access'
import { subscribeContacts, subscribeLayouts, subscribeRescuePlans } from '../lib/firestore'

/** One readiness pill (contacts / plan / rescue plans). */
function Pill({ ok, icon: Icon, label }) {
  return (
    <span className={`chip ${ok ? 'bg-green-50 text-green-700' : 'bg-clay-100 text-ink-400'}`}>
      <Icon size={12} /> {label}
    </span>
  )
}

export default function SiteRepository() {
  const { orgId, profile, isAdmin } = useAuth()
  const [contacts, setContacts] = useState(null)
  const [layouts, setLayouts] = useState({})
  const [plans, setPlans] = useState([])
  const [allSites, setAllSites] = useState([])
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!orgId) return undefined
    const u1 = subscribeContacts(orgId, setContacts)
    const u2 = subscribeLayouts(orgId, setLayouts)
    const u3 = subscribeRescuePlans(orgId, setPlans)
    const u4 = subscribeSites(orgId, setAllSites)
    return () => { u1(); u2(); u3(); u4() }
  }, [orgId])

  const siteInventory = useMemo(() => resolveAccessibleSites(profile, allSites, { isAdmin }), [profile, allSites, isAdmin])

  const rows = useMemo(() => {
    const list = contacts || []
    return siteInventory.map((s) => {
      const mine = list.filter((c) => !c.siteId || c.siteId === s.id)
      const internal = mine.filter((c) => c.kind === 'internal').length
      const external = mine.filter((c) => c.kind === 'external').length
      const sitePlans = plans.filter((p) => p.siteId === s.id)
      const hasLayout = !!layouts[s.id]
      const ready = internal > 0 && external > 0 && hasLayout && sitePlans.length > 0
      return { site: s, internal, external, hasLayout, plans: sitePlans.length, ready }
    })
  }, [siteInventory, contacts, layouts, plans])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = needle
      ? rows.filter((r) => `${r.site.name} ${r.site.region || ''} ${r.site.entity || ''}`.toLowerCase().includes(needle))
      : rows
    return [...list].sort((a, b) => Number(a.ready) - Number(b.ready) || a.site.name.localeCompare(b.site.name))
  }, [rows, q])

  const totals = useMemo(
    () => ({
      sites: rows.length,
      ready: rows.filter((r) => r.ready).length,
      gaps: rows.filter((r) => !r.ready).length,
      plans: plans.length,
    }),
    [rows, plans]
  )

  if (contacts === null) {
    return (
      <>
        <PageHeader title="Site Emergency Repository" subtitle="Every site's contacts, FERP plan and rescue plans" icon={Building2} />
        <SkeletonCard className="max-w-3xl" />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Site Emergency Repository"
        subtitle="Each site's emergency contacts, FERP plan and scenario rescue plans — in one place"
        icon={Building2}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Sites" value={totals.sites} icon={Building2} tone="brand" />
        <StatCard label="Emergency ready" value={totals.ready} icon={CheckCircle2} tone="green" />
        <StatCard label="With gaps" value={totals.gaps} icon={AlertTriangle} tone="red" />
        <StatCard label="Rescue plans" value={totals.plans} icon={LifeBuoy} tone="amber" />
      </div>

      <Card className="mb-4">
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input className="input pl-9" placeholder="Search site, region or entity…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </Card>

      {shown.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={rows.length ? 'No matching sites' : 'No sites yet'}
          description={rows.length ? 'Try a different search.' : 'Add sites first — each one gets its own emergency repository.'}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((r) => (
            <Link
              key={r.site.id}
              to={`/emergency-response/sites/${r.site.id}`}
              className="card group flex flex-col gap-3 !p-5 transition-transform duration-200 ease-emil hover:-translate-y-0.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-bold text-ink-900">{r.site.name}</p>
                  <p className="truncate text-xs text-ink-400">
                    {[r.site.entity, r.site.region].filter(Boolean).join(' · ') || 'No region / entity set'}
                  </p>
                </div>
                <Badge tone={r.ready ? 'green' : 'amber'}>{r.ready ? 'Ready' : 'Gaps'}</Badge>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <Pill ok={r.external > 0} icon={PhoneCall} label={`${r.external} external`} />
                <Pill ok={r.internal > 0} icon={Phone} label={`${r.internal} internal`} />
                <Pill ok={r.hasLayout} icon={Map} label={r.hasLayout ? 'FERP plan' : 'No FERP plan'} />
                <Pill ok={r.plans > 0} icon={LifeBuoy} label={`${r.plans} rescue plan${r.plans === 1 ? '' : 's'}`} />
              </div>

              <span className="mt-auto inline-flex items-center gap-1 text-xs font-semibold text-brand-600">
                Open site repository <ArrowRight size={12} className="transition group-hover:translate-x-0.5" />
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  )
}

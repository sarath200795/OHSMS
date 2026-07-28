import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, Search, PhoneCall, Phone, Map, LifeBuoy, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react'
import { PageHeader, Card, Select, StatCard, EmptyState, SkeletonTable, Badge, Pager } from '../../../shared/ui'
import { useAuth } from '../../../shared/auth/AuthContext'
import { subscribeSites } from '../../../shared/org/orgData'
import { resolveAccessibleSites } from '../../../shared/auth/access'
import { subscribeContacts, subscribeLayouts, subscribeRescuePlans } from '../lib/firestore'

const PAGE_SIZE = 25

/** Compact ok/missing cell. */
function Cell({ ok, children }) {
  return <span className={ok ? 'font-semibold text-ink-800' : 'text-ink-300'}>{children}</span>
}

export default function SiteRepository() {
  const { orgId, profile, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [contacts, setContacts] = useState(null)
  const [layouts, setLayouts] = useState({})
  const [plans, setPlans] = useState([])
  const [allSites, setAllSites] = useState([])
  const [f, setF] = useState({ q: '', region: 'all', entity: 'all', site: 'all', status: 'all' })
  const [page, setPage] = useState(1)

  useEffect(() => {
    if (!orgId) return undefined
    const u1 = subscribeContacts(orgId, setContacts)
    const u2 = subscribeLayouts(orgId, setLayouts)
    const u3 = subscribeRescuePlans(orgId, setPlans)
    const u4 = subscribeSites(orgId, setAllSites)
    return () => { u1(); u2(); u3(); u4() }
  }, [orgId])

  useEffect(() => { setPage(1) }, [f])

  const siteInventory = useMemo(() => resolveAccessibleSites(profile, allSites, { isAdmin }), [profile, allSites, isAdmin])

  const rows = useMemo(() => {
    const list = contacts || []
    return siteInventory.map((s) => {
      const mine = list.filter((c) => !c.siteId || c.siteId === s.id)
      const internal = mine.filter((c) => c.kind === 'internal').length
      const external = mine.filter((c) => c.kind === 'external').length
      const sitePlans = plans.filter((p) => p.siteId === s.id && p.status === 'approved').length
      const hasLayout = !!layouts[s.id]
      return {
        site: s, internal, external, hasLayout, plans: sitePlans,
        ready: internal > 0 && external > 0 && hasLayout && sitePlans > 0,
      }
    })
  }, [siteInventory, contacts, layouts, plans])

  // Correlated filter options: entity narrows to the chosen region, site to both.
  const regions = useMemo(() => [...new Set(siteInventory.map((s) => s.region).filter(Boolean))].sort(), [siteInventory])
  const entities = useMemo(
    () => [...new Set(siteInventory.filter((s) => f.region === 'all' || s.region === f.region).map((s) => s.entity).filter(Boolean))].sort(),
    [siteInventory, f.region]
  )
  const siteOptions = useMemo(
    () => siteInventory
      .filter((s) => (f.region === 'all' || s.region === f.region) && (f.entity === 'all' || s.entity === f.entity))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [siteInventory, f.region, f.entity]
  )

  const shown = useMemo(() => {
    const q = f.q.trim().toLowerCase()
    return rows
      .filter((r) => (f.region === 'all' ? true : r.site.region === f.region))
      .filter((r) => (f.entity === 'all' ? true : r.site.entity === f.entity))
      .filter((r) => (f.site === 'all' ? true : r.site.id === f.site))
      .filter((r) => (f.status === 'all' ? true : f.status === 'ready' ? r.ready : !r.ready))
      .filter((r) => (q ? `${r.site.name} ${r.site.region || ''} ${r.site.entity || ''}`.toLowerCase().includes(q) : true))
      .sort((a, b) => Number(a.ready) - Number(b.ready) || a.site.name.localeCompare(b.site.name))
  }, [rows, f])

  const totals = useMemo(
    () => ({
      sites: shown.length,
      ready: shown.filter((r) => r.ready).length,
      gaps: shown.filter((r) => !r.ready).length,
      plans: shown.reduce((n, r) => n + r.plans, 0),
    }),
    [shown]
  )

  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pageItems = shown.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

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

      {/* Filters */}
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[200px] flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input className="input pl-9" placeholder="Search site…" value={f.q} onChange={(e) => setF((p) => ({ ...p, q: e.target.value }))} />
          </div>
          <Select className="!w-auto" value={f.region}
            onChange={(e) => setF((p) => ({ ...p, region: e.target.value, entity: 'all', site: 'all' }))}>
            <option value="all">All regions</option>
            {regions.map((r) => <option key={r} value={r}>{r}</option>)}
          </Select>
          <Select className="!w-auto" value={f.entity}
            onChange={(e) => setF((p) => ({ ...p, entity: e.target.value, site: 'all' }))}>
            <option value="all">All entities</option>
            {entities.map((v) => <option key={v} value={v}>{v}</option>)}
          </Select>
          <Select className="!w-auto" value={f.site} onChange={(e) => setF((p) => ({ ...p, site: e.target.value }))}>
            <option value="all">All sites</option>
            {siteOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Select className="!w-auto" value={f.status} onChange={(e) => setF((p) => ({ ...p, status: e.target.value }))}>
            <option value="all">Any readiness</option>
            <option value="ready">Emergency ready</option>
            <option value="gaps">With gaps</option>
          </Select>
        </div>
      </Card>

      {contacts === null ? (
        <SkeletonTable rows={6} cols={7} />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={rows.length ? 'No matching sites' : 'No sites yet'}
          description={rows.length ? 'Try different filters.' : 'Add sites first — each one gets its own emergency repository.'}
        />
      ) : (
        <Card className="overflow-hidden !p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3">Site</th>
                  <th className="px-4 py-3">Region</th>
                  <th className="px-4 py-3">Entity</th>
                  <th className="px-4 py-3 text-center">External</th>
                  <th className="px-4 py-3 text-center">Internal</th>
                  <th className="px-4 py-3 text-center">FERP plan</th>
                  <th className="px-4 py-3 text-center">Rescue plans</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-clay-200/60">
                {pageItems.map((r) => (
                  <tr
                    key={r.site.id}
                    className="cursor-pointer hover:bg-clay-100/50"
                    onClick={() => navigate(`/emergency-response/sites/${r.site.id}`)}
                    title="Open site repository"
                  >
                    <td className="px-5 py-3 font-semibold text-ink-900">{r.site.name}</td>
                    <td className="px-4 py-3 text-ink-600">{r.site.region || '—'}</td>
                    <td className="px-4 py-3 text-ink-600">{r.site.entity || '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <Cell ok={r.external > 0}><PhoneCall size={12} className="mr-1 inline" />{r.external}</Cell>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Cell ok={r.internal > 0}><Phone size={12} className="mr-1 inline" />{r.internal}</Cell>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {r.hasLayout
                        ? <Map size={15} className="mx-auto text-green-600" />
                        : <span className="text-ink-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Cell ok={r.plans > 0}><LifeBuoy size={12} className="mr-1 inline" />{r.plans}</Cell>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={r.ready ? 'green' : 'amber'}>{r.ready ? 'Ready' : 'Gaps'}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ArrowRight size={15} className="inline text-ink-300" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager className="border-t border-clay-200/60 px-4 py-3" page={safePage} pageCount={pageCount} onPage={setPage} total={shown.length} pageSize={PAGE_SIZE} />
        </Card>
      )}
    </>
  )
}

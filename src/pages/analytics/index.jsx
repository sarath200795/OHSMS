// ─────────────────────────────────────────────────────────────────────────────
// Analytics.
//
// One tab per module, because the questions are module-shaped: "how many near
// misses" and "how many mock drills per entity" have nothing to do with each
// other beyond both being counts. The tabs that are not built yet say so rather
// than being hidden — an empty promise is easier to plan around than a gap
// nobody can see.
//
// Everything is scoped to the sites the viewer may see. Analytics is where a
// scoping mistake is least visible and most consequential, so the same
// useAccessibleSites the modules use is the only source of that list.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react'
import { BarChart3, AlertTriangle, Siren, FireExtinguisher, Users } from 'lucide-react'
import { useAuth } from '../../shared/auth/AuthContext'
import { subscribeCollection } from '../../shared/org/orgData'
import { useAccessibleSites } from '../../shared/org/useAccessibleSites'
import { PageHeader } from '../../shared/ui'
import IncidentsTab from './IncidentsTab'

const TABS = [
  { key: 'incidents', label: 'Incidents', icon: AlertTriangle },
  { key: 'drills', label: 'Mock Drills', icon: Siren, soon: 'Drills per site, entity and region; observations by status; and the mix of drill types.' },
  { key: 'equipment', label: 'Emergency Equipment', icon: FireExtinguisher, soon: 'A defect map with site and defect-type filters, fleet health, and defects by entity, region and site.' },
  { key: 'committee', label: 'HSE Committee', icon: Users, soon: 'Meetings per month, and observations by status per month.' },
]

export default function Analytics() {
  const { orgId } = useAuth()
  const sites = useAccessibleSites()
  const [tab, setTab] = useState('incidents')
  const [incidents, setIncidents] = useState([])

  useEffect(() => {
    if (!orgId) return undefined
    return subscribeCollection(orgId, 'incidents', setIncidents)
  }, [orgId])

  const active = useMemo(() => TABS.find((t) => t.key === tab) || TABS[0], [tab])

  return (
    <div>
      <PageHeader
        title="Analytics"
        subtitle={`Across the ${sites.length} site${sites.length === 1 ? '' : 's'} you can see.`}
        icon={BarChart3}
      />

      <div
        role="tablist"
        aria-label="Analytics modules"
        className="mb-5 flex gap-1.5 overflow-x-auto rounded-2xl bg-clay-surface p-2 shadow-clay-inset"
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`inline-flex flex-none items-center gap-2 rounded-2xl px-4 py-2.5 text-[13px] font-semibold transition ${
              tab === t.key ? 'bg-clay-surface text-ink-900 shadow-clay-sm' : 'text-ink-500 hover:text-ink-800'
            }`}
          >
            <t.icon size={15} strokeWidth={2.2} />
            {t.label}
          </button>
        ))}
      </div>

      {sites.length === 0 ? (
        <div className="card px-6 py-14 text-center">
          <p className="text-[15px] font-bold text-ink-900">No sites are visible to you</p>
          <p className="mx-auto mt-1.5 max-w-[46ch] text-[13px] leading-relaxed text-ink-500">
            Analytics is scoped to the sites your account can see. Ask an admin to map you to a site
            or grant you access to a region or entity.
          </p>
        </div>
      ) : tab === 'incidents' ? (
        <IncidentsTab incidents={incidents} sites={sites} />
      ) : (
        <div className="card px-6 py-14 text-center">
          <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-clay-100 text-ink-400">
            <active.icon size={22} />
          </span>
          <p className="text-[15px] font-bold text-ink-900">{active.label} analytics is not built yet</p>
          <p className="mx-auto mt-1.5 max-w-[52ch] text-[13px] leading-relaxed text-ink-500">{active.soon}</p>
        </div>
      )}
    </div>
  )
}

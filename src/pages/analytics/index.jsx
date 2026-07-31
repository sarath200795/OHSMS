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
import { useEffect, useState } from 'react'
import { BarChart3, AlertTriangle, Siren, FireExtinguisher, Users } from 'lucide-react'
import { useAuth } from '../../shared/auth/AuthContext'
import { subscribeCollection } from '../../shared/org/orgData'
import { useAccessibleSites } from '../../shared/org/useAccessibleSites'
import { PageHeader } from '../../shared/ui'
import IncidentsTab from './IncidentsTab'
import DrillsTab from './DrillsTab'
import EquipmentTab from './EquipmentTab'
import CommitteeTab from './CommitteeTab'

const TABS = [
  { key: 'incidents', label: 'Incidents', icon: AlertTriangle },
  { key: 'drills', label: 'Mock Drills', icon: Siren },
  { key: 'equipment', label: 'Emergency Equipment', icon: FireExtinguisher },
  { key: 'committee', label: 'HSE Committee', icon: Users },
]

export default function Analytics() {
  const { orgId, isAdmin } = useAuth()
  const sites = useAccessibleSites()
  const [tab, setTab] = useState('incidents')
  const [incidents, setIncidents] = useState([])
  const [drills, setDrills] = useState([])
  const [consultations, setConsultations] = useState([])
  const [extinguishers, setExt] = useState([])
  const [aeds, setAeds] = useState([])
  const [fas, setFas] = useState([])

  useEffect(() => {
    if (!orgId) return undefined
    const unsubs = [
      subscribeCollection(orgId, 'incidents', setIncidents),
      subscribeCollection(orgId, 'mockDrills', setDrills),
      subscribeCollection(orgId, 'consultations', setConsultations),
      subscribeCollection(orgId, 'extinguishers', setExt),
      subscribeCollection(orgId, 'aeds', setAeds),
      subscribeCollection(orgId, 'fas', setFas),
    ]
    return () => unsubs.forEach((u) => u && u())
  }, [orgId])


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
        <IncidentsTab incidents={incidents} sites={sites} keepUnplaced={isAdmin} />
      ) : tab === 'drills' ? (
        <DrillsTab drills={drills} sites={sites} keepUnplaced={isAdmin} />
      ) : tab === 'equipment' ? (
        <EquipmentTab extinguishers={extinguishers} aeds={aeds} fas={fas} sites={sites} keepUnplaced={isAdmin} />
      ) : (
        <CommitteeTab consultations={consultations} sites={sites} keepUnplaced={isAdmin} />
      )}
    </div>
  )
}

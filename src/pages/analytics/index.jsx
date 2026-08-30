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
import { BarChart3, AlertTriangle, Siren, FireExtinguisher, Users, Cctv, Scale, ListChecks, ClipboardCheck, Radar, UserCheck } from 'lucide-react'
import { useAuth } from '../../shared/auth/AuthContext'
import { subscribeCollections, emptyCollections } from '../../shared/org/orgData'
import { useAccessibleSites } from '../../shared/org/useAccessibleSites'
import { PageHeader } from '../../shared/ui'
import IncidentsTab from './IncidentsTab'
import DrillsTab from './DrillsTab'
import EquipmentTab from './EquipmentTab'
import CommitteeTab from './CommitteeTab'
import CctvTab from './CctvTab'
import StakeholderTab from './StakeholderTab'
import ActionsTab from './ActionsTab'
import InspectionsTab from './InspectionsTab'
import OdinTab from './OdinTab'
import AuditorsTab from './AuditorsTab'

// Icons match the portal registry's, so a tab here and the tile it reports on
// are recognisably the same thing.
const TABS = [
  // ODIN leads the LIST because it is the cross-module Safety & Security
  // picture the other tabs each show one slice of. It is deliberately not the
  // tab that OPENS — see the default below.
  //
  // ── needs, and why these two are the only tabs that have one ───────────────
  //
  // Every other tab reads Firestore, so every organization has something to put
  // in it. These two read a Metabase warehouse, which almost no organization
  // has. Shown unconditionally they were a chore inflicted on every tenant on
  // the platform: a tab whose entire content was an invitation to connect a
  // product they had never heard of, permanently, because they were never going
  // to connect it.
  //
  // So they appear only once an admin HAS connected Metabase — see
  // setIntegrationConnected, which mirrors that one boolean onto the org
  // document where an ordinary member can read it. Connecting happens in
  // Settings → Integrations, which is where an admin looking for it would go;
  // it is not something a member should be prompted about from an empty tab.
  { key: 'odin', label: 'ODIN', icon: Radar, needs: 'metabase' },
  // Beside ODIN because it reads the same warehouse question. ODIN asks whether
  // the estate is safe; this asks whether the audit programme actually ran.
  { key: 'auditors', label: 'Auditors', icon: UserCheck, needs: 'metabase' },
  { key: 'incidents', label: 'Incidents', icon: AlertTriangle },
  { key: 'inspections', label: 'Inspections', icon: ClipboardCheck },
  { key: 'drills', label: 'Mock Drills', icon: Siren },
  { key: 'equipment', label: 'Emergency Equipment', icon: FireExtinguisher },
  { key: 'committee', label: 'HSE Committee', icon: Users },
  { key: 'cctv', label: 'CCTV Defects', icon: Cctv },
  { key: 'stakeholder', label: 'Stakeholder Issues', icon: Scale },
  { key: 'actions', label: 'Action Tracker', icon: ListChecks },
]

// Read through subscribeCollections rather than each module's own subscribeX
// helper: those order and cap for their working lists — stakeholder's takes the
// newest 500 — and a total that quietly stops at 500 is exactly the kind of
// wrong an analytics page must not be. This read caps far higher and, when it
// does cap, says so at the top of the page.
const COLLECTIONS = [
  'incidents', 'mockDrills', 'consultations', 'extinguishers', 'aeds', 'fas',
  'cctvCameras', 'cctvDvrs', 'cctvMeraki', 'escalations', 'legalIssues',
  'inspectionRecords',
]

export default function Analytics() {
  const { orgId, isAdmin, actor, org } = useAuth()

  // The tabs this organization can actually fill. A tab with a `needs` is
  // offered only once that integration is connected — see the note on TABS.
  const tabs = useMemo(
    () => TABS.filter((t) => !t.needs || org?.integrations?.[t.needs] === true),
    [org],
  )
  const sites = useAccessibleSites()
  // Incidents opens, not ODIN, and the reason is that ODIN is the one tab that
  // reaches OFF this machine. Mounting it runs two callables against a
  // Metabase nobody has necessarily connected — so making it the landing tab
  // meant every visit to Analytics fired two requests that fail for every
  // tenant which has not set the integration up, and showed them a "not
  // connected" screen where their incident data used to be.
  //
  // It also broke the console sweep, which is how this was found: e2e runs the
  // auth and Firestore emulators but not functions, so the calls came back
  // ERR_CONNECTION_REFUSED and no amount of catching in JS suppresses a failed
  // request in the console. A tab that only loads when someone asks for it has
  // none of these problems.
  const [tab, setTab] = useState('incidents')
  const [store, setStore] = useState(() => emptyCollections(COLLECTIONS))

  useEffect(() => {
    if (!orgId) return undefined
    return subscribeCollections(orgId, COLLECTIONS, setStore)
  }, [orgId])

  // The org document is live, so an integration can be disconnected while
  // somebody is standing on the tab it feeds. Without this they keep the tab
  // they can no longer see in the tab strip, which reads as the page having
  // broken rather than as a setting having changed.
  useEffect(() => {
    if (!tabs.some((t) => t.key === tab)) setTab('incidents')
  }, [tabs, tab])

  const {
    incidents, mockDrills: drills, consultations, extinguishers, aeds, fas,
    cctvCameras: cameras, cctvDvrs: dvrs, cctvMeraki: merakis, escalations, legalIssues,
    inspectionRecords,
  } = store.data

  return (
    <div>
      <PageHeader
        title="Analytics"
        subtitle={`Across the ${sites.length} site${sites.length === 1 ? '' : 's'} you can see.`}
        icon={BarChart3}
      />

      {/* Above the tabs, because every tab counts these records and the reader
          has to see this before the number, not after. */}
      {store.incomplete && (
        <div
          role="status"
          className="mb-5 flex items-start gap-2.5 rounded-2xl bg-amber-50 px-4 py-3 shadow-clay-sm"
        >
          <AlertTriangle size={16} className="mt-0.5 flex-none text-amber-700" />
          <p className="text-[12.5px] leading-relaxed text-amber-900">
            <b>These figures are incomplete.</b> {store.incomplete.message}
          </p>
        </div>
      )}

      <div
        role="tablist"
        aria-label="Analytics modules"
        className="mb-5 flex gap-1.5 overflow-x-auto rounded-2xl bg-clay-surface p-2 shadow-clay-inset"
      >
        {tabs.map((t) => (
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

      {/* One exemption from the no-sites screen: ODIN, for an admin. Every other
          tab reads Firestore through the site scope, so an empty scope means an
          empty page and saying why is the useful thing to do. ODIN's population
          comes from Metabase instead, so an admin who has not created any sites
          yet still has a dashboard — they just have no map.
          A non-admin with no site grant keeps the message, because ODIN scopes
          them to their sites too (keepUnplaced below) and an empty dashboard
          with no explanation is the worst of both. */}
      {sites.length === 0 && !(tab === 'odin' && isAdmin) ? (
        <div className="card px-6 py-14 text-center">
          <p className="text-[15px] font-bold text-ink-900">No sites are visible to you</p>
          <p className="mx-auto mt-1.5 max-w-[46ch] text-[13px] leading-relaxed text-ink-500">
            Analytics is scoped to the sites your account can see. Ask an admin to map you to a site
            or grant you access to a region or entity.
          </p>
        </div>
      ) : tab === 'odin' ? (
        // The one tab whose data does not come from Firestore: ODIN queries
        // Metabase through a callable. `sites` is still handed to it, because
        // the site register is what puts a warehouse row on the map and what
        // bounds a viewer to the sites they may see.
        <OdinTab sites={sites} orgId={orgId} actor={actor} isAdmin={isAdmin} keepUnplaced={isAdmin} />
      ) : tab === 'auditors' ? (
        <AuditorsTab sites={sites} keepUnplaced={isAdmin} />
      ) : tab === 'incidents' ? (
        <IncidentsTab incidents={incidents} sites={sites} keepUnplaced={isAdmin} />
      ) : tab === 'inspections' ? (
        <InspectionsTab records={inspectionRecords} sites={sites} keepUnplaced={isAdmin} />
      ) : tab === 'drills' ? (
        <DrillsTab drills={drills} sites={sites} keepUnplaced={isAdmin} />
      ) : tab === 'equipment' ? (
        <EquipmentTab extinguishers={extinguishers} aeds={aeds} fas={fas} sites={sites} keepUnplaced={isAdmin} />
      ) : tab === 'committee' ? (
        <CommitteeTab consultations={consultations} sites={sites} keepUnplaced={isAdmin} />
      ) : tab === 'cctv' ? (
        <CctvTab cameras={cameras} dvrs={dvrs} merakis={merakis} sites={sites} keepUnplaced={isAdmin} />
      ) : tab === 'stakeholder' ? (
        <StakeholderTab escalations={escalations} legalIssues={legalIssues} sites={sites} keepUnplaced={isAdmin} />
      ) : (
        // The one tab that owns its query: the tracker gathers actions from every
        // module through a single extractor, so there is no one collection to
        // hand it — see modules/actions/lib/sources.js.
        <ActionsTab orgId={orgId} sites={sites} keepUnplaced={isAdmin} />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Portal home.
//
// Two audiences share this screen. An operator wants the four task cards and
// their own open work; a manager wants to know whether their sites are actually
// compliant. Both get the same page, scoped to whatever sites the viewer may
// see — so the numbers are never larger than the viewer's permission.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import {
  AlertTriangle, ArrowRight, MapPin, Building2, ScrollText, UsersRound, Settings, BarChart3,
} from 'lucide-react'
import { useAuth } from '../../shared/auth/AuthContext'
import { subscribeCollections, emptyCollections, subscribeOrgUsers } from '../../shared/org/orgData'
import { useAccessibleSites } from '../../shared/org/useAccessibleSites'
import { subscribeActions, NORM_BY_KEY } from '../../modules/actions/lib/sources'
import { subscribeAssignments } from '../../modules/training/lib/firestore'
import { INCIDENT_TYPE_BY_KEY } from '../../modules/incidents/lib/constants'
import { MODULES } from '../../shared/modules/registry'
import { Raised, Inset, SectionLabel } from './ui'
import { myActions } from './myWork'
import { portalStats, pendingWork } from './portalStats'
import WidgetGrid from './widgets/WidgetGrid'
import { useWidgetPrefs } from './widgets/useWidgetPrefs'
import { dashboardBuckets } from '../../modules/ptw/lib/permitStatus'
import { openUnsafeByPermit } from '../../modules/ptw/lib/observations'
import ModuleLogo3D, { has3DLogo } from './ModuleLogo3D'

// Same logo gradients the admin hub uses, so a module is recognisable by its
// tile wherever it appears.
const GRADIENT = {
  red: 'from-red-500 to-rose-600',
  amber: 'from-amber-500 to-orange-600',
  blue: 'from-sky-500 to-blue-600',
  violet: 'from-violet-500 to-purple-600',
  green: 'from-emerald-500 to-teal-600',
  brand: 'from-brand-500 to-brand-700',
}

// Admin tools. These configure the organization rather than record work in it,
// so the whole section is admin-only — a manager or auditor who can read the
// audit log still reaches it from the module they are working in, and does not
// need the org's plumbing on their home screen.
//
// Route guards are unchanged and remain the real control; hiding a tile is
// presentation, not permission.
const ADMIN_TOOLS = [
  { key: 'sites', label: 'Sites', title: 'Locations across your organization', path: '/sites', icon: Building2, tone: 'brand' },
  { key: 'users', label: 'Employees', title: 'Roles, access and bulk upload', path: '/users', icon: UsersRound, tone: 'green' },
  { key: 'settings', label: 'Org Settings', title: 'Organization profile and preferences', path: '/settings', icon: Settings, tone: 'amber' },
  { key: 'audit-log', label: 'Audit Log', title: 'Append-only record of every action', path: '/audit-log', icon: ScrollText, tone: 'violet' },
]

/**
 * A module tile that tilts under the cursor.
 *
 * The card and the logo move on different axes and by different amounts: the
 * card leans back, the logo lifts toward the viewer and turns slightly. Moving
 * them together would just be a scale — the gap between the two is what reads
 * as depth, and it is the reason the tile needs a perspective of its own rather
 * than inheriting one from the grid.
 *
 * Everything is transform and opacity, so it stays off the main thread, and
 * `motion-reduce` drops the whole effect rather than softening it.
 */
function Tile({ to, icon: Icon, gradient, label, title, delay = 0, logoKey }) {
  const has3D = has3DLogo(logoKey)
  return (
    <div className="[perspective:760px]">
      <Link
        to={to}
        style={{ animationDelay: `${delay}ms` }}
        className="group relative flex animate-fade-in-up items-center gap-4 rounded-[26px] bg-clay-surface p-5 shadow-clay
                   transition-[transform,box-shadow] duration-300 ease-emil [transform-style:preserve-3d]
                   hover:shadow-clay-lg hover:[transform:translateY(-8px)_rotateX(9deg)_rotateY(-9deg)]
                   active:[transform:translateY(-3px)_scale(0.985)]
                   motion-reduce:transition-none motion-reduce:hover:[transform:none]"
      >
        {/* The logo lifts far enough off the card for the perspective to bend
            it — the wobble below only reads as rotation because of this gap. */}
        <span
          className="relative grid h-[60px] w-[60px] flex-none place-items-center [transform-style:preserve-3d]
                     transition-transform duration-300 ease-emil
                     group-hover:[transform:translateZ(56px)_scale(1.12)]
                     motion-reduce:transition-none motion-reduce:group-hover:[transform:none]"
        >
          {/* Colour cast on the card beneath, so the lift has somewhere to fall from. */}
          <span
            aria-hidden="true"
            className={`absolute inset-0 rounded-[20px] bg-gradient-to-br ${gradient} opacity-0 blur-lg
                        transition-opacity duration-300 group-hover:opacity-60 motion-reduce:hidden`}
          />
          {/* Modules with a built object let the object do the moving; the
              rest keep the turn, since a static glyph has nothing else to say. */}
          <span
            className={`relative grid h-full w-full place-items-center overflow-hidden rounded-[20px]
                        bg-gradient-to-br ${gradient} text-white shadow-clay-sm [transform-style:preserve-3d]
                        ${has3D ? '' : 'group-hover:animate-wobble3d'} motion-reduce:group-hover:animate-none`}
          >
            {/* A built object where one exists; the line icon otherwise, rather
                than giving a module a shape that means something else. */}
            {has3D
              ? <ModuleLogo3D moduleKey={logoKey} />
              : <Icon size={28} strokeWidth={2} className="relative z-10 drop-shadow-[0_2px_3px_rgba(0,0,0,0.28)]" />}
            {/* Specular sweep — what makes the face read as glossy rather than flat. */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/2 bg-white/45 opacity-0
                         group-hover:animate-sheen motion-reduce:group-hover:animate-none"
            />
          </span>
        </span>

        <span className="min-w-0 transition-transform duration-300 ease-emil group-hover:[transform:translateZ(26px)] motion-reduce:group-hover:[transform:none]">
          <span className="block text-[15px] font-bold tracking-[-0.015em] text-ink-900">{label}</span>
          <span className="mt-0.5 block text-[12px] leading-snug text-ink-400">{title}</span>
        </span>
      </Link>
    </div>
  )
}

/**
 * Attach each permit's count of unanswered unsafe observations.
 *
 * The permits module does this in its own context, which the portal does not
 * mount — so it is repeated here rather than left out. Without it the portal
 * would count a permit with an unsafe report against it as merely open, while
 * the permits page shows it flagged.
 */
function withUnsafe(permits = [], observations = []) {
  const counts = openUnsafeByPermit(observations)
  return permits.map((p) => ({ ...p, openUnsafeCount: counts.get(p.id) || 0 }))
}

// Everything on this page that is a count comes from these. Read as one set so
// the page cannot show a compliance figure without also showing that a cap or a
// failed read made it short.
const COLLECTIONS = [
  'extinguishers', 'aeds', 'fas', 'signages', 'incidents',
  'consultations', 'mockDrills', 'permits', 'observations',
]

const greeting = (d = new Date()) => {
  const h = d.getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export default function PortalHome() {
  const { orgId, profile, isAdmin } = useAuth()
  const navigate = useNavigate()
  const sites = useAccessibleSites()
  const { keys: widgetKeys, save: saveWidgets } = useWidgetPrefs()

  const [siteId, setSiteId] = useState('all')
  const [store, setStore] = useState(() => emptyCollections(COLLECTIONS))
  const [assignments, setAssignments] = useState([])
  const [users, setUsers] = useState([])
  const [actions, setActions] = useState([])

  useEffect(() => {
    if (!orgId) return undefined
    const unsubs = [
      subscribeCollections(orgId, COLLECTIONS, setStore),
      subscribeAssignments(orgId, setAssignments),
      subscribeOrgUsers(orgId, setUsers),
      subscribeActions(orgId, setActions),
    ]
    return () => unsubs.forEach((u) => u && u())
  }, [orgId])

  const {
    extinguishers, aeds, fas, signages, incidents,
    consultations: meetings, mockDrills: drills, permits, observations,
  } = store.data

  // A filter pointing at a site the viewer lost access to would silently show
  // zeros, so fall back to everything rather than to an empty scope.
  const activeSite = sites.some((s) => s.id === siteId) ? siteId : 'all'

  const stats = useMemo(
    () => portalStats({
      sites, siteId: activeSite, extinguishers, aeds, fas, signages, incidents, assignments, users,
      meetings, drills, permits,
    }),
    [sites, activeSite, extinguishers, aeds, fas, signages, incidents, assignments, users, meetings, drills, permits]
  )

  const mine = useMemo(() => myActions(actions, profile), [actions, profile])
  const open = mine.filter((a) => a.norm !== 'done')

  const pending = useMemo(
    () => pendingWork({ sites, siteId: activeSite, actions, assignments, users, limit: 5 }),
    [sites, activeSite, actions, assignments, users]
  )

  const pie = stats.incidentsByType.map((r) => ({
    name: INCIDENT_TYPE_BY_KEY[r.key]?.label || 'Unspecified',
    value: r.value,
    color: INCIDENT_TYPE_BY_KEY[r.key]?.color || '#8a7660',
  }))
  const bars = stats.equipmentBySite.slice(0, 8)

  const firstName = (profile?.name || '').split(' ')[0] || 'there'
  const scopeLabel = activeSite === 'all'
    ? `${sites.length} site${sites.length === 1 ? '' : 's'} you can see`
    : sites.find((s) => s.id === activeSite)?.name

  // Everything a widget can ask for, already scoped. Widgets read from this
  // rather than from the raw collections, so none of them can reach around the
  // scoping that portalStats applied.
  const widgetData = useMemo(() => ({
    stats,
    extinguishers: extinguishers.length ? stats.scoped.extinguishers : null,
    aeds: aeds.length ? stats.scoped.aeds : null,
    fas: fas.length ? stats.scoped.fas : null,
    meetings: meetings.length ? stats.counts.meetings : null,
    drills: drills.length ? stats.counts.drills : null,
    // Joined the same way the permits module does it, or the portal would
    // count a permit with an unanswered unsafe report as merely open while the
    // permits page flags it — two screens disagreeing about the same permit.
    permits: permits.length ? dashboardBuckets(withUnsafe(stats.scoped.permits, observations)) : null,
    myOpenActions: actions.length ? open.length : null,
    myPendingTraining: assignments.length ? pending.training.length : null,
  }), [stats, extinguishers, aeds, fas, meetings, drills, permits, observations, actions, assignments, open, pending])

  return (
    <div className="animate-fade-in-up">
      <div className="mb-5 grid gap-4 lg:grid-cols-[1.55fr_1fr]">
        <Raised className="relative overflow-hidden px-7 py-6">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(60% 90% at 96% 12%, rgba(221,90,65,.14), transparent 65%),' +
                'radial-gradient(50% 80% at 88% 96%, rgba(127,196,187,.16), transparent 60%)',
            }}
          />
          <p className="relative text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <h1 className="relative mt-2 text-[30px] font-extrabold leading-[1.15] tracking-[-0.025em] text-ink-900">
            {greeting()}, {firstName}.
          </h1>
          <p className="relative mt-2 max-w-[46ch] text-sm leading-relaxed text-ink-500">
            {open.length
              ? `${open.length} action${open.length === 1 ? '' : 's'} assigned to you. Everything below is scoped to ${scopeLabel}.`
              : `Nothing is waiting on you. Everything below is scoped to ${scopeLabel}.`}
          </p>
          <div className="relative mt-5 flex flex-wrap gap-2.5">
            {/* With no navigation bar, this is the only way to the report
                wizard — and reporting is the thing most people open the portal
                to do, so it leads. */}
            <button
              type="button"
              onClick={() => navigate('/portal/report')}
              className="inline-flex items-center gap-1.5 rounded-2xl bg-brand-600 px-4 py-2.5 text-[13px] font-semibold text-white shadow-clay-brand transition-transform duration-200 ease-emil hover:bg-brand-700 active:scale-[0.97]"
            >
              <AlertTriangle size={15} strokeWidth={2.2} />
              Report an incident
            </button>
            <button
              type="button"
              onClick={() => navigate('/portal/actions')}
              className="inline-flex items-center gap-1.5 rounded-2xl bg-brand-100 px-4 py-2.5 text-[13px] font-semibold text-brand-700 shadow-clay-sm transition-transform duration-200 ease-emil active:scale-[0.97]"
            >
              {open.length ? `My ${open.length} open action${open.length === 1 ? '' : 's'}` : 'My actions'}
              <ArrowRight size={14} strokeWidth={2.4} />
            </button>
            <button
              type="button"
              onClick={() => navigate('/portal/training')}
              className="inline-flex items-center gap-1.5 rounded-2xl bg-clay-surface px-4 py-2.5 text-[13px] font-semibold text-ink-700 shadow-clay-sm transition-transform duration-200 ease-emil active:scale-[0.97]"
            >
              My training
            </button>
          </div>
        </Raised>

        <Raised className="flex flex-col gap-3 p-5">
          <SectionLabel className="tracking-[0.14em]">Viewing</SectionLabel>
          <label className="sr-only" htmlFor="site-scope">Site</label>
          <div className="relative">
            <MapPin size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400" />
            <select
              id="site-scope"
              value={activeSite}
              onChange={(e) => setSiteId(e.target.value)}
              className="w-full appearance-none rounded-2xl border border-transparent bg-clay-surface py-3 pl-10 pr-3.5 text-[13.5px] font-semibold text-ink-900 shadow-clay-inset outline-none"
            >
              <option value="all">All my sites ({sites.length})</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <p className="text-[11.5px] leading-relaxed text-ink-400">
            {sites.length === 0
              ? 'No sites are mapped to you yet, so these figures cover nothing. Ask an admin to map your site.'
              : 'Every figure on this page is limited to the sites your account can see.'}
          </p>
          {open.length > 0 && (
            <div className="mt-auto flex flex-col gap-2 border-t border-ink-100 pt-3">
              {open.slice(0, 2).map((a) => (
                <Link
                  key={a.key}
                  to="/portal/actions"
                  className="flex items-center gap-2.5 rounded-[14px] bg-clay-50 px-3 py-2 shadow-clay-sm"
                >
                  <span className="h-6 w-1 flex-none rounded" style={{ background: NORM_BY_KEY[a.norm]?.color || '#ab987f' }} />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink-900">{a.title}</span>
                  {a.overdue && <span className="flex-none rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">Overdue</span>}
                </Link>
              ))}
            </div>
          )}
        </Raised>
      </div>

      {/* Ahead of the widgets, the charts and the due lists — everything below
          counts these records, so the caveat cannot sit under them. */}
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

      <WidgetGrid keys={widgetKeys} onSave={saveWidgets} data={widgetData} sites={sites} />

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Raised className="p-5">
          <p className="text-[15px] font-bold tracking-[-0.015em] text-ink-900">Incidents by type</p>
          <p className="mb-2 text-[11.5px] text-ink-400">{scopeLabel}</p>
          {pie.length === 0 ? (
            <EmptyChart>No incidents recorded for this scope — which is the result you want.</EmptyChart>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={pie} dataKey="value" nameKey="name" outerRadius={82} innerRadius={46} paddingAngle={2}>
                  {pie.map((d) => <Cell key={d.name} fill={d.color} />)}
                </Pie>
                <Tooltip />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Raised>

        <Raised className="p-5">
          <p className="text-[15px] font-bold tracking-[-0.015em] text-ink-900">Equipment by site</p>
          <p className="mb-2 text-[11.5px] text-ink-400">
            {bars.length ? `Busiest ${bars.length} of ${stats.equipmentBySite.length}` : scopeLabel}
          </p>
          {bars.length === 0 ? (
            <EmptyChart>No equipment is linked to these sites yet.</EmptyChart>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={bars} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <XAxis
                  dataKey="name" tickLine={false} axisLine={false} fontSize={11}
                  tick={{ fill: '#8a7660' }} interval={0} tickFormatter={(v) => String(v).slice(0, 10)}
                />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} tick={{ fill: '#8a7660' }} />
                <Tooltip cursor={{ fill: 'rgba(227,204,191,0.35)' }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="extinguishers" name="Extinguishers" fill="#dd5a41" radius={[6, 6, 0, 0]} />
                <Bar dataKey="aeds" name="AED" fill="#7fc4bb" radius={[6, 6, 0, 0]} />
                <Bar dataKey="fas" name="Fire alarm" fill="#e8a33d" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Raised>
      </div>

      <SectionLabel className="mb-3">Closest to due</SectionLabel>
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Raised className="p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <p className="text-[15px] font-bold tracking-[-0.015em] text-ink-900">Pending actions</p>
            <Link to="/portal/actions" className="text-xs font-semibold text-brand-700">My actions</Link>
          </div>
          <DueList
            rows={pending.actions}
            empty="No open actions across these sites."
            meta={(r) => r.source}
          />
        </Raised>

        <Raised className="p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <p className="text-[15px] font-bold tracking-[-0.015em] text-ink-900">Pending training</p>
            <Link to="/portal/training" className="text-xs font-semibold text-brand-700">My training</Link>
          </div>
          <DueList
            rows={pending.training}
            empty="Nothing outstanding for people at these sites."
          />
        </Raised>
      </div>

      <SectionLabel className="mb-3">All modules</SectionLabel>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {/* Analytics sits in the grid rather than above it — it is one more
            destination, and a full-width banner claimed an importance the
            others have equal claim to. */}
        <Tile
          to="/analytics"
          icon={BarChart3}
          gradient="from-sky-500 to-blue-600"
          label="Analytics"
          title="Trends and breakdowns across your sites"
          logoKey="analytics"
        />
        {MODULES.map((m, i) => (
          <Tile
            key={m.key}
            to={m.path}
            icon={m.icon}
            gradient={GRADIENT[m.tone] || GRADIENT.brand}
            label={m.label}
            title={m.title}
            logoKey={m.key}
            delay={Math.min(i, 8) * 40}
          />
        ))}
      </div>

      {isAdmin && (
        <>
          <SectionLabel className="mb-3 mt-8">Admin tools</SectionLabel>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {ADMIN_TOOLS.map((s) => (
              <Tile
                key={s.key}
                to={s.path}
                icon={s.icon}
                gradient={GRADIENT[s.tone] || GRADIENT.brand}
                label={s.label}
                title={s.title}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * A due-date list: what it is, who owns it, when it is due.
 *
 * The owner is shown on every row rather than only where it differs, because
 * the question this list answers is "whose is it" as much as "what is it".
 */
function DueList({ rows, empty, meta }) {
  if (!rows.length) {
    return (
      <p className="rounded-[18px] bg-clay-50 px-4 py-6 text-center text-[13px] text-ink-400 shadow-clay-sm">
        {empty}
      </p>
    )
  }
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <li
          key={r.key}
          className="flex items-center gap-3.5 rounded-[18px] bg-clay-50 px-4 py-3 shadow-clay-sm"
        >
          <span
            className="h-[34px] w-1 flex-none rounded"
            style={{ background: r.overdue ? '#ef4444' : r.due ? '#e8a33d' : '#ab987f' }}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-semibold text-ink-900">{r.title}</p>
            <p className="mt-0.5 truncate text-[11.5px] text-ink-400">
              {r.owner}{meta && meta(r) ? ` · ${meta(r)}` : ''}
            </p>
          </div>
          <span
            className={`flex-none rounded-full px-2.5 py-1 text-[10.5px] font-bold ${
              r.overdue ? 'bg-red-100 text-red-700' : 'bg-clay-100 text-ink-600'
            }`}
          >
            {r.overdue ? 'Overdue' : r.due || 'No date'}
          </span>
        </li>
      ))}
    </ul>
  )
}

function EmptyChart({ children }) {
  return (
    <Inset className="grid h-[240px] place-items-center px-6 text-center">
      <p className="max-w-[32ch] text-[13px] leading-relaxed text-ink-400">{children}</p>
    </Inset>
  )
}

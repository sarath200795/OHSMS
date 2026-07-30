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
  AlertTriangle, Eye, ClipboardCheck, BookOpen, ArrowRight, MapPin,
  FireExtinguisher, HeartPulse, BellRing, GraduationCap, Signpost,
} from 'lucide-react'
import { useAuth } from '../../shared/auth/AuthContext'
import { subscribeCollection, subscribeOrgUsers } from '../../shared/org/orgData'
import { useAccessibleSites } from '../../shared/org/useAccessibleSites'
import { subscribeActions, NORM_BY_KEY } from '../../modules/actions/lib/sources'
import { subscribeAssignments } from '../../modules/training/lib/firestore'
import { INCIDENT_TYPE_BY_KEY } from '../../modules/incidents/lib/constants'
import { MODULES } from '../../shared/modules/registry'
import { Raised, Inset, SectionLabel } from './ui'
import { myActions } from './myWork'
import { portalStats } from './portalStats'

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

const QUICK = [
  { key: 'incident', to: '/portal/report', icon: AlertTriangle, title: 'Report an incident', blurb: 'Injury, damage or anything that went wrong.', from: '#e77a64', via: '#a63c2a' },
  { key: 'near-miss', to: '/portal/report?type=near_miss', icon: Eye, title: 'Log a near miss', blurb: 'Nothing happened — but it nearly did.', from: '#8ba7bd', via: '#5b7f9c' },
  { key: 'permit', to: '/permits', icon: ClipboardCheck, title: 'Request a permit', blurb: 'Hot work, height, confined space, electrical.', from: '#8fbc74', via: '#4f8b53' },
  { key: 'docs', to: '/documents', icon: BookOpen, title: 'Find a document', blurb: 'SOPs, SDS sheets and site safety rules.', from: '#e8a33d', via: '#c07a17' },
]

const greeting = (d = new Date()) => {
  const h = d.getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export default function PortalHome() {
  const { orgId, profile } = useAuth()
  const navigate = useNavigate()
  const sites = useAccessibleSites()

  const [siteId, setSiteId] = useState('all')
  const [extinguishers, setExt] = useState([])
  const [aeds, setAeds] = useState([])
  const [fas, setFas] = useState([])
  const [signages, setSignages] = useState([])
  const [incidents, setIncidents] = useState([])
  const [assignments, setAssignments] = useState([])
  const [users, setUsers] = useState([])
  const [actions, setActions] = useState([])

  useEffect(() => {
    if (!orgId) return undefined
    const unsubs = [
      subscribeCollection(orgId, 'extinguishers', setExt),
      subscribeCollection(orgId, 'aeds', setAeds),
      subscribeCollection(orgId, 'fas', setFas),
      subscribeCollection(orgId, 'signages', setSignages),
      subscribeCollection(orgId, 'incidents', setIncidents),
      subscribeAssignments(orgId, setAssignments),
      subscribeOrgUsers(orgId, setUsers),
      subscribeActions(orgId, setActions),
    ]
    return () => unsubs.forEach((u) => u && u())
  }, [orgId])

  // A filter pointing at a site the viewer lost access to would silently show
  // zeros, so fall back to everything rather than to an empty scope.
  const activeSite = sites.some((s) => s.id === siteId) ? siteId : 'all'

  const stats = useMemo(
    () => portalStats({
      sites, siteId: activeSite, extinguishers, aeds, fas, signages, incidents, assignments, users,
    }),
    [sites, activeSite, extinguishers, aeds, fas, signages, incidents, assignments, users]
  )

  const mine = useMemo(() => myActions(actions, profile), [actions, profile])
  const open = mine.filter((a) => a.norm !== 'done')

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

  const KPIS = [
    { key: 'training', icon: GraduationCap, label: 'Training compliance', value: fmtPct(stats.trainingCompliance), sub: `${stats.trainingTotal} assigned`, tone: '#8fbc74' },
    { key: 'ext', icon: FireExtinguisher, label: 'Fire extinguishers', value: stats.counts.extinguishers, sub: 'deployed', tone: '#dd5a41' },
    { key: 'aed', icon: HeartPulse, label: 'AED units', value: stats.counts.aeds, sub: 'deployed', tone: '#7fc4bb' },
    { key: 'fas', icon: BellRing, label: 'Fire alarm devices', value: stats.counts.fas, sub: 'deployed', tone: '#e8a33d' },
    { key: 'signage', icon: Signpost, label: 'Signage compliance', value: fmtPct(stats.signageCompliance), sub: `${stats.signageTotal} checked`, tone: '#8ba7bd' },
    { key: 'incidents', icon: AlertTriangle, label: 'Incidents', value: stats.counts.incidents, sub: 'recorded', tone: '#a855f7' },
  ]

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

      <SectionLabel className="mb-3">How are my sites doing?</SectionLabel>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {KPIS.map((k) => (
          <Raised key={k.key} className="p-4">
            <span className="grid h-9 w-9 place-items-center rounded-xl text-white" style={{ background: k.tone }}>
              <k.icon size={17} strokeWidth={2.2} />
            </span>
            <p className="mt-3 text-[26px] font-extrabold leading-none tracking-[-0.03em] text-ink-900">{k.value}</p>
            <p className="mt-1.5 text-[12px] font-semibold leading-snug text-ink-700">{k.label}</p>
            <p className="text-[11px] text-ink-400">{k.sub}</p>
          </Raised>
        ))}
      </div>

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

      <SectionLabel className="mb-3">What do you need to do?</SectionLabel>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {QUICK.map((q, i) => (
          <button
            key={q.key}
            type="button"
            onClick={() => navigate(q.to)}
            style={{ animationDelay: `${i * 60}ms` }}
            className="flex animate-fade-in-up flex-col items-start gap-3.5 rounded-[26px] bg-clay-surface p-5 text-left shadow-clay transition duration-200 ease-emil hover:-translate-y-1 active:scale-[0.985]"
          >
            <span
              className="grid h-[52px] w-[52px] place-items-center rounded-[20px] text-white shadow-clay-sm"
              style={{ background: `linear-gradient(135deg, ${q.from}, ${q.via})` }}
            >
              <q.icon size={25} strokeWidth={2.1} />
            </span>
            <span className="block">
              <span className="block text-[15px] font-bold tracking-[-0.015em] text-ink-900">{q.title}</span>
              <span className="mt-1 block text-[12.5px] leading-relaxed text-ink-500">{q.blurb}</span>
            </span>
          </button>
        ))}
      </div>

      <SectionLabel className="mb-3">All modules</SectionLabel>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {MODULES.map((m) => (
          <Link
            key={m.key}
            to={m.path}
            className="flex items-center gap-3 rounded-[20px] bg-clay-surface p-3.5 shadow-clay-sm transition duration-200 ease-emil hover:-translate-y-0.5 hover:shadow-clay active:scale-[0.985]"
          >
            <span className={`grid h-10 w-10 flex-none place-items-center rounded-[14px] bg-gradient-to-br ${GRADIENT[m.tone] || GRADIENT.brand} text-white shadow-clay-sm`}>
              <m.icon size={19} strokeWidth={2.1} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-bold tracking-[-0.01em] text-ink-900">{m.label}</span>
              <span className="block truncate text-[11px] text-ink-400">{m.title}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}

/** '—' rather than '0%' when there is nothing to measure. */
function fmtPct(v) {
  return v === null || v === undefined ? '—' : `${v}%`
}

function EmptyChart({ children }) {
  return (
    <Inset className="grid h-[240px] place-items-center px-6 text-center">
      <p className="max-w-[32ch] text-[13px] leading-relaxed text-ink-400">{children}</p>
    </Inset>
  )
}

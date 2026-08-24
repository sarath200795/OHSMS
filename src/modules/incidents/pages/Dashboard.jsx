import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, LabelList, Legend,
} from 'recharts'
import ChartFrame from '../../../shared/ui/ChartFrame'
import {
  LayoutDashboard, ClipboardList, ShieldCheck, ListChecks, AlertTriangle, Activity, Filter, X, Search, CheckCircle2, EyeOff,
} from 'lucide-react'
import { PageHeader } from '../components/ui'
import CountUp from '../../../shared/ui/CountUp'
import { BodyHeatmap } from '../components/BodyMap'
import { useIncidents } from '../context/IncidentContext'
import { summarizeActions } from '../lib/actions'
import {
  INCIDENT_TYPES, INCIDENT_TYPE_BY_KEY, SEVERITY, SEVERITY_BY_KEY,
  HSE_CATEGORIES, HSE_CATEGORY_BY_KEY, LOCATIONS, ACTION_STATUS,
  bodyPartLabel,
} from '../lib/constants'

const DIMS = ['severity', 'type', 'category', 'location', 'body']
const emptyFilters = () => ({ severity: new Set(), type: new Set(), category: new Set(), location: new Set(), body: new Set() })
const LOC_COLORS = ['#795548', '#0891b2', '#16a34a', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444', '#14b8a6', '#f97316', '#64748b', '#0ea5e9']
const locColor = (loc) => LOC_COLORS[LOCATIONS.indexOf(loc) % LOC_COLORS.length] || '#64748b'

const card = { hidden: { opacity: 0, y: 16 }, show: (i) => ({ opacity: 1, y: 0, transition: { delay: i * 0.05 } }) }

function ChartCard({ title, subtitle, children, className = '' }) {
  return (
    <motion.div variants={card} initial="hidden" animate="show" className={`card p-5 ${className}`}>
      <div className="mb-3">
        <h3 className="font-bold text-ink-900">{title}</h3>
        {subtitle && <p className="text-xs text-ink-400">{subtitle}</p>}
      </div>
      {children}
    </motion.div>
  )
}

function Empty() {
  return <div className="flex h-52 items-center justify-center text-sm text-ink-400">No data yet</div>
}

function segOpacity(set, value) {
  if (!set || set.size === 0) return 1
  return set.has(value) ? 1 : 0.3
}

function renderPieValue({ cx, cy, midAngle, innerRadius, outerRadius, value }) {
  if (!value) return null
  const RAD = Math.PI / 180
  const r = innerRadius + (outerRadius - innerRadius) * 0.5
  const x = cx + r * Math.cos(-midAngle * RAD)
  const y = cy + r * Math.sin(-midAngle * RAD)
  return <text x={x} y={y} fill="#fff" fontSize={14} fontWeight={800} textAnchor="middle" dominantBaseline="central">{value}</text>
}

const NO_KEYS = new Set()

/**
 * Injured body parts per incident, built from /injuries.
 *
 * They used to be read straight off incident.injuryReports, which is what put a
 * named colleague's body parts in front of every member and the external
 * auditor. /injuries is manager-gated, so for anyone else this map is empty —
 * and an empty map must never be presented as "no injuries" (see the body-map
 * card below).
 */
function bodyKeysByIncident(injuries) {
  const m = new Map()
  for (const j of injuries) {
    if (!j.incidentId) continue
    const s = m.get(j.incidentId) || new Set()
    for (const k of j.bodyParts || []) s.add(k)
    m.set(j.incidentId, s)
  }
  return m
}

function chipMeta(dim, value) {
  if (dim === 'severity') return { label: SEVERITY_BY_KEY[value]?.label || value, color: SEVERITY_BY_KEY[value]?.color }
  if (dim === 'type') return { label: INCIDENT_TYPE_BY_KEY[value]?.label || value, color: INCIDENT_TYPE_BY_KEY[value]?.color }
  if (dim === 'category') return { label: HSE_CATEGORY_BY_KEY[value]?.label || value, color: HSE_CATEGORY_BY_KEY[value]?.color }
  if (dim === 'location') return { label: value, color: locColor(value) }
  if (dim === 'body') return { label: bodyPartLabel(value), color: '#6d4c41' }
  return { label: value, color: '#64748b' }
}

export default function Dashboard() {
  const { incidents, illnesses, injuries, allActions, bodyPartCounts, canReadHealth } = useIncidents()
  const [filters, setFilters] = useState(emptyFilters)
  const [search, setSearch] = useState('')
  const bodyKeys = useMemo(() => bodyKeysByIncident(injuries), [injuries])

  const toggle = (dim, value) => setFilters((prev) => {
    const next = { ...prev, [dim]: new Set(prev[dim]) }
    next[dim].has(value) ? next[dim].delete(value) : next[dim].add(value)
    return next
  })
  const setSingle = (dim, value) => setFilters((prev) => ({ ...prev, [dim]: value ? new Set([value]) : new Set() }))
  const clearAll = () => { setFilters(emptyFilters()); setSearch('') }

  const activeChips = DIMS.flatMap((dim) => Array.from(filters[dim]).map((value) => ({ dim, value })))
  const filtersActive = activeChips.length > 0 || search

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return incidents.filter((i) => {
      if (q && !`${i.refNo} ${i.location} ${i.narrative}`.toLowerCase().includes(q)) return false
      if (filters.severity.size && !filters.severity.has(i.severity)) return false
      if (filters.type.size && !filters.type.has(i.type)) return false
      if (filters.category.size && !filters.category.has(i.category)) return false
      if (filters.location.size && !filters.location.has(i.location)) return false
      if (filters.body.size) {
        const keys = bodyKeys.get(i.id) || NO_KEYS
        let any = false
        for (const b of filters.body) if (keys.has(b)) { any = true; break }
        if (!any) return false
      }
      return true
    })
  }, [incidents, search, filters, bodyKeys])

  // Body-map counts derived from the CURRENTLY FILTERED set, so changing any
  // filter (category, severity, …) updates the heatmap. Illnesses lack the
  // incident dimensions, so they're only counted when no incident-only filter
  // is active (still honouring an active location filter).
  const bodyCounts = useMemo(() => {
    const c = {}
    const shown = new Set(filtered.map((i) => i.id))
    for (const j of injuries) {
      if (!shown.has(j.incidentId)) continue
      for (const k of j.bodyParts || []) c[k] = (c[k] || 0) + 1
    }
    const incidentDimActive = filters.severity.size || filters.type.size || filters.category.size
    if (!incidentDimActive) {
      for (const ill of illnesses) {
        if (filters.location.size && !filters.location.has(ill.location)) continue
        for (const k of ill.affectedBodyParts || []) c[k] = (c[k] || 0) + 1
      }
    }
    return c
  }, [filtered, injuries, illnesses, filters])

  const sevData = useMemo(() => SEVERITY.map((s) => ({ name: s.label, key: s.key, value: filtered.filter((i) => i.severity === s.key).length, color: s.color })).filter((d) => d.value), [filtered])
  const typeData = useMemo(() => INCIDENT_TYPES.map((t) => ({ name: t.label, key: t.key, value: filtered.filter((i) => i.type === t.key).length, color: t.color })).filter((d) => d.value), [filtered])
  const catData = useMemo(() => HSE_CATEGORIES.map((c) => ({ name: c.label, key: c.key, value: filtered.filter((i) => i.category === c.key).length, color: c.color })).filter((d) => d.value).sort((a, b) => b.value - a.value), [filtered])
  const locData = useMemo(() => LOCATIONS.map((l) => ({ name: l, key: l, value: filtered.filter((i) => i.location === l).length, color: locColor(l) })).filter((d) => d.value), [filtered])
  const actionSummary = useMemo(() => summarizeActions(allActions), [allActions])
  const actionData = ACTION_STATUS.map((s) => ({ name: s.label, key: s.key, value: actionSummary[s.key] || 0, color: s.color })).filter((d) => d.value)

  const openCount = filtered.filter((i) => i.lifecycle !== 'closed').length
  const closedCount = filtered.filter((i) => i.lifecycle === 'closed').length

  const kpis = [
    { label: 'Total Incidents', value: filtered.length, color: '#6d4c41', icon: ClipboardList, onClick: clearAll },
    { label: 'Open', value: openCount, color: '#f59e0b', icon: Activity },
    { label: 'Closed', value: closedCount, color: '#16a34a', icon: CheckCircle2 },
    { label: 'Open Actions', value: actionSummary.open + actionSummary.in_progress, color: '#795548', icon: ListChecks, to: '/incidents/actions' },
    { label: 'Overdue Actions', value: actionSummary.overdue, color: '#dc2626', icon: AlertTriangle, to: '/incidents/actions' },
    { label: 'Illnesses', value: illnesses.length, color: '#0891b2', icon: ShieldCheck, to: '/incidents/illness' },
  ]

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Click any chart segment to filter. Selections stack." icon={LayoutDashboard} tourId="dash-header" />

      {/* Filter bar */}
      <div className="card mb-4 flex flex-wrap items-center gap-3 p-4">
        <span className="flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-ink-400"><Filter size={13} /> Filters</span>
        <div className="relative min-w-[200px] flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input className="input pl-9" placeholder="Search ref, location, narrative…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="input w-auto" value={filters.severity.size === 1 ? [...filters.severity][0] : ''} onChange={(e) => setSingle('severity', e.target.value)}>
          <option value="">All severities</option>
          {SEVERITY.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <select className="input w-auto" value={filters.type.size === 1 ? [...filters.type][0] : ''} onChange={(e) => setSingle('type', e.target.value)}>
          <option value="">All types</option>
          {INCIDENT_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <select className="input w-auto" value={filters.location.size === 1 ? [...filters.location][0] : ''} onChange={(e) => setSingle('location', e.target.value)}>
          <option value="">All locations</option>
          {LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>

      {filtersActive && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-ink-400">Active:</span>
          {search && <button className="chip bg-clay-100 text-ink-600" onClick={() => setSearch('')}>“{search}” <X size={12} /></button>}
          {activeChips.map(({ dim, value }) => {
            const m = chipMeta(dim, value)
            return <button key={`${dim}:${value}`} className="chip text-white" style={{ backgroundColor: m.color }} onClick={() => toggle(dim, value)}>{m.label} <X size={12} /></button>
          })}
          <button className="btn-ghost px-2.5 py-1 text-xs" onClick={clearAll}>Clear all</button>
        </motion.div>
      )}

      {/* KPI cards */}
      <div data-tour="dash-kpis" className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {kpis.map((k, i) => {
          const inner = (
            <>
              <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-10 transition group-hover:scale-150" style={{ backgroundColor: k.color }} />
              <div className="mb-3 grid h-11 w-11 place-items-center rounded-xl text-white" style={{ backgroundColor: k.color }}><k.icon size={20} /></div>
              <p className="text-3xl font-black text-ink-900"><CountUp value={k.value} /></p>
              <p className="text-sm font-medium text-ink-500">{k.label}</p>
            </>
          )
          const cls = 'card group relative block w-full overflow-hidden p-5 text-left transition hover:-translate-y-0.5 hover:shadow-glow'
          return (
            <motion.div key={k.label} variants={card} custom={i} initial="hidden" animate="show">
              {k.to ? <Link to={k.to} className={cls}>{inner}</Link> : <button className={cls} onClick={k.onClick}>{inner}</button>}
            </motion.div>
          )
        })}
      </div>

      {/* Charts */}
      <div data-tour="dash-charts" className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="By Level (Severity)" subtitle="Click a slice to filter">
          {sevData.length ? (
            <ChartFrame label="Incidents by severity level" width="100%" height={224}>
              <PieChart>
                <Pie data={sevData} dataKey="value" nameKey="name" outerRadius={88} label={renderPieValue} labelLine={false} onClick={(d) => toggle('severity', d.key)} className="cursor-pointer">
                  {sevData.map((d) => <Cell key={d.key} fill={d.color} fillOpacity={segOpacity(filters.severity, d.key)} />)}
                </Pie>
                <Tooltip /><Legend iconType="circle" />
              </PieChart>
            </ChartFrame>
          ) : <Empty />}
        </ChartCard>

        <ChartCard title="By Type" subtitle="Click a slice to filter">
          {typeData.length ? (
            <ChartFrame label="Incidents by type" width="100%" height={224}>
              <PieChart>
                <Pie data={typeData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={88} paddingAngle={3} label={renderPieValue} labelLine={false} onClick={(d) => toggle('type', d.key)} className="cursor-pointer">
                  {typeData.map((d) => <Cell key={d.key} fill={d.color} fillOpacity={segOpacity(filters.type, d.key)} />)}
                </Pie>
                <Tooltip /><Legend iconType="circle" />
              </PieChart>
            </ChartFrame>
          ) : <Empty />}
        </ChartCard>

        <ChartCard title="Action Status" subtitle="Corrective & preventive actions">
          {actionData.length ? (
            <ChartFrame label="Corrective and preventive action status" width="100%" height={224}>
              <PieChart>
                <Pie data={actionData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={88} paddingAngle={3} label={renderPieValue} labelLine={false}>
                  {actionData.map((d) => <Cell key={d.key} fill={d.color} />)}
                </Pie>
                <Tooltip /><Legend iconType="circle" />
              </PieChart>
            </ChartFrame>
          ) : (
            <div className="flex h-52 flex-col items-center justify-center text-green-600"><CheckCircle2 size={36} /><p className="mt-2 font-bold">No open actions 🎉</p></div>
          )}
        </ChartCard>

        <ChartCard title="By HSE Category" subtitle="Click a bar to filter">
          {catData.length ? (
            <ChartFrame label="Incidents by HSE category" width="100%" height={Math.max(224, catData.length * 34)}>
              <BarChart data={catData} layout="vertical" margin={{ left: 8, right: 28 }}>
                <XAxis type="number" allowDecimals={false} hide />
                <YAxis type="category" dataKey="name" width={150} tickLine={false} axisLine={false} fontSize={11} tick={{ fill: '#1c2230' }} />
                <Tooltip cursor={{ fill: 'rgba(99,102,241,0.08)' }} />
                <Bar dataKey="value" radius={[0, 8, 8, 0]} onClick={(d) => toggle('category', d.key)} className="cursor-pointer">
                  {catData.map((d) => <Cell key={d.key} fill={d.color} fillOpacity={segOpacity(filters.category, d.key)} />)}
                  <LabelList dataKey="value" position="right" fontSize={13} fontWeight={800} fill="#1c2230" />
                </Bar>
              </BarChart>
            </ChartFrame>
          ) : <Empty />}
        </ChartCard>

        <ChartCard title="By Location" subtitle="Click a bar to filter">
          {locData.length ? (
            <ChartFrame label="Incidents by location" width="100%" height={224}>
              <BarChart data={locData} margin={{ top: 24, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={10} tick={{ fill: '#1c2230' }} interval={0} angle={-20} textAnchor="end" height={50} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} width={28} tick={{ fill: '#62718c' }} />
                <Tooltip cursor={{ fill: 'rgba(99,102,241,0.08)' }} />
                <Bar dataKey="value" radius={[8, 8, 0, 0]} onClick={(d) => toggle('location', d.key)} className="cursor-pointer">
                  {locData.map((d) => <Cell key={d.key} fill={d.color} fillOpacity={segOpacity(filters.location, d.key)} />)}
                  <LabelList dataKey="value" position="top" fontSize={12} fontWeight={800} fill="#1c2230" />
                </Bar>
              </BarChart>
            </ChartFrame>
          ) : <Empty />}
        </ChartCard>

        {/* Three states, and the third one is the point. Body parts come from
            /injuries and /illnesses, which are admin/manager only — so for a
            member or the external auditor this card has no data to draw. Drawing
            an empty body and captioning it "No injuries recorded" would report
            an absence that was never checked. */}
        <ChartCard
          title="Injury / Illness Body Map"
          subtitle={canReadHealth ? 'Heat = affected count · click to filter' : 'Restricted'}
        >
          {!canReadHealth ? (
            <div className="flex h-52 flex-col items-center justify-center px-6 text-center text-ink-400">
              <EyeOff size={34} />
              <p className="mt-2 font-bold text-ink-600">Not available to your role</p>
              <p className="mt-1 text-xs leading-relaxed">
                Injured body parts belong to a colleague&rsquo;s medical record and are readable by admins
                and managers only. This is not a count of zero.
              </p>
            </div>
          ) : Object.keys(bodyPartCounts).length ? (
            <BodyHeatmap counts={bodyCounts} onSelect={(key) => toggle('body', key)} height={260} />
          ) : (
            <div className="flex h-52 flex-col items-center justify-center text-ink-400"><ShieldCheck size={36} /><p className="mt-2 font-bold text-green-600">No injuries recorded</p></div>
          )}
        </ChartCard>
      </div>
    </div>
  )
}

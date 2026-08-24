import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, RadialBarChart, RadialBar, Legend, LabelList,
} from 'recharts'
import ChartFrame from '../../../shared/ui/ChartFrame'
import {
  LayoutDashboard, ShieldCheck, RefreshCw, Truck, Wrench, CheckCircle2, Boxes, Filter, X, Search, MapPin,
} from 'lucide-react'
import { PageHeader } from '../components/ui'
import { KpiSkeleton, ChartSkeleton, FilterBarSkeleton } from '../components/Skeleton'
import CountUp from '../../../shared/ui/CountUp'
import { useFleet } from '../context/FleetContext'
import {
  fleetSummary, isToBeRefilled, isInProcess, isPhysicalDefect, isRefilledClosed, deriveStatus,
} from '../lib/extinguisherLogic'
import {
  TYPES, CAPACITIES, ENTITIES, REGIONS, TYPE_COLORS, ENTITY_COLORS, ENTITY_FALLBACK_COLOR, REGION_COLORS,
  STATUS, STATUS_LABEL, STATUS_COLOR, CATEGORY_LIST, CATEGORIES,
} from '../lib/constants'
import { readableOnTint, solidBackground } from '../../../shared/lib/contrast'
import IncompleteNotice from '../../../shared/ui/IncompleteNotice'

// Dimensions we can cross-filter on. Each is a Set of selected values.
const DIMS = ['type', 'capacity', 'entity', 'region', 'status', 'category']
const emptyFilters = () => ({ type: new Set(), capacity: new Set(), entity: new Set(), region: new Set(), status: new Set(), category: new Set() })

const card = {
  hidden: { opacity: 0, y: 16 },
  show: (i) => ({ opacity: 1, y: 0, transition: { delay: i * 0.06 } }),
}

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
  return <div className="flex h-56 items-center justify-center text-sm text-ink-400">No data yet</div>
}

// Opacity for a chart segment given whether its dimension has an active selection.
function segOpacity(set, value) {
  if (!set || set.size === 0) return 1
  return set.has(value) ? 1 : 0.3
}

// Crisp white, bold value label placed inside each pie slice (clearly legible
// against the colored fills — the default recharts label is faint gray).
function renderPieValue({ cx, cy, midAngle, innerRadius, outerRadius, value }) {
  if (!value) return null
  const RAD = Math.PI / 180
  const r = innerRadius + (outerRadius - innerRadius) * 0.5
  const x = cx + r * Math.cos(-midAngle * RAD)
  const y = cy + r * Math.sin(-midAngle * RAD)
  return (
    <text x={x} y={y} fill="#fff" fontSize={14} fontWeight={800} textAnchor="middle" dominantBaseline="central">
      {value}
    </text>
  )
}

// Look up a display label + color for a chip.
const STATUS_VALUES = Object.values(STATUS)
function chipMeta(dim, value) {
  if (dim === 'type') return { label: value, color: TYPE_COLORS[value] || '#64748b' }
  if (dim === 'entity') return { label: value, color: ENTITY_COLORS[value] || ENTITY_FALLBACK_COLOR }
  if (dim === 'region') return { label: value, color: REGION_COLORS[value] || '#64748b' }
  if (dim === 'capacity') return { label: value, color: '#0891b2' }
  if (dim === 'status') return { label: STATUS_LABEL[value] || value, color: STATUS_COLOR[value] || '#64748b' }
  if (dim === 'category') {
    const c = CATEGORY_LIST.find((x) => x.key === value)
    return { label: c?.label || value, color: c?.color || '#64748b' }
  }
  return { label: value, color: '#64748b' }
}

export default function Dashboard() {
  const { extinguishers, incomplete, loading } = useFleet()
  const today = useMemo(() => new Date(), [])

  const [filters, setFilters] = useState(emptyFilters)
  const [search, setSearch] = useState('')

  // Toggle a value in a dimension's Set (Power-BI style click-to-filter).
  const toggle = (dim, value) => {
    setFilters((prev) => {
      const next = { ...prev, [dim]: new Set(prev[dim]) }
      next[dim].has(value) ? next[dim].delete(value) : next[dim].add(value)
      return next
    })
  }
  // Dropdown sets a single value (or clears) for a dimension.
  const setSingle = (dim, value) => {
    setFilters((prev) => ({ ...prev, [dim]: value ? new Set([value]) : new Set() }))
  }
  const clearAll = () => { setFilters(emptyFilters()); setSearch('') }

  const activeChips = DIMS.flatMap((dim) => Array.from(filters[dim]).map((value) => ({ dim, value })))
  const filtersActive = activeChips.length > 0 || search

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return extinguishers.filter((e) => {
      if (q && !(`${e.serialNo} ${e.centerName} ${e.type}`.toLowerCase().includes(q))) return false
      if (filters.type.size && !filters.type.has(e.type)) return false
      if (filters.capacity.size && !filters.capacity.has(e.capacity)) return false
      if (filters.entity.size && !filters.entity.has(e.entity)) return false
      if (filters.region.size && !filters.region.has(e.region)) return false
      if (filters.status.size && !filters.status.has(e.status)) return false
      if (filters.category.size) {
        const cats = new Set(deriveStatus(e, today).categories)
        // OR within the category dimension
        let any = false
        for (const c of filters.category) if (cats.has(c)) { any = true; break }
        if (!any) return false
      }
      return true
    })
  }, [extinguishers, search, filters, today])

  const summary = useMemo(() => fleetSummary(filtered, today), [filtered, today])
  const refillDue = useMemo(() => filtered.filter((e) => isToBeRefilled(e, today)), [filtered, today])
  const inProcess = useMemo(() => filtered.filter((e) => isInProcess(e)), [filtered])
  const physicalDefects = useMemo(() => filtered.filter((e) => isPhysicalDefect(e)), [filtered])
  const closed = useMemo(() => filtered.filter((e) => isRefilledClosed(e)), [filtered])
  // Distinct sites among the filtered extinguishers — responds to the active filters.
  const siteCount = useMemo(() => new Set(filtered.map((e) => e.centerName).filter(Boolean)).size, [filtered])

  const typeData = useMemo(
    () => TYPES.map((t) => ({ name: t, value: filtered.filter((e) => e.type === t).length, color: TYPE_COLORS[t] })).filter((d) => d.value > 0),
    [filtered]
  )
  const entityData = useMemo(
    () => ENTITIES.map((en) => ({ name: en, value: filtered.filter((e) => e.entity === en).length, color: ENTITY_COLORS[en] || ENTITY_FALLBACK_COLOR })),
    [filtered]
  )
  const regionData = useMemo(
    () => REGIONS.map((rg) => ({ name: rg, value: filtered.filter((e) => e.region === rg).length, color: REGION_COLORS[rg] })).filter((d) => d.value > 0),
    [filtered]
  )
  const statusData = useMemo(
    () => STATUS_VALUES.map((s) => ({ name: STATUS_LABEL[s], value: filtered.filter((e) => e.status === s).length, color: STATUS_COLOR[s], key: s })).filter((d) => d.value > 0),
    [filtered]
  )
  const categoryData = useMemo(
    () => CATEGORY_LIST.map((c) => ({ name: c.label, value: summary.categoryCounts[c.key] || 0, color: c.color, key: c.key }))
      .filter((d) => d.value > 0).sort((a, b) => b.value - a.value),
    [summary]
  )

  const healthPct = summary.total ? Math.round((summary.healthy / summary.total) * 100) : 0
  const healthRadial = [{ name: 'Healthy', value: healthPct, fill: '#16a34a' }]

  // KPI cards — clickable where they map to a filter dimension.
  const kpis = [
    { label: 'Total Extinguishers', value: summary.total, color: '#1c2230', icon: Boxes, onClick: clearAll },
    { label: 'Sites', value: siteCount, color: '#0d9488', icon: MapPin, to: '/equipment/signages' },
    { label: 'Healthy', value: summary.healthy, color: '#16a34a', icon: ShieldCheck, onClick: () => setSingle('category', CATEGORIES.HEALTHY.key) },
    { label: 'To Be Refilled', value: refillDue.length, color: '#f59e0b', icon: RefreshCw, to: '/equipment/refill-due' },
    { label: 'In Process', value: inProcess.length, color: '#6366f1', icon: Truck, onClick: () => setSingle('status', STATUS.IN_PROCESS_REFILLING) },
    { label: 'Physical Defects', value: physicalDefects.length, color: '#d97706', icon: Wrench, to: '/equipment/physical-open' },
    { label: 'Refilled & Closed', value: closed.length, color: '#0ea5e9', icon: CheckCircle2, to: '/equipment/closed' },
  ]

  if (loading) {
    return (
      <div>
        <PageHeader title="Dashboard" subtitle="Click any chart segment to filter. Selections stack across charts." icon={LayoutDashboard} />
        <FilterBarSkeleton />
        <KpiSkeleton count={7} />
        <ChartSkeleton />
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Click any chart segment to filter. Selections stack across charts." icon={LayoutDashboard} />

      {/* Replaces a banner that named extinguishers only, while the AED, FAS,
          signage and drill figures on this same page were being truncated
          silently beside it. */}
      <IncompleteNotice incomplete={incomplete} className="mb-4" />

      {/* Filter bar (dropdowns mirror the same Sets) */}
      <div className="card mb-4 flex flex-wrap items-center gap-3 p-4">
        <span className="flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-ink-400">
          <Filter size={13} /> Filters
        </span>
        <div className="relative min-w-[200px] flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input className="input pl-9" placeholder="Search serial, center, type…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="input w-auto" value={filters.region.size === 1 ? [...filters.region][0] : ''} onChange={(e) => setSingle('region', e.target.value)}>
          <option value="">All regions</option>
          {REGIONS.map((rg) => <option key={rg}>{rg}</option>)}
        </select>
        <select className="input w-auto" value={filters.type.size === 1 ? [...filters.type][0] : ''} onChange={(e) => setSingle('type', e.target.value)}>
          <option value="">All types</option>
          {TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select className="input w-auto" value={filters.capacity.size === 1 ? [...filters.capacity][0] : ''} onChange={(e) => setSingle('capacity', e.target.value)}>
          <option value="">All capacities</option>
          {CAPACITIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select className="input w-auto" value={filters.entity.size === 1 ? [...filters.entity][0] : ''} onChange={(e) => setSingle('entity', e.target.value)}>
          <option value="">All entities</option>
          {ENTITIES.map((en) => <option key={en}>{en}</option>)}
        </select>
      </div>

      {/* Active filter chips */}
      {filtersActive && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-ink-400">Active:</span>
          {search && (
            <button className="chip bg-clay-100 text-ink-600" onClick={() => setSearch('')}>
              “{search}” <X size={12} />
            </button>
          )}
          {activeChips.map(({ dim, value }) => {
            const m = chipMeta(dim, value)
            return (
              <button key={`${dim}:${value}`} className="chip" style={{ backgroundColor: solidBackground(m.color), color: '#fff' }} onClick={() => toggle(dim, value)}>
                {m.label} <X size={12} />
              </button>
            )
          })}
          <button className="btn-ghost px-2.5 py-1 text-xs" onClick={clearAll}>Clear all</button>
        </motion.div>
      )}

      {/* KPI cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-7">
        {kpis.map((k, i) => {
          const inner = (
            <>
              <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-10 transition group-hover:scale-150" style={{ backgroundColor: k.color }} />
              <div className="mb-3 grid h-11 w-11 place-items-center rounded-xl text-white" style={{ backgroundColor: k.color }}>
                <k.icon size={20} />
              </div>
              <p className="text-3xl font-black text-ink-900"><CountUp value={k.value} /></p>
              <p className="text-sm font-medium text-ink-500">{k.label}</p>
            </>
          )
          const cls = 'card group relative block w-full overflow-hidden p-5 text-left transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-glow active:scale-[0.99]'
          return (
            <motion.div key={k.label} variants={card} custom={i} initial="hidden" animate="show">
              {k.to ? (
                <Link to={k.to} className={cls}>{inner}</Link>
              ) : (
                <button className={cls} onClick={k.onClick}>{inner}</button>
              )}
            </motion.div>
          )
        })}
      </div>

      {/* Color-coded condition legend — click to toggle the category filter */}
      <ChartCard title="Condition legend" subtitle="Click a condition to filter the dashboard" className="mb-4">
        <div className="flex flex-wrap gap-2">
          {CATEGORY_LIST.map((c) => {
            const count = summary.categoryCounts[c.key] || 0
            const on = filters.category.has(c.key)
            return (
              <button
                key={c.key}
                onClick={() => toggle('category', c.key)}
                className="chip transition hover:scale-105"
                style={on ? { backgroundColor: solidBackground(c.color), color: '#fff' } : { backgroundColor: `${c.color}1a`, color: readableOnTint(c.color) }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: on ? '#fff' : c.color }} />
                {c.label}
                <span className="ml-1 rounded-full bg-white/70 px-1.5 text-[10px] font-bold text-ink-700">{count}</span>
              </button>
            )
          })}
        </div>
      </ChartCard>

      {/* Charts grid */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Fleet health gauge */}
        <ChartCard title="Fleet Health" subtitle="Share of healthy extinguishers">
          <div className="relative h-56">
            <ChartFrame label="Fleet health: share of healthy extinguishers" width="100%" height="100%">
              <RadialBarChart innerRadius="70%" outerRadius="100%" data={healthRadial} startAngle={90} endAngle={-270}>
                <RadialBar background={{ fill: '#efe0d7' }} dataKey="value" cornerRadius={20} />
              </RadialBarChart>
            </ChartFrame>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-4xl font-black text-green-600"><CountUp value={healthPct} />%</span>
              <span className="text-xs text-ink-400">{summary.healthy} of {summary.total} healthy</span>
            </div>
          </div>
        </ChartCard>

        {/* By type donut */}
        <ChartCard title="By Type" subtitle="Click a slice to filter">
          {typeData.length ? (
            <ChartFrame label="Extinguishers by type" width="100%" height={224}>
              <PieChart>
                <Pie data={typeData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={88} paddingAngle={3}
                  label={renderPieValue} labelLine={false} onClick={(d) => toggle('type', d.name)} className="cursor-pointer">
                  {typeData.map((d) => <Cell key={d.name} fill={d.color} fillOpacity={segOpacity(filters.type, d.name)} />)}
                </Pie>
                <Tooltip />
                <Legend iconType="circle" />
              </PieChart>
            </ChartFrame>
          ) : <Empty />}
        </ChartCard>

        {/* By Region donut */}
        <ChartCard title="By Region" subtitle="Click a slice to filter">
          {regionData.length ? (
            <ChartFrame label="Extinguishers by region" width="100%" height={224}>
              <PieChart>
                <Pie data={regionData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={88} paddingAngle={3}
                  label={renderPieValue} labelLine={false} onClick={(d) => toggle('region', d.name)} className="cursor-pointer">
                  {regionData.map((d) => <Cell key={d.name} fill={d.color} fillOpacity={segOpacity(filters.region, d.name)} />)}
                </Pie>
                <Tooltip />
                <Legend iconType="circle" />
              </PieChart>
            </ChartFrame>
          ) : <Empty />}
        </ChartCard>

        {/* By entity bar */}
        <ChartCard title="By Entity" subtitle="Click a bar to filter">
          <ChartFrame label="Extinguishers by entity" width="100%" height={224}>
            <BarChart data={entityData} margin={{ top: 24, right: 8, left: 0, bottom: 0 }}>
              <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} tick={{ fill: '#1c2230' }} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} width={28} tick={{ fill: '#62718c' }} />
              <Tooltip cursor={{ fill: 'rgba(227,204,191,0.35)' }} />
              <Bar dataKey="value" radius={[8, 8, 0, 0]} onClick={(d) => toggle('entity', d.name)} className="cursor-pointer">
                {entityData.map((d) => <Cell key={d.name} fill={d.color} fillOpacity={segOpacity(filters.entity, d.name)} />)}
                <LabelList dataKey="value" position="top" fontSize={13} fontWeight={800} fill="#1c2230" />
              </Bar>
            </BarChart>
          </ChartFrame>
        </ChartCard>

        {/* Status breakdown */}
        <ChartCard title="Lifecycle Status" subtitle="Click a slice to filter">
          {statusData.length ? (
            <ChartFrame label="Extinguishers by lifecycle status" width="100%" height={224}>
              <PieChart>
                <Pie data={statusData} dataKey="value" nameKey="name" outerRadius={88}
                  label={renderPieValue} labelLine={false} onClick={(d) => toggle('status', d.key)} className="cursor-pointer">
                  {statusData.map((d) => <Cell key={d.key} fill={d.color} fillOpacity={segOpacity(filters.status, d.key)} />)}
                </Pie>
                <Tooltip />
                <Legend iconType="circle" />
              </PieChart>
            </ChartFrame>
          ) : <Empty />}
        </ChartCard>

        {/* Defect / due distribution */}
        <ChartCard title="Conditions & Due Items" subtitle="Click a bar to filter">
          {categoryData.length ? (
            <ChartFrame label="Extinguisher conditions and due items" width="100%" height={224}>
              <BarChart data={categoryData} layout="vertical" margin={{ left: 8, right: 28 }}>
                <XAxis type="number" allowDecimals={false} hide />
                <YAxis type="category" dataKey="name" width={130} tickLine={false} axisLine={false} fontSize={11} tick={{ fill: '#1c2230' }} />
                <Tooltip cursor={{ fill: 'rgba(227,204,191,0.35)' }} />
                <Bar dataKey="value" radius={[0, 8, 8, 0]} onClick={(d) => toggle('category', d.key)} className="cursor-pointer">
                  {categoryData.map((d) => <Cell key={d.key} fill={d.color} fillOpacity={segOpacity(filters.category, d.key)} />)}
                  <LabelList dataKey="value" position="right" fontSize={13} fontWeight={800} fill="#1c2230" />
                </Bar>
              </BarChart>
            </ChartFrame>
          ) : (
            <div className="flex h-56 flex-col items-center justify-center text-green-600">
              <ShieldCheck size={40} />
              <p className="mt-2 font-bold">No defects or due items 🎉</p>
            </div>
          )}
        </ChartCard>
      </div>
    </div>
  )
}

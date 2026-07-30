// ─────────────────────────────────────────────────────────────────────────────
// Analytics → Incidents.
//
// Five headline counts, the pipeline, and the same population sliced four ways
// — category, region, entity, site — plus a month-by-month trend. Every panel
// reads the one filtered set, so nothing on screen can disagree with anything
// else on screen.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, Cell,
  PieChart, Pie,
} from 'recharts'
import { AlertTriangle, Flame, HeartPulse, Clock, ShieldAlert } from 'lucide-react'
import { INCIDENT_TYPE_BY_KEY } from '../../modules/incidents/lib/constants'
import { Panel, Stat, NoData, Picker } from './ui'
import { incidentAnalytics, resolveIncidents, facets } from './incidentAnalytics'

const TREND_TYPES = [
  { key: 'near_miss', label: 'Near miss' },
  { key: 'first_aid', label: 'First aid' },
  { key: 'lost_time', label: 'Lost time' },
  { key: 'reportable', label: 'Reportable' },
  { key: 'property_damage', label: 'Property damage' },
]

const axis = { tickLine: false, axisLine: false, fontSize: 11, tick: { fill: '#8a7660' } }

export default function IncidentsTab({ incidents, sites }) {
  const [f, setF] = useState({ siteId: 'all', region: 'all', entity: 'all', from: '', to: '' })
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }))

  // Facets come from every visible incident, not the filtered set — options
  // that vanish as you use them make a filter bar impossible to reason about.
  const all = useMemo(() => resolveIncidents(incidents, sites), [incidents, sites])
  const opts = useMemo(() => facets(all), [all])
  const a = useMemo(() => incidentAnalytics(incidents, sites, f), [incidents, sites, f])

  const h = a.headline
  const HEAD = [
    { key: 'near', icon: ShieldAlert, label: 'Near misses', value: h.nearMiss, tone: '#0ea5e9' },
    { key: 'fa', icon: HeartPulse, label: 'First aid', value: h.firstAid, tone: '#22c55e' },
    { key: 'lt', icon: Clock, label: 'Lost time', value: h.lostTime, tone: '#f59e0b' },
    { key: 'rep', icon: AlertTriangle, label: 'Reportable', value: h.reportable, tone: '#ef4444' },
    { key: 'fire', icon: Flame, label: 'Fire incidents', value: h.fire, tone: '#dc2626', sub: 'by category' },
  ]

  return (
    <div className="animate-fade-in-up">
      <div className="card mb-5 flex flex-wrap items-end gap-3 p-4">
        <Picker id="an-site" label="Site" value={f.siteId} onChange={set('siteId')}>
          <option value="all">All sites ({sites.length})</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Picker>
        <Picker id="an-region" label="Region" value={f.region} onChange={set('region')}>
          <option value="all">All regions</option>
          {opts.regions.map((r) => <option key={r} value={r}>{r}</option>)}
        </Picker>
        <Picker id="an-entity" label="Entity" value={f.entity} onChange={set('entity')}>
          <option value="all">All entities</option>
          {opts.entities.map((r) => <option key={r} value={r}>{r}</option>)}
        </Picker>
        <Picker id="an-from" label="From" value={f.from} onChange={set('from')}>
          <option value="">Earliest</option>
          {opts.months.map((m) => <option key={m} value={m}>{m}</option>)}
        </Picker>
        <Picker id="an-to" label="To" value={f.to} onChange={set('to')}>
          <option value="">Latest</option>
          {opts.months.map((m) => <option key={m} value={m}>{m}</option>)}
        </Picker>
        <button
          type="button"
          onClick={() => setF({ siteId: 'all', region: 'all', entity: 'all', from: '', to: '' })}
          className="rounded-2xl bg-clay-surface px-4 py-2.5 text-[12.5px] font-semibold text-ink-700 shadow-clay-sm"
        >
          Reset
        </button>
      </div>

      <div className="mb-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {HEAD.map((k) => <Stat key={k.key} {...k} />)}
      </div>
      {/* Both caveats are real and both mislead if left unsaid: the five figures
          neither partition the population nor cover it. */}
      <p className="mb-5 text-[11.5px] leading-relaxed text-ink-400">
        {h.total} incident{h.total === 1 ? '' : 's'} in scope. Fire is a category rather than an injury type,
        so a fire that caused an injury appears in both its type and the fire count. Property damage and
        unclassified incidents have no tile of their own, so these five need not add up to the total —
        the breakdowns below cover every incident in scope.
      </p>

      <div className="mb-5 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Panel title="Monthly trend" subtitle="By incident type">
          {a.byMonth.length === 0 ? (
            <NoData>No dated incidents in this scope.</NoData>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={a.byMonth} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <XAxis dataKey="label" {...axis} />
                <YAxis allowDecimals={false} {...axis} />
                <Tooltip cursor={{ fill: 'rgba(227,204,191,0.35)' }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                {TREND_TYPES.map((t) => (
                  <Bar
                    key={t.key} dataKey={t.key} name={t.label} stackId="t"
                    fill={INCIDENT_TYPE_BY_KEY[t.key]?.color || '#8a7660'}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <Panel title="Status" subtitle="Where each incident sits in the pipeline">
          {a.byStatus.length === 0 ? (
            <NoData>Nothing to show.</NoData>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={a.byStatus} dataKey="value" nameKey="name" outerRadius={88} innerRadius={50} paddingAngle={2}>
                  {a.byStatus.map((d) => <Cell key={d.key} fill={d.color} />)}
                </Pie>
                <Tooltip />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Breakdown title="By category" subtitle="Kind of accident" rows={a.byCategory} />
        <Breakdown title="By site" subtitle="Where it happened" rows={a.bySite} />
        <Breakdown title="By region" rows={a.byRegion} />
        <Breakdown title="By entity" rows={a.byEntity} />
      </div>
    </div>
  )
}

/**
 * A horizontal bar list. Long labels — "Struck by Moving / Falling Object", full
 * site names — are unreadable rotated under a vertical axis, so these lay the
 * bars on their side and give the label real room.
 */
function Breakdown({ title, subtitle, rows }) {
  const height = Math.max(160, rows.length * 34 + 24)
  return (
    <Panel title={title} subtitle={subtitle}>
      {rows.length === 0 ? (
        <NoData height={160}>Nothing recorded in this scope.</NoData>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 28, left: 0, bottom: 0 }}>
            <XAxis type="number" allowDecimals={false} hide />
            <YAxis
              type="category" dataKey="name" width={150} {...axis}
              tickFormatter={(v) => (String(v).length > 22 ? `${String(v).slice(0, 21)}…` : v)}
            />
            <Tooltip cursor={{ fill: 'rgba(227,204,191,0.35)' }} />
            <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={18}>
              {rows.map((d) => <Cell key={d.key} fill={d.color || '#c74a33'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </Panel>
  )
}

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
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, Cell, PieChart, Pie,
} from 'recharts'
import ChartFrame from '../../shared/ui/ChartFrame'
import { AlertTriangle, Flame, HeartPulse, Clock, ShieldAlert } from 'lucide-react'
import { INCIDENT_TYPE_BY_KEY } from '../../modules/incidents/lib/constants'
import { Panel, Stat, NoData } from './ui'
import { incidentAnalytics, resolveIncidents, facets } from './incidentAnalytics'
import Breakdown from './Breakdown'
import FilterBar from './FilterBar'

const TREND_TYPES = [
  { key: 'near_miss', label: 'Near miss' },
  { key: 'first_aid', label: 'First aid' },
  { key: 'lost_time', label: 'Lost time' },
  { key: 'reportable', label: 'Reportable' },
  { key: 'property_damage', label: 'Property damage' },
]

const axis = { tickLine: false, axisLine: false, fontSize: 11, tick: { fill: '#8a7660' } }

export default function IncidentsTab({ incidents, sites, keepUnplaced = true }) {
  const [f, setF] = useState({ siteId: 'all', region: 'all', entity: 'all', from: '', to: '' })

  // Facets come from every visible incident, not the filtered set — options
  // that vanish as you use them make a filter bar impossible to reason about.
  const all = useMemo(() => resolveIncidents(incidents, sites, { keepUnplaced }), [incidents, sites, keepUnplaced])
  const opts = useMemo(() => facets(all), [all])
  const a = useMemo(() => incidentAnalytics(incidents, sites, f, { keepUnplaced }), [incidents, sites, f, keepUnplaced])

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
      <FilterBar f={f} setF={setF} sites={sites} opts={opts} idPrefix="an" />

      <div className="mb-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {HEAD.map(({ key, ...s }) => <Stat key={key} {...s} />)}
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
            <ChartFrame width="100%" height={260}>
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
            </ChartFrame>
          )}
        </Panel>

        <Panel title="Status" subtitle="Where each incident sits in the pipeline">
          {a.byStatus.length === 0 ? (
            <NoData>Nothing to show.</NoData>
          ) : (
            <ChartFrame width="100%" height={260}>
              <PieChart>
                <Pie data={a.byStatus} dataKey="value" nameKey="name" outerRadius={88} innerRadius={50} paddingAngle={2}>
                  {a.byStatus.map((d) => <Cell key={d.key} fill={d.color} />)}
                </Pie>
                <Tooltip />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ChartFrame>
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


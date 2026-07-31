import { useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, Cell, PieChart, Pie,
} from 'recharts'
import { Siren, ClipboardList, AlertTriangle, ListChecks } from 'lucide-react'
import { Panel, Stat, NoData } from './ui'
import { drillAnalytics, attachSites, facetsOf } from './moduleAnalytics'
import Breakdown from './Breakdown'
import FilterBar from './FilterBar'

const axis = { tickLine: false, axisLine: false, fontSize: 11, tick: { fill: '#8a7660' } }

export default function DrillsTab({ drills, sites, keepUnplaced = true }) {
  const [f, setF] = useState({ siteId: 'all', region: 'all', entity: 'all', from: '', to: '' })
  const all = useMemo(() => attachSites(drills, sites, { keepUnplaced }), [drills, sites, keepUnplaced])
  const opts = useMemo(() => facetsOf(all), [all])
  const a = useMemo(() => drillAnalytics(drills, sites, f, { keepUnplaced }), [drills, sites, f, keepUnplaced])

  return (
    <div className="animate-fade-in-up">
      <FilterBar f={f} setF={setF} sites={sites} opts={opts} />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Siren} label="Mock drills" value={a.drills} tone="#0ea5e9" />
        <Stat icon={AlertTriangle} label="Real emergencies" value={a.emergencies} tone="#dc2626" sub="same records, counted apart" />
        <Stat icon={ListChecks} label="Observations" value={a.observationTotal} tone="#f59e0b" />
        <Stat
          icon={ClipboardList}
          label="Still open"
          value={a.observations.filter((s) => s.key !== 'Closed').reduce((n, s) => n + s.value, 0)}
          tone="#a855f7"
        />
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Panel title="Drills over time" subtitle="Drills and real emergencies by month">
          {a.byMonth.length === 0 ? <NoData>No dated drills in this scope.</NoData> : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={a.byMonth} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <XAxis dataKey="label" {...axis} />
                <YAxis allowDecimals={false} {...axis} />
                <Tooltip cursor={{ fill: 'rgba(227,204,191,0.35)' }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="drills" name="Mock drills" stackId="d" fill="#0ea5e9" />
                <Bar dataKey="emergencies" name="Real emergencies" stackId="d" fill="#dc2626" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <Panel title="Observations" subtitle="Across every drill in scope">
          {a.observationTotal === 0 ? <NoData>No observations raised.</NoData> : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={a.observations.filter((s) => s.value > 0)} dataKey="value" nameKey="name" outerRadius={88} innerRadius={50} paddingAngle={2}>
                  {a.observations.filter((s) => s.value > 0).map((d) => <Cell key={d.key} fill={d.color} />)}
                </Pie>
                <Tooltip />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Panel>
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Breakdown title="Type of drill" subtitle="Scenario rehearsed" rows={a.byScenario} />
        <Breakdown title="Outcome" rows={a.byOutcome} />
        <Breakdown title="By site" rows={a.bySite} />
        <Breakdown title="By region" rows={a.byRegion} />
        <Breakdown title="By entity" rows={a.byEntity} />
        <Panel title="Observations per drill" subtitle="Most follow-up first">
          {a.perDrill.length === 0 ? <NoData height={160}>No drill raised an observation.</NoData> : (
            <ul className="flex flex-col gap-2">
              {a.perDrill.slice(0, 8).map((d) => (
                <li key={d.key} className="flex items-center gap-3 rounded-[14px] bg-clay-50 px-3.5 py-2.5 shadow-clay-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-ink-900">{d.name}</span>
                    <span className="block truncate text-[11px] text-ink-400">{d.site}</span>
                  </span>
                  <span className="flex-none rounded-full bg-clay-100 px-2.5 py-1 text-[10.5px] font-bold text-ink-600">
                    {d.value} obs
                  </span>
                  {d.open > 0 && (
                    <span className="flex-none rounded-full bg-red-100 px-2.5 py-1 text-[10.5px] font-bold text-red-700">
                      {d.open} open
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  )
}

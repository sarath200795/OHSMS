import { useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, Cell, PieChart, Pie,
} from 'recharts'
import ChartFrame from '../../shared/ui/ChartFrame'
import { Users, ListChecks, CircleCheck, CircleAlert } from 'lucide-react'
import { Panel, Stat, NoData } from './ui'
import { committeeAnalytics, attachSites, facetsOf } from './moduleAnalytics'
import Breakdown from './Breakdown'
import FilterBar from './FilterBar'

const axis = { tickLine: false, axisLine: false, fontSize: 11, tick: { fill: '#8a7660' } }

export default function CommitteeTab({ consultations, sites, keepUnplaced = true }) {
  const [f, setF] = useState({ siteId: 'all', region: 'all', entity: 'all', from: '', to: '' })
  const all = useMemo(() => attachSites(consultations, sites, { keepUnplaced }), [consultations, sites, keepUnplaced])
  const opts = useMemo(() => facetsOf(all), [all])
  const a = useMemo(() => committeeAnalytics(consultations, sites, f, { keepUnplaced }), [consultations, sites, f, keepUnplaced])

  const open = a.observations.find((s) => s.key === 'Open')?.value || 0
  const closed = a.observations.find((s) => s.key === 'Closed')?.value || 0

  return (
    <div className="animate-fade-in-up">
      <FilterBar f={f} setF={setF} sites={sites} opts={opts} idPrefix="cm" />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Users} label="Meetings" value={a.total} tone="#0ea5e9" />
        <Stat icon={ListChecks} label="Observations" value={a.actionTotal} tone="#f59e0b" />
        <Stat icon={CircleAlert} label="Open" value={open} tone="#ef4444" />
        <Stat icon={CircleCheck} label="Closed" value={closed} tone="#22c55e" />
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Panel title="Meetings per month" subtitle="With observations raised, by status">
          {a.byMonth.length === 0 ? <NoData>No dated meetings in this scope.</NoData> : (
            <ChartFrame width="100%" height={260}>
              <BarChart data={a.byMonth} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <XAxis dataKey="label" {...axis} />
                <YAxis allowDecimals={false} {...axis} />
                <Tooltip cursor={{ fill: 'rgba(227,204,191,0.35)' }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="meetings" name="Meetings" fill="#0ea5e9" radius={[6, 6, 0, 0]} />
                <Bar dataKey="Open" name="Open" stackId="o" fill="#ef4444" />
                <Bar dataKey="In Progress" name="In Progress" stackId="o" fill="#f59e0b" />
                <Bar dataKey="Closed" name="Closed" stackId="o" fill="#22c55e" />
              </BarChart>
            </ChartFrame>
          )}
        </Panel>

        <Panel title="Observations" subtitle="Across every meeting in scope">
          {a.actionTotal === 0 ? <NoData>No observations raised.</NoData> : (
            <ChartFrame width="100%" height={260}>
              <PieChart>
                <Pie data={a.observations.filter((s) => s.value > 0)} dataKey="value" nameKey="name" outerRadius={88} innerRadius={50} paddingAngle={2}>
                  {a.observations.filter((s) => s.value > 0).map((d) => <Cell key={d.key} fill={d.color} />)}
                </Pie>
                <Tooltip />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ChartFrame>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Breakdown title="By meeting type" rows={a.byType} />
        <Breakdown title="By site" rows={a.bySite} />
      </div>
    </div>
  )
}

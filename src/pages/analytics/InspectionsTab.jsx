import { useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Cell,
} from 'recharts'
import ChartFrame from '../../shared/ui/ChartFrame'
import { ClipboardCheck, ListChecks, CircleAlert, Gauge } from 'lucide-react'
import { Panel, Stat, NoData, Picker } from './ui'
import { attachSites, facetsOf } from './moduleAnalytics'
import {
  filterRecords, checklistOptions, byCategory, actionProgress, summary, recordMonth,
} from './inspectionAnalytics'
import FilterBar from './FilterBar'

const axis = { tickLine: false, axisLine: false, fontSize: 11, tick: { fill: '#8a7660' } }

// Warm through red as the failure rate climbs, so a category that fails most of
// what it checks reads differently from one that fails occasionally — the count
// alone cannot say that.
const heat = (rate) => (rate >= 50 ? '#ef4444' : rate >= 25 ? '#f59e0b' : '#0ea5e9')

const todayISO = () => new Date().toISOString().slice(0, 10)

export default function InspectionsTab({ records = [], sites = [], keepUnplaced = true }) {
  const [f, setF] = useState({ siteId: 'all', region: 'all', entity: 'all', from: '', to: '', templateId: 'all' })

  // attachSites resolves a record to a site (by id, else by name) and drops
  // rows belonging to sites this viewer cannot see. Its `month` is keyed off
  // `date`, which an inspection record does not have — it carries completedAt —
  // so the month is recomputed here rather than silently coming back empty and
  // leaving the From/To pickers with nothing to offer.
  const placed = useMemo(() => attachSites(records, sites, { keepUnplaced }), [records, sites, keepUnplaced])
  const rows = useMemo(() => placed.map((p) => ({ ...p, month: recordMonth(p.row) })), [placed])
  const opts = useMemo(() => facetsOf(rows), [rows])

  // Region and entity narrow which SITES count, so they are applied on the
  // resolved wrapper; site, date and checklist are properties of the record
  // itself and go through the tested filter.
  const scoped = useMemo(() => {
    const inScope = rows.filter((p) =>
      (f.region === 'all' || p.region === f.region)
      && (f.entity === 'all' || p.entity === f.entity))
    return filterRecords(inScope.map((p) => ({ ...p.row, siteId: p.siteId || p.row.siteId })), f)
  }, [rows, f])

  // Checklists come from everything in view, not from the filtered set: options
  // that vanish as you use them leave no way back to a wider view.
  const checklists = useMemo(() => checklistOptions(rows.map((p) => p.row)), [rows])

  const s = useMemo(() => summary(scoped), [scoped])
  const cats = useMemo(() => byCategory(scoped), [scoped])
  const actions = useMemo(() => actionProgress(scoped, todayISO()), [scoped])

  return (
    <div className="animate-fade-in-up">
      <FilterBar f={f} setF={setF} sites={sites} opts={opts} idPrefix="ins" />

      <div className="card mb-5 flex flex-wrap items-end gap-3 p-4">
        <Picker
          id="ins-checklist"
          label="Checklist"
          value={f.templateId}
          onChange={(e) => setF((p) => ({ ...p, templateId: e.target.value }))}
        >
          <option value="all">All checklists ({checklists.length})</option>
          {checklists.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </Picker>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={ClipboardCheck} label="Inspections" value={s.inspections} tone="#0ea5e9" />
        <Stat icon={ListChecks} label="Checks completed" value={s.checks} tone="#8b5cf6" />
        <Stat icon={CircleAlert} label="Observations" value={s.observations} tone="#ef4444"
          sub={s.checks ? `${Math.round((s.observations / s.checks) * 100)}% of checks` : undefined} />
        <Stat icon={Gauge} label="Average score" value={s.avgScore == null ? '—' : `${s.avgScore}%`} tone="#22c55e" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Observations by category"
          subtitle="Failed checks, grouped by the category their question was filed under"
        >
          {cats.length === 0 ? (
            <NoData>No completed checks in this range.</NoData>
          ) : (
            <ChartFrame width="100%" height={Math.max(240, cats.length * 42)}>
              <BarChart data={cats} layout="vertical" margin={{ left: 8, right: 24 }}>
                <XAxis type="number" allowDecimals={false} {...axis} />
                <YAxis type="category" dataKey="category" width={120} {...axis} />
                <Tooltip
                  cursor={{ fill: 'rgba(178,148,112,0.12)' }}
                  formatter={(v, _n, item) => [
                    `${v} of ${item.payload.checks} checks (${item.payload.failRate}%)`,
                    'Observations',
                  ]}
                />
                <Bar dataKey="observations" radius={[0, 6, 6, 0]}>
                  {cats.map((c) => <Cell key={c.category} fill={heat(c.failRate)} />)}
                </Bar>
              </BarChart>
            </ChartFrame>
          )}
        </Panel>

        <Panel
          title="Actions from inspections"
          subtitle="Every failed check opens one — this is what happened next"
        >
          {actions.total === 0 ? (
            <NoData>Nothing failed in this range.</NoData>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="mb-1.5 flex items-baseline justify-between">
                  <span className="text-xs font-bold text-ink-700">{actions.completion}% closed</span>
                  <span className="text-[11px] text-ink-400">{actions.done} of {actions.total}</span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-clay-200">
                  <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${actions.completion}%` }} />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <Tally label="Open" value={actions.open} tone="text-red-600" />
                <Tally label="In progress" value={actions.inProgress} tone="text-amber-600" />
                <Tally label="Closed" value={actions.done} tone="text-emerald-600" />
              </div>

              {/* Only shown when non-zero. A row of zeroes trains people to skip
                  the panel, and these two are the ones worth interrupting for. */}
              {(actions.overdue > 0 || actions.unassigned > 0) && (
                <div className="space-y-1.5 rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-900">
                  {actions.overdue > 0 && (
                    <p>{actions.overdue} still open past its due date</p>
                  )}
                  {actions.unassigned > 0 && (
                    <p>{actions.unassigned} open with nobody named</p>
                  )}
                </div>
              )}
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}

function Tally({ label, value, tone }) {
  return (
    <div className="rounded-xl bg-clay-surface py-3 shadow-clay-inset">
      <p className={`text-xl font-black ${tone}`}>{value}</p>
      <p className="mt-0.5 text-[11px] font-semibold text-ink-500">{label}</p>
    </div>
  )
}

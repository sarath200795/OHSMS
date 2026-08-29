// ─────────────────────────────────────────────────────────────────────────────
// Analytics → ODIN.
//
// The Safety & Security picture as the warehouse sees it: where the issues are,
// what state they are in by region, what kind of finding they are, and whether
// the sites that failed an audit had fixed anything a week later.
//
// It is the only tab that does not read Firestore. The rows come from Metabase
// through a callable, because the API key that fetches them is a bearer
// credential for an entire analytics warehouse and must never reach a browser —
// see functions/lib/metabase.js. That has two consequences visible here: the
// data is FETCHED rather than subscribed, so there is a refresh button and a
// timestamp saying how old the numbers are; and every failure mode is a
// different screen, because "nobody has connected Metabase" and "the audits
// question was deleted" need different people to do different things.
//
// The site map joins on this app's own site register for coordinates, so an
// organization does not have to add latitude and longitude columns to their
// warehouse to get a map out of it.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, Cell, PieChart, Pie, LabelList,
} from 'recharts'
import { MapContainer, TileLayer, Marker, Tooltip as LeafletTooltip } from 'react-leaflet'
import L from 'leaflet'
import {
  RefreshCw, ShieldAlert, MapPinOff, Radar, AlertTriangle, Plug, Loader2,
  CircleCheck, CircleX, SlidersHorizontal, X,
} from 'lucide-react'
import ChartFrame from '../../shared/ui/ChartFrame'
import { metabaseQuery } from '../../shared/functions'
import MetabaseConnect from '../../shared/integrations/MetabaseConnect'
import { Panel, Stat, NoData, Picker } from './ui'
import {
  odinAnalytics, odinFacets, resolveOdinRows, STATUS_META, STATUS_BY_KEY, leadStatus,
} from './odinAnalytics'

const axis = { tickLine: false, axisLine: false, fontSize: 11, tick: { fill: '#8a7660' } }

const EMPTY_FILTER = { region: 'all', entity: 'all', status: 'all', subCategory: 'all', source: 'all', from: '', to: '' }

/**
 * One pin per site. Size carries the count, the ring carries the status mix,
 * and the number in the middle takes the colour of the worst status present —
 * the same grammar the CCTV and equipment maps use, so a reader who has learned
 * one map has learned all three.
 */
const pinCache = new Map()
function issuePin(pin) {
  const size = pin.total >= 10 ? 42 : pin.total >= 4 ? 36 : 30
  const key = `${size}:${STATUS_META.map((s) => pin.byStatus[s.key]).join('-')}`
  if (!pinCache.has(key)) {
    let at = 0
    const stops = []
    for (const s of STATUS_META) {
      const n = pin.byStatus[s.key] || 0
      if (!n) continue
      const to = at + (n / pin.total) * 100
      stops.push(`${s.color} ${at.toFixed(1)}% ${to.toFixed(1)}%`)
      at = to
    }
    const lead = STATUS_BY_KEY[leadStatus(pin.byStatus)]?.color || '#57534e'
    const inner = size - 11
    pinCache.set(
      key,
      L.divIcon({
        className: '',
        html: `<div style="transform:translate(-50%,-50%);display:grid;place-items:center;width:${size}px;height:${size}px;border-radius:50%;background:conic-gradient(${stops.join(',')});box-shadow:0 3px 10px rgba(16,24,40,.35)"><span style="display:grid;place-items:center;width:${inner}px;height:${inner}px;border-radius:50%;background:#fff;color:${lead};font:800 ${Math.round(inner / 2.1)}px Inter,sans-serif">${pin.total}</span></div>`,
        iconSize: [size, size],
      })
    )
  }
  return pinCache.get(key)
}

export default function OdinTab({ sites = [], orgId, actor, isAdmin = false, keepUnplaced = true }) {
  const [f, setF] = useState(EMPTY_FILTER)
  const [loading, setLoading] = useState(true)
  const [findings, setFindings] = useState(null)  // { ok, rows, … } as returned
  const [audits, setAudits] = useState(null)
  const [error, setError] = useState('')
  // The connection form, offered inline. An admin looking at an empty dashboard
  // should be able to connect it from where they are standing rather than being
  // sent to another screen and back — see shared/integrations/MetabaseConnect.
  const [connecting, setConnecting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      // Both at once. The audits question is optional and its absence is a
      // panel-level message, not a page-level failure, so a rejection from
      // either must not take the other's data off the screen.
      const [fRes, aRes] = await Promise.all([metabaseQuery('findings'), metabaseQuery('audits')])
      setFindings(fRes)
      setAudits(aRes)
    } catch (e) {
      setError(e?.message || 'Could not reach the ODIN connector.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Memoised rather than computed inline: `?? []` mints a fresh array on every
  // render, which would make the useMemos below dependencies-changed every
  // time and re-run the whole aggregation on each keystroke in the filter bar.
  const findingRows = useMemo(() => (findings?.ok ? findings.rows : []), [findings])
  const auditRows = useMemo(() => (audits?.ok ? audits.rows : []), [audits])

  // Facets come from every row, not the filtered set — options that vanish as
  // you use them make a filter bar impossible to reason about.
  const opts = useMemo(
    () => odinFacets(resolveOdinRows(findingRows, sites, { keepUnplaced })),
    [findingRows, sites, keepUnplaced]
  )
  const a = useMemo(
    () => odinAnalytics(findingRows, auditRows, sites, f, { keepUnplaced }),
    [findingRows, auditRows, sites, f, keepUnplaced]
  )

  if (loading && !findings) {
    return (
      <div className="card grid place-items-center px-6 py-16 text-center">
        <Loader2 size={22} className="animate-spin text-brand-600" />
        <p className="mt-3 text-[13px] text-ink-500">Running your Metabase questions…</p>
      </div>
    )
  }

  // Connecting takes over the tab. It is a form with an API key in it; leaving
  // half a dashboard behind it would put a credential field next to numbers
  // fetched with the credential it is about to replace.
  const connectPanel = (
    <div className="mx-auto max-w-2xl animate-fade-in-up">
      <MetabaseConnect
        orgId={orgId}
        actor={actor}
        compact
        onSaved={() => { setConnecting(false); load() }}
      />
      <div className="mt-3 flex justify-center">
        <button
          type="button"
          onClick={() => setConnecting(false)}
          className="inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-[12.5px] font-semibold text-ink-500 hover:text-ink-800"
        >
          <X size={14} /> Cancel
        </button>
      </div>
    </div>
  )

  if (connecting && isAdmin) return connectPanel

  if (error) return <Blocked title="The ODIN connector did not answer" body={error} />

  if (findings && !findings.ok) {
    return (
      <Blocked
        {...findingsBlock(findings, isAdmin)}
        onRetry={load}
        onConnect={isAdmin ? () => setConnecting(true) : null}
        connectLabel={findings.reason === 'not-configured' ? 'Connect Metabase' : 'Connection settings'}
      />
    )
  }

  const t = a.totals
  const HEAD = [
    { key: 'total', icon: Radar, label: 'Issues in scope', value: t.total, tone: '#0d9488' },
    ...STATUS_META.map((s) => ({ key: s.key, icon: ShieldAlert, label: s.label, value: t[s.key], tone: s.color })),
  ]

  const fetchedAt = findings?.fetchedAt ? new Date(findings.fetchedAt) : null

  return (
    <div className="animate-fade-in-up">
      {/* Filter bar. Not the shared FilterBar: that one filters by SITE against
          this app's own registry, and ODIN's population comes from a warehouse
          whose site list need not match. Status and sub-category are the two
          dimensions people actually slice this by. */}
      <div className="card mb-5 flex flex-wrap items-end gap-3 p-4">
        {/* Only when there is more than one instance. A picker with a single
            option is furniture that has to be read before it can be ignored. */}
        {opts.sources.length > 1 && (
          <Picker id="odin-source" label="Instance" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>
            <option value="all">All instances ({opts.sources.length})</option>
            {opts.sources.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Picker>
        )}
        <Picker id="odin-region" label="Region" value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })}>
          <option value="all">All regions</option>
          {opts.regions.map((r) => <option key={r} value={r}>{r}</option>)}
        </Picker>
        <Picker id="odin-entity" label="Entity" value={f.entity} onChange={(e) => setF({ ...f, entity: e.target.value })}>
          <option value="all">All entities</option>
          {opts.entities.map((r) => <option key={r} value={r}>{r}</option>)}
        </Picker>
        <Picker id="odin-status" label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="all">All statuses</option>
          {STATUS_META.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </Picker>
        <Picker id="odin-sub" label="Sub-category" value={f.subCategory} onChange={(e) => setF({ ...f, subCategory: e.target.value })}>
          <option value="all">All sub-categories</option>
          {opts.subCategories.map((r) => <option key={r} value={r}>{r}</option>)}
        </Picker>
        <Picker id="odin-from" label="From" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })}>
          <option value="">Earliest</option>
          {opts.months.map((m) => <option key={m} value={m}>{m}</option>)}
        </Picker>
        <Picker id="odin-to" label="To" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })}>
          <option value="">Latest</option>
          {opts.months.map((m) => <option key={m} value={m}>{m}</option>)}
        </Picker>
        <button
          type="button"
          onClick={() => setF(EMPTY_FILTER)}
          className="rounded-2xl bg-clay-surface px-4 py-2.5 text-[12.5px] font-semibold text-ink-700 shadow-clay-sm"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-2xl bg-clay-surface px-4 py-2.5 text-[12.5px] font-semibold text-ink-700 shadow-clay-sm disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
        {/* Admins only, and quiet. Changing the API key or repointing a
            question is a rare act, but when it is needed it is needed from
            here — looking at the dashboard is how you find out a question is
            returning the wrong thing. */}
        {isAdmin && (
          <button
            type="button"
            onClick={() => setConnecting(true)}
            title="Metabase connection settings"
            className="inline-flex items-center gap-2 rounded-2xl bg-clay-surface px-4 py-2.5 text-[12.5px] font-semibold text-ink-500 shadow-clay-sm hover:text-ink-800"
          >
            <SlidersHorizontal size={14} /> Connection
          </button>
        )}
      </div>

      {/* Every caveat that would make a number on this page mean something
          other than what it looks like. Above the charts, because a reader has
          to see them before the figure, not after it. */}
      <Caveats findings={findings} audits={audits} totals={t} />

      <div className="mb-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {HEAD.map(({ key, ...s }) => <Stat key={key} {...s} />)}
      </div>
      <p className="mb-5 text-[11.5px] leading-relaxed text-ink-400">
        Safety &amp; Security issues from Metabase
        {fetchedAt ? `, as at ${fetchedAt.toLocaleString()}` : ''}.
        {' '}These are a snapshot, not a live feed — press Refresh to run the questions again.
      </p>

      <Panel
        title="Where the issues are"
        subtitle="One pin per site; the ring is its status mix, the number is how many"
        className="mb-5"
      >
        {a.pins.length === 0 ? (
          <NoData height={300}>
            {a.unplaced.length > 0
              ? 'Issues exist, but none of the affected sites have coordinates. Add a latitude and longitude to the site in Sites, or return them from your Metabase question.'
              : 'No issues in this scope.'}
          </NoData>
        ) : (
          <>
            <div className="overflow-hidden rounded-[18px]">
              <MapContainer
                center={[a.pins[0].lat, a.pins[0].lng]}
                zoom={5}
                scrollWheelZoom
                style={{ height: 360, width: '100%' }}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {a.pins.map((p) => (
                  <Marker key={p.id} position={[p.lat, p.lng]} icon={issuePin(p)}>
                    <LeafletTooltip direction="top" offset={[0, -14]} opacity={1}>
                      <span className="text-[12px] font-semibold">{p.site}</span>
                      {STATUS_META.filter((s) => p.byStatus[s.key] > 0).map((s) => (
                        <span key={s.key} className="block text-[11px]">
                          {p.byStatus[s.key]} {s.label.toLowerCase()}
                        </span>
                      ))}
                      {(p.region || p.entity) && (
                        <span className="block text-[11px]">{[p.region, p.entity].filter(Boolean).join(' · ')}</span>
                      )}
                    </LeafletTooltip>
                  </Marker>
                ))}
              </MapContainer>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
              {STATUS_META.map((s) => (
                <span key={s.key} className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-ink-600">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                  {s.label}
                </span>
              ))}
            </div>

            {a.unplaced.length > 0 && (
              // Said out loud, every time. A map showing eleven of nineteen
              // sites and saying nothing will be read as showing all nineteen.
              <p className="mt-3 flex items-start gap-2 text-[11.5px] leading-relaxed text-ink-500">
                <MapPinOff size={13} className="mt-0.5 flex-none" />
                {a.unplaced.reduce((n, u) => n + u.total, 0)} issue
                {a.unplaced.reduce((n, u) => n + u.total, 0) === 1 ? '' : 's'} at{' '}
                {a.unplaced.length} site{a.unplaced.length === 1 ? '' : 's'} could not be placed:{' '}
                {a.unplaced.slice(0, 4).map((u) => u.site).join(', ')}
                {a.unplaced.length > 4 ? `, +${a.unplaced.length - 4} more` : ''}. They are counted in
                every chart below.
              </p>
            )}
          </>
        )}
      </Panel>

      <Panel
        title="Status by region"
        subtitle="Open, In Progress, On Hold and Closed — busiest region first"
        className="mb-5"
      >
        {a.byRegion.length === 0 ? (
          <NoData>No issues in this scope.</NoData>
        ) : (
          <ChartFrame
            label="Safety and security issues by region and status"
            width="100%"
            height={Math.max(260, a.byRegion.length * 42 + 60)}
          >
            <BarChart data={a.byRegion} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
              <XAxis type="number" allowDecimals={false} {...axis} />
              <YAxis type="category" dataKey="region" width={120} {...axis} />
              <Tooltip cursor={{ fill: 'rgba(227,204,191,0.35)' }} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              {STATUS_META.map((s) => (
                <Bar key={s.key} dataKey={s.key} name={s.label} stackId="s" fill={s.color} />
              ))}
            </BarChart>
          </ChartFrame>
        )}
      </Panel>

      <div className="mb-5 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Panel title="Sub-category of finding" subtitle="Every sub-category, most frequent first">
          {a.bySubCategoryAll.length === 0 ? (
            <NoData>Nothing to show.</NoData>
          ) : (
            <ChartFrame
              label="Findings by sub-category"
              width="100%"
              height={Math.max(260, a.bySubCategoryAll.length * 30 + 50)}
            >
              <BarChart data={a.bySubCategoryAll} layout="vertical" margin={{ top: 8, right: 32, left: 8, bottom: 0 }}>
                <XAxis type="number" allowDecimals={false} {...axis} />
                <YAxis type="category" dataKey="name" width={170} {...axis} />
                <Tooltip cursor={{ fill: 'rgba(227,204,191,0.35)' }} />
                <Bar dataKey="value" name="Findings" radius={[0, 6, 6, 0]}>
                  {a.bySubCategoryAll.map((d) => <Cell key={d.name} fill={d.color} />)}
                  <LabelList dataKey="value" position="right" style={{ fontSize: 11, fill: '#8a7660' }} />
                </Bar>
              </BarChart>
            </ChartFrame>
          )}
        </Panel>

        <Panel title="Share of findings" subtitle="Top 8 sub-categories; the rest are pooled">
          {a.bySubCategoryTop.length === 0 ? (
            <NoData>Nothing to show.</NoData>
          ) : (
            <ChartFrame label="Share of findings by sub-category" width="100%" height={300}>
              <PieChart>
                <Pie data={a.bySubCategoryTop} dataKey="value" nameKey="name" outerRadius={92} innerRadius={52} paddingAngle={2}>
                  {a.bySubCategoryTop.map((d) => <Cell key={d.name} fill={d.color} />)}
                </Pie>
                <Tooltip />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 10.5 }} />
              </PieChart>
            </ChartFrame>
          )}
        </Panel>
      </div>

      <PassRates
        audits={audits}
        byEntity={a.passByEntity}
        byRegion={a.passByRegion}
        overall={a.passOverall}
        source={a.passSource}
        isAdmin={isAdmin}
        onConnect={isAdmin ? () => setConnecting(true) : null}
      />
    </div>
  )
}

// ── Pass and fail ────────────────────────────────────────────────────────────

function PassRates({ audits, byEntity, byRegion, overall, source, isAdmin, onConnect }) {
  // Nothing anywhere carries a pass rate. That is a configuration answer, not
  // an empty chart, and it names the two places it could come from — because
  // either one will do and an admin choosing between them needs to know that.
  if (source === 'none') {
    const why = audits && !audits.ok && audits.reason !== 'no-card'
      ? audits.message || 'The audits question could not be run.'
      : 'Neither question returned pass data. Add a pass and fail count (or a pass percentage) to your findings question, or point ODIN at a separate audits question that has them.'
    return (
      <Panel title="Pass and fail — day of audit vs N+7" subtitle="No pass data yet">
        <NoData height={180}>
          {isAdmin ? why : `${why.replace(/^Add /, 'An administrator needs to add ')} `}
        </NoData>
        {isAdmin && onConnect && (
          <div className="mt-3 flex justify-center">
            <button
              type="button"
              onClick={onConnect}
              className="inline-flex items-center gap-2 rounded-2xl bg-clay-surface px-4 py-2.5 text-[12.5px] font-semibold text-ink-700 shadow-clay-sm"
            >
              <Plug size={14} /> Connection settings
            </button>
          </div>
        )}
      </Panel>
    )
  }

  return (
    <>
      <PassHeadline overall={overall} source={source} />
      <div className="grid gap-4 lg:grid-cols-2">
        <PassPanel
          title="Pass percentage by entity"
          subtitle="On the day of the audit, and at the seven-day re-check"
          rows={byEntity}
        />
        <PassPanel
          title="Pass percentage by region"
          subtitle="On the day of the audit, and at the seven-day re-check"
          rows={byRegion}
        />
      </div>
    </>
  )
}

/**
 * The headline pass and fail figures.
 *
 * Counts first, percentage beside them. "412 checks passed, 88 failed" is a
 * sentence a safety meeting can act on in a way "83.4%" is not — the 88 is the
 * work. The counts are omitted entirely, rather than shown as zero, when the
 * questions gave only percentages: a zero here would read as "nothing failed".
 */
function PassHeadline({ overall, source }) {
  const hasCounts = overall.checks > 0
  return (
    <Panel
      title="Pass and fail"
      subtitle={
        source === 'findings'
          ? 'From the pass/fail columns on your findings question'
          : 'From your audits question'
      }
      className="mb-5"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          icon={CircleCheck}
          label={hasCounts ? 'Checks passed' : 'Average pass rate'}
          value={hasCounts ? overall.passed.toLocaleString() : (overall.pct == null ? '—' : `${overall.pct}%`)}
          sub={hasCounts ? `${overall.pct}% of ${overall.checks.toLocaleString()} checks` : 'across every audit in scope'}
          tone="#22c55e"
        />
        {hasCounts && (
          <Stat
            icon={CircleX}
            label="Checks failed"
            value={overall.failed.toLocaleString()}
            sub="the work the pass rate is hiding"
            tone="#ef4444"
          />
        )}
        <Stat
          icon={Radar}
          label={source === 'findings' ? 'Findings with pass data' : 'Audits in scope'}
          value={overall.audits.toLocaleString()}
          sub={
            hasCounts && overall.counted < overall.audits
              ? `${overall.counted.toLocaleString()} carry check counts`
              : undefined
          }
          tone="#0d9488"
        />
      </div>
      {hasCounts && overall.counted < overall.audits && (
        // Otherwise the counts read as covering everything in scope when they
        // cover part of it, and the difference is invisible on the tile.
        <p className="mt-3 text-[11.5px] leading-relaxed text-ink-500">
          {(overall.audits - overall.counted).toLocaleString()} of these gave a percentage but no check
          counts, so they are in the percentage and not in the totals above it.
        </p>
      )}
    </Panel>
  )
}

function PassPanel({ title, subtitle, rows }) {
  if (rows.length === 0) return <Panel title={title} subtitle={subtitle}><NoData height={180}>Nothing to show.</NoData></Panel>

  // Whether the figures are weighted by audit size or are a plain mean of
  // percentages changes what they mean, so it is stated rather than assumed.
  // A mixed page — some groups weighted, some not — is named as mixed.
  const bases = new Set(rows.map((r) => r.basis))
  const basisNote = bases.size > 1
    ? 'Some groups are weighted by audit size and some are a plain average of each audit’s percentage — your audits question supplies check counts for only part of the data.'
    : bases.has('weighted')
      ? 'Weighted by audit size: total checks passed over total checks, so a large audit counts for more than a small one.'
      : 'A plain average of each audit’s own percentage. Add a pass and fail count to your question to weight these by audit size instead.'

  const pending = rows.filter((r) => r.n7Audits < r.audits)

  // The counts behind the bar, in the tooltip. A percentage nobody can trace
  // back to "412 of 500" is a number a reader has to take on faith, and this is
  // the one panel people argue about in a meeting.
  const tip = (v, name, item) => {
    if (v == null) return ['—', name]
    const r = item?.payload
    return r?.checks > 0 && name === 'Day of audit'
      ? [`${v}% — ${r.passed.toLocaleString()} of ${r.checks.toLocaleString()} checks passed, ${r.failed.toLocaleString()} failed`, name]
      : [`${v}%`, name]
  }

  return (
    <Panel title={title} subtitle={subtitle}>
      <ChartFrame label={title} width="100%" height={Math.max(240, rows.length * 44 + 60)}>
        <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 34, left: 8, bottom: 0 }}>
          <XAxis type="number" domain={[0, 100]} unit="%" {...axis} />
          <YAxis type="category" dataKey="name" width={120} {...axis} />
          <Tooltip formatter={tip} cursor={{ fill: 'rgba(227,204,191,0.35)' }} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="day0" name="Day of audit" fill="#f59e0b" radius={[0, 5, 5, 0]}>
            <LabelList dataKey="day0" position="right" formatter={(v) => (v == null ? '' : `${v}%`)} style={{ fontSize: 10.5, fill: '#8a7660' }} />
          </Bar>
          <Bar dataKey="n7" name="N+7" fill="#0d9488" radius={[0, 5, 5, 0]}>
            <LabelList dataKey="n7" position="right" formatter={(v) => (v == null ? '' : `${v}%`)} style={{ fontSize: 10.5, fill: '#8a7660' }} />
          </Bar>
        </BarChart>
      </ChartFrame>

      <p className="mt-3 text-[11.5px] leading-relaxed text-ink-400">{basisNote}</p>
      {pending.length > 0 && (
        // Otherwise a group whose re-checks have not happened yet reads exactly
        // like one that was re-checked and scored badly.
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-500">
          N+7 is missing for some audits in {pending.map((r) => r.name).slice(0, 3).join(', ')}
          {pending.length > 3 ? ` and ${pending.length - 3} more` : ''} — those bars cover only the
          audits that have been re-checked, not all of them.
        </p>
      )}
    </Panel>
  )
}

// ── Caveats and blocked states ───────────────────────────────────────────────

function Caveats({ findings, audits, totals }) {
  const notes = []

  // Instances that did not answer, named. This leads, because it is the only
  // caveat that means numbers are MISSING rather than merely qualified — a
  // dashboard quietly drawn from two of three instances is a dashboard that
  // will be read as covering the estate.
  const down = (findings?.sources || []).filter((s) => !s.ok)
  if (down.length) {
    const total = findings.sources.length
    notes.push(`These figures are from ${total - down.length} of your ${total} Metabase instances. ${down.map((s) => `${s.label}: ${s.message || s.reason}`).join(' · ')}`)
  }
  const auditsDown = (audits?.sources || []).filter((s) => !s.ok)
  if (auditsDown.length && audits?.ok) {
    notes.push(`The pass percentages are missing ${auditsDown.map((s) => s.label).join(', ')} — that instance's audits question did not answer.`)
  }

  if (findings?.capped) {
    notes.push(`These figures are incomplete. Your findings question returned ${findings.total.toLocaleString()} rows and ODIN reads the first ${findings.rows.length.toLocaleString()}. Group or filter the question in Metabase so it fits.`)
  }
  if (totals.unknown > 0) {
    notes.push(`${totals.unknown} issue${totals.unknown === 1 ? '' : 's'} carry a status ODIN does not recognise (${totals.unknownLabels.slice(0, 4).join(', ')}${totals.unknownLabels.length > 4 ? ', …' : ''}). They are counted in the total but appear in no status bar — map them to Open, In Progress, On Hold or Closed in your question.`)
  }
  if (findings?.unmapped?.length) {
    notes.push(`Columns ODIN made no use of: ${findings.unmapped.slice(0, 8).join(', ')}${findings.unmapped.length > 8 ? ', …' : ''}. Rename one to a name ODIN knows if it should be driving a chart.`)
  }
  if (audits?.ok && audits.capped) {
    notes.push('Your audits question also returned more rows than ODIN reads, so the pass percentages cover only part of it.')
  }
  if (notes.length === 0) return null

  return (
    <div role="status" className="mb-5 space-y-2">
      {notes.map((n) => (
        <div key={n} className="flex items-start gap-2.5 rounded-2xl bg-amber-50 px-4 py-3 shadow-clay-sm">
          <AlertTriangle size={16} className="mt-0.5 flex-none text-amber-700" />
          <p className="text-[12.5px] leading-relaxed text-amber-900">{n}</p>
        </div>
      ))}
    </div>
  )
}

/**
 * What to say when there is nothing to draw.
 *
 * Each reason gets its own words because each needs a different person to do a
 * different thing, and "something went wrong" sends everybody to the same
 * dead end.
 */
function findingsBlock(res, isAdmin) {
  const where = 'Organization settings → Integrations'
  if (res.reason === 'not-configured') {
    return {
      title: 'ODIN is not connected to Metabase yet',
      body: isAdmin
        ? `Add your Metabase URL and an API key under ${where}, then point ODIN at the saved question that lists your Safety & Security findings.`
        : `An administrator needs to connect Metabase under ${where} before this dashboard can show anything.`,
    }
  }
  if (res.reason === 'no-card') {
    return {
      title: 'No findings question is configured',
      body: isAdmin
        ? `Metabase is connected, but ODIN has not been told which saved question lists your findings. Set it under ${where}.`
        : `Metabase is connected, but nobody has told ODIN which saved question lists the findings. Ask an administrator to set it under ${where}.`,
    }
  }
  return {
    title: 'Metabase could not answer',
    body: res.message || 'The findings question did not run. Check it still exists and that the API key can read it.',
    // Metabase's own words, which the server sends only to an admin. Without
    // them "server error" names no field, no parameter and no permission —
    // there is nothing in it to act on.
    detail: res.detail,
  }
}

function Blocked({ title, body, detail, onRetry, onConnect, connectLabel = 'Connect Metabase' }) {
  return (
    <div className="card grid place-items-center px-6 py-14 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-500/10 text-brand-600">
        <Plug size={20} />
      </span>
      <p className="mt-3 text-[15px] font-bold text-ink-900">{title}</p>
      <p className="mx-auto mt-1.5 max-w-[52ch] text-[13px] leading-relaxed text-ink-500">{body}</p>
      {detail && (
        // Monospace and left-aligned: this is a machine's sentence, and
        // centring it as prose makes a stack-trace-shaped thing unreadable.
        <p className="mx-auto mt-3 max-w-[62ch] rounded-xl bg-clay-surface px-3 py-2 text-left font-mono text-[11.5px] leading-relaxed text-ink-600 shadow-clay-inset">
          {detail}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {/* Leads, when it is offered. The retry is the answer to a transient
            failure; connecting is the answer to the state most people reading
            this screen are actually in. */}
        {onConnect && (
          <button
            type="button"
            onClick={onConnect}
            className="inline-flex items-center gap-2 rounded-2xl bg-brand-600 px-4 py-2.5 text-[12.5px] font-semibold text-white shadow-brand-sm transition-colors hover:bg-brand-500"
          >
            <Plug size={14} /> {connectLabel}
          </button>
        )}
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-2 rounded-2xl bg-clay-surface px-4 py-2.5 text-[12.5px] font-semibold text-ink-700 shadow-clay-sm"
          >
            <RefreshCw size={14} /> Try again
          </button>
        )}
      </div>
    </div>
  )
}

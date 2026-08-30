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
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, Cell, LabelList,
  LineChart, Line, ReferenceLine, CartesianGrid,
} from 'recharts'
import { MapContainer, TileLayer, Marker, Tooltip as LeafletTooltip } from 'react-leaflet'
import L from 'leaflet'
import {
  RefreshCw, ShieldAlert, MapPinOff, Radar, AlertTriangle, Plug, Loader2,
  CircleCheck, CircleX, SlidersHorizontal, X, ClipboardCheck,
} from 'lucide-react'
import ChartFrame from '../../shared/ui/ChartFrame'
import { metabaseQuery, metabaseSettings } from '../../shared/functions'
import MetabaseConnect from '../../shared/integrations/MetabaseConnect'
import { Panel, Stat, NoData, Picker } from './ui'
import {
  odinAnalytics, odinFacets, resolveOdinRows, STATUS_META, STATUS_BY_KEY, leadStatus,
  GRANULARITIES, GROUP_DIMS, PASS_MARK,
} from './odinAnalytics'

const axis = { tickLine: false, axisLine: false, fontSize: 11, tick: { fill: '#8a7660' } }

const num = (v) => (v == null ? '—' : Number(v).toLocaleString())

/**
 * The rule that separates the two halves of this page.
 *
 * Scores, then the tickets those scores raised. Without the split it is
 * seventeen panels in a column and no indication that half of them count
 * audits and half count tickets — two populations that must never be added up.
 */
function BandHead({ title, note }) {
  return (
    <div className="mb-3 mt-8 flex items-baseline gap-3 border-b border-ink-100 pb-2 first:mt-0">
      <h2 className="text-[15px] font-bold tracking-tight text-ink-900">{title}</h2>
      {note && <span className="text-[11.5px] text-ink-400">{note}</span>}
    </div>
  )
}

const EMPTY_FILTER = {
  region: 'all', entity: 'all', status: 'all', subCategory: 'all', source: 'all', from: '', to: '',
  // The estate dimensions. Offered only where the connected questions carry
  // them, so a tenant whose warehouse has no city column never sees the picker.
  city: 'all', ownership: 'all', businessLine: 'all', centerType: 'all', auditType: 'all', priority: 'all',
  // How the period charts are bucketed, and what the breakdowns group by.
  gran: 'month',
  groupBy: 'region',
}

/**
 * The three readings of one audit, and why each is drawn the way it is.
 *
 * They are three measurements of the SAME audits rather than three groups, so
 * they get the categorical slots in order and the pass mark gets a plain rule.
 * `toDate` is last and thinnest on purpose: it is the only one that moves
 * between refreshes without the estate changing, so it is context rather than
 * the line anyone should trend.
 */
const TREND_SERIES = [
  { key: 'day0', label: 'On the day', color: '#2a78d6' },
  { key: 'n7', label: 'After 7 days', color: '#eb6834' },
  { key: 'toDate', label: 'To date', color: '#1baf7a', dashed: true },
]

/** Filter key → the facet list that fills it. Rendered only where non-empty. */
const ESTATE_FILTERS = [
  { key: 'city', label: 'City', opt: 'cities', all: 'All cities' },
  { key: 'businessLine', label: 'Business line', opt: 'businessLines', all: 'All lines' },
  { key: 'ownership', label: 'Ownership', opt: 'ownerships', all: 'All ownership' },
  { key: 'centerType', label: 'Centre type', opt: 'centerTypes', all: 'All centre types' },
  { key: 'auditType', label: 'Audit type', opt: 'auditTypes', all: 'All audit types' },
  { key: 'priority', label: 'Priority', opt: 'priorities', all: 'All priorities' },
]

/** A date input styled as one of the filter bar's fields. */
function DateField({ id, label, value, min, max, onChange }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-400">
        {label}
      </label>
      <input
        id={id}
        type="date"
        value={value}
        min={min || undefined}
        max={max || undefined}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-2xl bg-clay-surface px-3 py-2.5 text-[12.5px] font-semibold text-ink-700 shadow-clay-sm"
      />
    </div>
  )
}

/** A segmented control. Six grains is too many for a dropdown nobody opens. */
function Segments({ label, value, options, onChange }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-400">{label}</span>
      <div role="group" aria-label={label} className="flex flex-wrap gap-1 rounded-2xl bg-clay-surface p-1 shadow-clay-sm">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            aria-pressed={value === o.key}
            onClick={() => onChange(o.key)}
            className={`rounded-xl px-2.5 py-1.5 text-[11.5px] font-semibold transition ${
              value === o.key ? 'bg-ink-800 text-white shadow-clay-sm' : 'text-ink-500 hover:text-ink-800'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

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

export default function OdinTab({ view = 'scores', sites = [], orgId, actor, isAdmin = false, keepUnplaced = true }) {
  // Which half is on screen. The scores view still needs the findings
  // question — the centre watchlist puts tickets beside pass rates, and the
  // pass figures fall back to findings rows when the audits question carries
  // none. The tickets view needs only findings, so it runs one query instead
  // of two and arrives in about half the time.
  const showScores = view !== 'tickets'
  const showTickets = view !== 'scores'
  const [f, setF] = useState(EMPTY_FILTER)
  const [loading, setLoading] = useState(true)
  const [findings, setFindings] = useState(null)  // { ok, rows, … } as returned
  const [audits, setAudits] = useState(null)
  const [error, setError] = useState('')
  // The connection form, offered inline. An admin looking at an empty dashboard
  // should be able to connect it from where they are standing rather than being
  // sent to another screen and back — see shared/integrations/MetabaseConnect.
  const [connecting, setConnecting] = useState(false)
  // The redacted connection, for admins only, and only to report how old the
  // API key is. On an instance that issues short-lived keys, the dashboard
  // breaking on a schedule is the thing this page can warn about before it
  // happens — see keyAge in functions/lib/metabase.js. Never the key itself:
  // metabaseConfig strips it server-side.
  const [conn, setConn] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      // Both at once. The audits question is optional and its absence is a
      // panel-level message, not a page-level failure, so a rejection from
      // either must not take the other's data off the screen.
      // The window goes DOWN to Metabase rather than being applied here: both
      // of the questions this was built against declare required date
      // variables and cannot run without them, and filtering in the warehouse
      // beats shipping a year of rows so the browser can discard most of them.
      const range = { from: f.from, to: f.to }
      const [fRes, aRes] = await Promise.all([
        metabaseQuery('findings', range),
        // Skipped entirely on the tickets view rather than fetched and
        // ignored: this is a thirty-to-sixty-second warehouse query.
        showScores ? metabaseQuery('audits', range) : Promise.resolve(null),
      ])
      setFindings(fRes)
      setAudits(aRes)
      // Admin-only and never fatal: a failure here costs a rotation warning,
      // not the dashboard, so it must not reach the catch below.
      if (isAdmin) {
        try { setConn((await metabaseSettings()).config) } catch { /* the warning is a nicety */ }
      }
    } catch (e) {
      setError(e?.message || 'Could not reach the ODIN connector.')
    } finally {
      setLoading(false)
    }
    // Changing either end of the range re-runs the questions. A date input
    // commits on blur rather than per keystroke, so this is one fetch per
    // deliberate act, not one per character.
  }, [isAdmin, f.from, f.to, showScores])

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

  // ── The two headline rows ──────────────────────────────────────────────────
  //
  // This used to be one row of five: issues in scope and a tile per status. It
  // answered "how big is the backlog" and nothing else — you could read every
  // tile and still not know whether the estate passes its audits, which is the
  // question the page exists for.
  //
  // Two rows now, one per band. Scores first, because a ticket only means
  // anything as the consequence of a failed check. Every tile is null-safe: a
  // question that carries no pass data leaves the score row showing dashes
  // rather than a confident zero.
  const rec = a.recovery
  const day0 = rec.stages[0]
  const n7 = rec.stages[1]
  const recovered = n7?.rate != null && day0?.rate != null ? Math.round((n7.rate - day0.rate) * 10) / 10 : null
  const failing = rec.total && n7 ? rec.total - n7.passed : null

  // ── Counts lead, percentages follow ────────────────────────────────────────
  //
  // These tiles were percentages with nothing behind them, and a percentage on
  // its own is not a number anyone can act on: 67.3% is a mood, "560 passed,
  // 272 failed" is a list of centres to visit. The rate is still here, one line
  // down, because it is what you compare between months.
  const pctOf = (n) => (rec.total ? `${Math.round((n / rec.total) * 1000) / 10}% of ${num(rec.total)}` : undefined)

  const AUDIT_KPIS = [
    { key: 'audits', icon: ClipboardCheck, label: 'Audits completed', value: num(a.auditCount || rec.total), tone: '#0d9488' },
    {
      key: 'n7pass', icon: CircleCheck, label: 'Passed after 7 days',
      value: n7 ? num(n7.passed) : '—',
      sub: n7?.rate == null ? undefined : pctOf(n7.passed),
      tone: '#22c55e',
    },
    {
      key: 'n7fail', icon: CircleX, label: 'Failed after 7 days',
      value: failing == null ? '—' : num(failing),
      sub: failing == null ? undefined : pctOf(failing),
      tone: '#ef4444',
    },
    {
      key: 'day0', icon: Radar, label: 'Passed on the day',
      value: day0 ? num(day0.passed) : '—',
      // The delta is the whole argument for the seven-day window, so it rides
      // on the tile the window is measured against.
      sub: [day0?.rate == null ? null : pctOf(day0.passed),
        recovered == null ? null : `${recovered > 0 ? '+' : ''}${recovered} pts by day 7`]
        .filter(Boolean).join(' · ') || undefined,
      tone: '#f59e0b',
    },
  ]

  // Rejected is neither closed nor outstanding, so it comes off the total
  // before "still open" — counting a dismissed finding as work in hand is how
  // a backlog figure stops meaning anything.
  const openTickets = t.total - t.closed - t.rejected
  const codeRed = (a.byPriority || []).find((p) => /red/i.test(p.name))
  const TICKET_KPIS = [
    {
      key: 'raised', icon: ShieldAlert, label: 'Tickets raised', value: num(t.total),
      // All three outcomes on one line, because they have to add up to the
      // number above them and a reader should be able to check that.
      sub: [`${num(t.closed)} closed`, `${num(openTickets)} open`, t.rejected ? `${num(t.rejected)} rejected` : null]
        .filter(Boolean).join(' · '),
      tone: '#0d9488',
    },
    {
      key: 'open', icon: AlertTriangle, label: 'Still open', value: num(openTickets),
      sub: a.ageing?.ageing?.length
        ? `oldest queue averaging ${Math.max(...a.ageing.ageing.map((x) => x.days || 0)).toLocaleString()} days`
        : undefined,
      tone: '#f59e0b',
    },
    {
      key: 'breach', icon: AlertTriangle, label: 'SLA breached', value: num(a.breached),
      sub: t.total ? `${Math.round((a.breached / t.total) * 100)}% of tickets in view` : undefined,
      tone: '#ef4444',
    },
    { key: 'red', icon: ShieldAlert, label: 'Code red open', value: codeRed ? num(codeRed.open) : '—', sub: codeRed ? `${num(codeRed.value)} raised` : undefined, tone: '#dc2626' },
  ]

  const fetchedAt = findings?.fetchedAt ? new Date(findings.fetchedAt) : null
  const groupLabel = (GROUP_DIMS.find((d) => d.key === a.groupBy)?.label || 'group').toLowerCase()

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

        {/* The estate dimensions, each offered only where the connected
            questions actually carry it. A picker whose every row is
            "(not stated)" is furniture that has to be read before it can be
            ignored — the same rule the Instance picker follows above. */}
        {ESTATE_FILTERS.map(({ key, label, opt, all }) => (
          opts[opt].length > 1 && (
            <Picker
              key={key}
              id={`odin-${key}`}
              label={label}
              value={f[key]}
              onChange={(e) => setF({ ...f, [key]: e.target.value })}
            >
              <option value="all">{all}</option>
              {opts[opt].map((v) => <option key={v} value={v}>{v}</option>)}
            </Picker>
          )
        ))}

        {/* Real dates rather than the month dropdowns this had. A quarterly
            audit programme is reviewed on the quarter boundary, and "the first
            three weeks of March" was not expressible at all. Both ends are
            bounded by the span the data actually covers, so the picker cannot
            be set to a year that returns nothing. */}
        <DateField
          id="odin-from" label="From" value={f.from} min={opts.minDate} max={f.to || opts.maxDate}
          onChange={(v) => setF({ ...f, from: v })}
        />
        <DateField
          id="odin-to" label="To" value={f.to} min={f.from || opts.minDate} max={opts.maxDate}
          onChange={(v) => setF({ ...f, to: v })}
        />

        <Segments
          label="Granularity"
          value={f.gran}
          options={GRANULARITIES}
          onChange={(gran) => setF({ ...f, gran })}
        />

        {/* Which dimension the breakdowns cut by. In the filter row rather than
            on a card, because it governs both the status chart and the pass
            chart — a control inside one card reads as governing only that one. */}
        {a.dimensions.length > 1 && (
          <Picker id="odin-groupby" label="Break down by" value={a.groupBy} onChange={(e) => setF({ ...f, groupBy: e.target.value })}>
            {a.dimensions.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </Picker>
        )}

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
      <KeyExpiry conn={conn} onConnect={isAdmin ? () => setConnecting(true) : null} />

      <Caveats findings={findings} audits={audits} totals={t} />

      {showScores && <BandHead title="Audit scores" note={`Against the ${PASS_MARK}% pass mark`} />}

      {showScores && (
        <>
          <div className="mb-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {AUDIT_KPIS.map(({ key, ...s }) => <Stat key={key} {...s} />)}
          </div>
          <p className="mb-5 text-[11.5px] leading-relaxed text-ink-400">
            From Metabase{fetchedAt ? `, as at ${fetchedAt.toLocaleString()}` : ''}.
            {' '}A snapshot, not a live feed — press Refresh to run the questions again.
          </p>

          <TrendPanel trend={a.trend} gran={f.gran} source={a.passSource} />

          <div className="mb-5 grid gap-4 lg:grid-cols-[1fr_1fr]">
            <RecoveryPanel recovery={a.recovery} />
            <DistributionPanel distribution={a.distribution} />
          </div>

          <PassRates
            audits={audits}
            byGroup={a.passByGroup}
            groupLabel={groupLabel}
            overall={a.passOverall}
            source={a.passSource}
            isAdmin={isAdmin}
            onConnect={isAdmin ? () => setConnecting(true) : null}
          />

          <Watchlist rows={a.watchlist} join={a.join} />
        </>
      )}

      {showTickets && <BandHead title="Remediation tickets" note={showScores ? 'Raised by the audits above' : 'Raised by the FLS audits'} />}

      {showTickets && (
        <>
          <div className="mb-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {TICKET_KPIS.map(({ key, ...s }) => <Stat key={key} {...s} />)}
          </div>
          <p className="mb-5 text-[11.5px] leading-relaxed text-ink-400">
        One row per ticket the audits raised. Bucketed on the date the defect was RAISED, not
        the date it closed — the two are different clocks.
          </p>

          <TicketTrendPanel tickets={a.tickets} gran={f.gran} breached={a.breached} />

          <AgeingPanel ageing={a.ageing} />

          <div className="mb-5 grid gap-4 lg:grid-cols-[1fr_1fr]">
        <SlaPanel rows={a.bySla} breached={a.breached} total={t.total} />
        <PriorityPanel rows={a.byPriority} />
          </div>

          <CheckpointPanel rows={a.byCheckpoint} />
        </>
      )}

      {showTickets && <BandHead title="Where" note="Joined to your site register" />}

      {showTickets && (
        <>
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
            title={`Status by ${groupLabel}`}
            subtitle={`Open, In Progress, On Hold and Closed — busiest ${groupLabel} first`}
            className="mb-5"
          >
            {a.statusByGroup.length === 0 ? (
              <NoData>No issues in this scope.</NoData>
            ) : (
              <ChartFrame
                label="Safety and security issues by region and status"
                width="100%"
                height={Math.max(260, a.statusByGroup.length * 42 + 60)}
              >
                <BarChart data={a.statusByGroup} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
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

          <div className="mb-5">
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
          </div>
        </>
      )}

    </div>
  )
}

// ── Over time ────────────────────────────────────────────────────────────────

const GRAN_LABEL = Object.fromEntries(GRANULARITIES.map((g) => [g.key, g.label.toLowerCase()]))

/**
 * Pass rate over time, at the grain the reader picked.
 *
 * Two charts, not one with two axes. The rate and the count are different
 * scales, and putting them on one plot with two y-axes invents a relationship
 * out of where the scales happen to line up — so the rate is a line chart and
 * the counts behind it are a stacked bar chart directly beneath, sharing an
 * x-axis by being the same buckets in the same order.
 *
 * The counts are not optional decoration. A bucket holding two audits swings
 * between 0% and 100% on a single result, and a rate with no denominator beside
 * it is exactly how that gets read as a collapse.
 */
function TrendPanel({ trend, gran, source }) {
  const { series, undated } = trend
  const grain = GRAN_LABEL[gran] || 'period'

  if (source === 'none' || series.length === 0) return null

  return (
    <Panel
      title="Pass rate over time"
      subtitle={`Share of audits at or above ${PASS_MARK}%, by ${grain}`}
      className="mb-5"
    >
      <ChartFrame label="Pass rate over time" width="100%" height={260}>
        <LineChart data={series} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#eee6dd" vertical={false} />
          <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={28} />
          <YAxis domain={[0, 100]} unit="%" {...axis} width={44} />
          <Tooltip
            cursor={{ stroke: '#c9b8a6' }}
            formatter={(v, n) => [v == null ? '—' : `${v}%`, n]}
            labelFormatter={(l) => {
              const b = series.find((s) => s.label === l)
              return b ? `${l} · ${b.audits} audit${b.audits === 1 ? '' : 's'}` : l
            }}
          />
          <Legend iconType="plainline" wrapperStyle={{ fontSize: 11 }} />
          {/* The pass mark, solid. A dashed rule reads as a projection. */}
          <ReferenceLine y={PASS_MARK} stroke="#a8a29e" strokeWidth={1.5} />
          {TREND_SERIES.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dashed ? '4 3' : undefined}
              dot={false}
              activeDot={{ r: 4 }}
              // A period nobody audited is a gap, not a dive to zero.
              connectNulls={false}
            />
          ))}
        </LineChart>
      </ChartFrame>

      <p className="mb-1 mt-4 text-[11.5px] font-semibold text-ink-600">
        The audits behind it
      </p>
      <ChartFrame label="Audits by verdict over time" width="100%" height={150}>
        <BarChart data={series} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
          <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={28} />
          <YAxis allowDecimals={false} {...axis} width={44} />
          <Tooltip cursor={{ fill: 'rgba(227,204,191,0.35)' }} />
          <Bar dataKey="pass" name="Pass" stackId="v" fill="#0ca30c" />
          <Bar dataKey="fail" name="Fail" stackId="v" fill="#d03b3b" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ChartFrame>

      <p className="mt-3 text-[11.5px] leading-relaxed text-ink-500">
        <b>On the day</b> credits no remediation. <b>After 7 days</b> re-scores a failed critical
        checkpoint as a pass where its ticket closed within seven days of being raised.
        <b> To date</b> credits every closure up to this refresh — it is the true current position,
        and the only one of the three that moves without the estate changing, which is why it is
        drawn as context rather than as the line to trend.
        {undated > 0 && (
          <> {undated.toLocaleString()} audit{undated === 1 ? ' carries' : 's carry'} no date and
          {undated === 1 ? ' is' : ' are'} in none of these buckets.</>
        )}
      </p>
    </Panel>
  )
}

/** Tickets raised per period, split by where they now stand. */
function TicketTrendPanel({ tickets, gran, breached }) {
  const { series, undated } = tickets
  if (series.length === 0) return null
  const total = series.reduce((n, s) => n + s.total, 0)

  return (
    <Panel
      title="Remediation tickets raised"
      subtitle={`By the ${GRAN_LABEL[gran] || 'period'} the defect was raised, split by where it stands now`}
      className="mb-5"
      right={
        breached > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 px-2.5 py-1 text-[11px] font-semibold text-red-600">
            <AlertTriangle size={12} /> {breached.toLocaleString()} SLA breached
          </span>
        ) : null
      }
    >
      <ChartFrame label="Tickets raised over time" width="100%" height={220}>
        <BarChart data={series} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#eee6dd" vertical={false} />
          <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={28} />
          <YAxis allowDecimals={false} {...axis} width={44} />
          <Tooltip cursor={{ fill: 'rgba(227,204,191,0.35)' }} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="closed" name="Closed" stackId="t" fill="#0ca30c" />
          <Bar dataKey="open" name="Still open" stackId="t" fill="#fab219" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ChartFrame>
      <p className="mt-3 text-[11.5px] leading-relaxed text-ink-500">
        Bucketed on the date the defect was RAISED, not the date it closed — the two are different
        clocks, and mixing them into one bar produces a backlog chart that says nothing.
        {' '}{total.toLocaleString()} ticket{total === 1 ? '' : 's'} in scope.
        {undated > 0 && <> {undated.toLocaleString()} carry no date and are in none of these bars.</>}
      </p>
    </Panel>
  )
}

// ── The FLS panels ───────────────────────────────────────────────────────────
//
// Everything here is fed by a column a findings or audits question MAY carry
// and often does not, so each renders NOTHING at all when its column is absent
// rather than an empty frame. A panel captioned "no data" for a tenant who was
// never going to have that column is furniture on every load, forever.

/**
 * What the seven-day window recovers.
 *
 * An ordered progression, so one hue stepped rather than three unrelated
 * colours, and the steps start dark enough to hold contrast on the surface.
 * The shared denominator sits under every bar: "2,157 passed" is not a number
 * anyone can act on without the total beside it.
 */
const RECOVERY_STEPS = ['#86b6ef', '#2a78d6', '#184f95']

function RecoveryPanel({ recovery }) {
  if (!recovery?.total) return null
  const { total, stages } = recovery
  return (
    <Panel
      title="What the 7-day window recovers"
      subtitle="The same audits counted three times, as remediation is credited"
    >
      <div className="space-y-4">
        {stages.map((st, i) => (
          <div key={st.label}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[12.5px] font-medium text-ink-700">{st.label}</span>
              <span className="text-[13px] font-bold tabular-nums text-ink-900">
                {st.rate == null ? '—' : `${st.rate}%`}
              </span>
            </div>
            <div className="mt-1.5 h-3.5 overflow-hidden rounded-full bg-clay-100">
              <div
                className="h-full rounded-full transition-[width] duration-500 ease-emil"
                style={{ width: `${Math.max(1, st.rate || 0)}%`, background: RECOVERY_STEPS[i] || RECOVERY_STEPS[2] }}
              />
            </div>
            <p className="mt-1 text-[11px] tabular-nums text-ink-400">
              {st.passed.toLocaleString()} of {total.toLocaleString()}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[11.5px] leading-relaxed text-ink-500">
        A failed critical checkpoint counts as a pass once its ticket closes inside seven days of
        being raised. The gap between the first two bars is what that window bought.
      </p>
    </Panel>
  )
}

/** Audits by score band. Pass and fail are STATES, so they take status colours. */
function DistributionPanel({ distribution }) {
  if (!distribution?.scored) return null
  const { bands, scored } = distribution
  const max = Math.max(1, ...bands.map((b) => b.value))
  return (
    <Panel title="Score distribution" subtitle={`${scored.toLocaleString()} audits, after the 7-day window`}>
      <div className="space-y-2">
        {bands.map((b) => (
          <div key={b.name} className="flex items-center gap-3">
            <span className="w-16 shrink-0 text-right text-[11.5px] tabular-nums text-ink-500">{b.name}</span>
            <div className="h-3.5 flex-1 overflow-hidden rounded-full bg-clay-100">
              <div
                className="h-full rounded-full"
                style={{ width: `${(b.value / max) * 100}%`, background: b.passing ? '#0ca30c' : '#d03b3b' }}
              />
            </div>
            <span className="w-12 shrink-0 text-right text-[12px] font-semibold tabular-nums text-ink-800">
              {b.value.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[11.5px] leading-relaxed text-ink-500">
        The two bands either side of {PASS_MARK}% are the ones worth chasing — a near miss is a
        different problem from a collapse, and an even histogram hides which one you have.
      </p>
    </Panel>
  )
}

/**
 * How long tickets take, in days.
 *
 * Two measurements, kept apart on purpose, because they are not the same kind
 * of number and averaging them together produces one that improves when work
 * is abandoned.
 *
 *   TIME TO CLOSE is a finished duration — raised to closed — and exists only
 *   for tickets that got there.
 *
 *   AGE is how long the ones that did not have been waiting, and it grows
 *   every day nobody touches them. A queue whose average age is climbing is
 *   the thing this panel exists to make visible.
 *
 * Rejected sits with the ageing rows rather than with closed: it was never
 * remediated, so counting it as a closure would flatter every figure here.
 */
function AgeingPanel({ ageing }) {
  if (!ageing) return null
  const { closed, ageing: rows } = ageing
  if (!closed?.n && !rows?.length) return null

  const days = (v) => (v == null ? '—' : `${v.toLocaleString()}`)
  const worst = Math.max(1, closed?.days || 0, ...rows.map((r) => r.days || 0))

  return (
    <Panel
      title="How long tickets take"
      subtitle="Average days — closed tickets by how long they took, everything else by how long it has been waiting"
      className="mb-5"
    >
      {closed?.n > 0 && (
        <div className="mb-4 rounded-2xl bg-clay-surface/60 p-4 shadow-clay-inset">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-400">
            Average time to close
          </p>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="text-[26px] font-bold leading-none tracking-tight text-emerald-600">
              {days(closed.days)}
            </span>
            <span className="text-[13px] font-semibold text-ink-500">days</span>
            <span className="ml-auto text-[11.5px] text-ink-400">
              across {closed.n.toLocaleString()} closed ticket{closed.n === 1 ? '' : 's'}
            </span>
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <>
          <p className="mb-2.5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-400">
            Average age, still waiting
          </p>
          <div className="space-y-3">
            {rows.map((r) => (
              <div key={r.key}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="flex items-center gap-2 text-[12.5px] font-medium text-ink-700">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: r.color }} />
                    {r.label}
                  </span>
                  <span className="text-[13px] font-bold tabular-nums text-ink-900">
                    {days(r.days)}
                    <span className="ml-1 text-[11px] font-normal text-ink-400">days</span>
                  </span>
                </div>
                <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-clay-100">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.max(2, ((r.days || 0) / worst) * 100)}%`, background: r.color }}
                  />
                </div>
                <p className="mt-1 text-[11px] tabular-nums text-ink-400">
                  {r.n.toLocaleString()} ticket{r.n === 1 ? '' : 's'}
                </p>
              </div>
            ))}
          </div>
        </>
      )}

      <p className="mt-4 text-[11.5px] leading-relaxed text-ink-500">
        Closed tickets are measured raised-to-closed. Everything else is measured raised-to-today,
        so those bars grow on their own until somebody acts — which is the point of showing them.
        <b> Rejected</b> is counted here rather than as a closure: the finding was dismissed, not
        fixed, and folding it into the remediation figures would credit work nobody did.
      </p>
    </Panel>
  )
}

/** Where every ticket stands against its clock. Four states, worst first. */
const SLA_ORDER = [
  { match: /open.*breach/i, name: 'Open, SLA breached', color: '#d03b3b' },
  { match: /clos.*breach/i, name: 'Closed late', color: '#ec835a' },
  { match: /open.*within/i, name: 'Open, within SLA', color: '#fab219' },
  { match: /clos.*within/i, name: 'Closed on time', color: '#0ca30c' },
]

function SlaPanel({ rows, breached, total }) {
  if (!rows?.length) return null
  const seen = new Set()
  const ordered = SLA_ORDER.map((o) => {
    const hit = rows.find((r) => o.match.test(r.name))
    if (hit) seen.add(hit.name)
    return { name: o.name, color: o.color, value: hit?.value || 0 }
  }).filter((r) => r.value)
  const other = rows.filter((r) => !seen.has(r.name)).reduce((n, r) => n + r.value, 0)
  const all = other ? [...ordered, { name: 'Unclassified', color: '#8a8781', value: other }] : ordered
  const sum = all.reduce((n, r) => n + r.value, 0)
  if (!sum) return null

  return (
    <Panel
      title="SLA position"
      subtitle="Every ticket sits in exactly one of these"
      right={
        breached > 0 && total > 0 ? (
          <span className="text-[11.5px] font-semibold text-red-600">
            {Math.round((breached / total) * 100)}% breached
          </span>
        ) : null
      }
    >
      <div className="flex h-7 overflow-hidden rounded-lg">
        {all.map((r) => (
          <div key={r.name} style={{ width: `${(r.value / sum) * 100}%`, background: r.color }} />
        ))}
      </div>
      <div className="mt-4 space-y-2">
        {all.map((r) => (
          <div key={r.name} className="flex items-center gap-2.5 text-[12.5px]">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: r.color }} />
            <span className="text-ink-600">{r.name}</span>
            <span className="ml-auto font-semibold tabular-nums text-ink-900">{r.value.toLocaleString()}</span>
            <span className="w-12 text-right tabular-nums text-ink-400">
              {((r.value / sum) * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </Panel>
  )
}

/** Priority mix. Four ordered tiers, so one hue stepped, not four hues. */
const PRIORITY_STEPS = ['#0d366b', '#256abf', '#5598e7', '#9ec5f4']
const PRIORITY_ORDER = [/code.?red/i, /high/i, /medium/i, /low/i]

function PriorityPanel({ rows }) {
  if (!rows?.length) return null
  const seen = new Set()
  const ranked = PRIORITY_ORDER.map((re, i) => {
    const hit = rows.find((r) => re.test(r.name))
    if (hit) seen.add(hit.name)
    return hit ? { ...hit, color: PRIORITY_STEPS[i] } : null
  }).filter(Boolean)
  const rest = rows.filter((r) => !seen.has(r.name)).map((r) => ({ ...r, color: '#8a8781' }))
  const all = [...ranked, ...rest]
  const max = Math.max(1, ...all.map((r) => r.value))

  return (
    <Panel title="Priority mix" subtitle="Raised at each tier, and how many are still open">
      <div className="space-y-3.5">
        {all.map((r) => (
          <div key={r.name}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[12.5px] font-medium text-ink-700">{r.name}</span>
              <span className="text-[13px] font-bold tabular-nums text-ink-900">{r.value.toLocaleString()}</span>
            </div>
            <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-clay-100">
              <div className="h-full rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: r.color }} />
            </div>
            <p className="mt-1 text-[11px] tabular-nums text-ink-400">{r.open.toLocaleString()} still open</p>
          </div>
        ))}
      </div>
    </Panel>
  )
}

/**
 * What actually fails, in the auditors own words.
 *
 * The most actionable list on the page: a checkpoint failing across the estate
 * is a specification or a supply problem, not a centre problem, and fixing it
 * once is a different and much cheaper kind of work than fixing it two hundred
 * times. This is the list that tells the two apart.
 */
function CheckpointPanel({ rows }) {
  if (!rows?.length) return null
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <Panel
      title="Most-failed checkpoints"
      subtitle="The audit question behind each ticket, most frequent first"
      className="mb-5"
    >
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.name}>
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-[12.5px] leading-snug text-ink-700">{r.name}</span>
              <span className="shrink-0 text-[12.5px] font-bold tabular-nums text-ink-900">
                {r.value.toLocaleString()}
                <span className="ml-1.5 font-normal text-ink-400">{r.open.toLocaleString()} open</span>
              </span>
            </div>
            <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-clay-100">
              <div className="h-full rounded-full bg-brand-500" style={{ width: `${(r.value / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </Panel>
  )
}

/**
 * Every centre in scope, worst first.
 *
 * Capped at fifty on screen, and the cap is STATED: a table that quietly stops
 * at fifty reads as "these are all of them", which is the wrong impression for
 * a watchlist above all other tables.
 */
function Watchlist({ rows, join }) {
  if (!rows?.length) return null
  const shown = rows.slice(0, 50)

  return (
    <Panel
      title="Centre watchlist"
      subtitle="Audit scores and remediation tickets per centre, worst pass rate first"
      className="mb-5"
    >
      <div className="table-crisp max-h-[26rem] overflow-auto">
        <table className="w-full text-left text-[12.5px]">
          <thead className="sticky top-0 bg-clay-surface">
            <tr className="text-[10.5px] uppercase tracking-wide text-ink-400">
              <th className="px-3 py-2">Centre</th>
              <th className="px-3 py-2 text-right">Audits</th>
              <th className="px-3 py-2 text-right">Pass rate</th>
              <th className="px-3 py-2 text-right">Tickets</th>
              <th className="px-3 py-2 text-right">Open</th>
              <th className="px-3 py-2 text-right">SLA breached</th>
              <th className="px-3 py-2 text-right">Code red</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.key} className="border-t border-clay-100">
                <td className="px-3 py-2">
                  <span className="font-medium text-ink-800">{r.site}</span>
                  {(r.city || r.region) && (
                    <span className="ml-1.5 text-[11px] text-ink-400">{r.city || r.region}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-600">{r.audits.toLocaleString()}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {r.passRate == null ? (
                    <span className="text-ink-300">—</span>
                  ) : (
                    <span className={r.passRate >= PASS_MARK ? 'font-semibold text-emerald-600' : 'font-semibold text-red-600'}>
                      {r.passRate}%
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-600">{r.tickets.toLocaleString()}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-700">{r.open.toLocaleString()}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-700">{r.breached.toLocaleString()}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-700">{r.red.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11.5px] leading-relaxed text-ink-500">
        {rows.length > shown.length
          ? `Showing the ${shown.length} worst of ${rows.length.toLocaleString()} centres. `
          : `${rows.length.toLocaleString()} centre${rows.length === 1 ? '' : 's'} in scope. `}
        Audit figures come from the audits question, ticket figures from the findings question,
        joined on the site each row resolved to.
        {join?.total > 0 && join.unmatched > 0 && (
          <>
            {' '}
            {join.unmatched.toLocaleString()} of {join.total.toLocaleString()} rows matched no site
            in your register — give those sites the warehouse&apos;s centre ID in Sites and they
            will join by key instead of by name.
          </>
        )}
      </p>
    </Panel>
  )
}

// ── Pass and fail ────────────────────────────────────────────────────────────

function PassRates({ audits, byGroup, groupLabel, overall, source, isAdmin, onConnect }) {
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
      {/* One panel with a dimension picker, rather than a fixed pair. Region
          and entity are the two this app's own site register fills in, so they
          lead — but an estate of near-identical sites is argued about by city,
          brand and operating model, and hard-coding two of nine meant the other
          seven were not askable at all. Only dimensions the data actually
          carries are offered. */}
      <PassPanel
        title={`Pass percentage by ${groupLabel}`}
        subtitle="On the day of the audit, and at the seven-day re-check"
        rows={byGroup}
      />
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
    // Check counts where the question gave them — "412 of 500 checks" is the
    // most auditable form. Otherwise the AUDIT counts, which exist however the
    // question states its result and were simply missing before: a percentage
    // with nothing behind it is a number a reader has to take on faith.
    if (r?.checks > 0 && name === 'Day of audit') {
      return [`${v}% — ${r.passed.toLocaleString()} of ${r.checks.toLocaleString()} checks passed, ${r.failed.toLocaleString()} failed`, name]
    }
    if (name === 'N+7' && r?.n7Audits > 0) {
      return [`${v}% — ${r.auditsPassed.toLocaleString()} passed, ${r.auditsFailed.toLocaleString()} failed of ${r.n7Audits.toLocaleString()} audits`, name]
    }
    return [`${v}%`, name]
  }

  return (
    <Panel title={title} subtitle={subtitle} className="mb-5">
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

/**
 * The API key is about to expire, or already has.
 *
 * Above everything, and only for an admin, because they are the only person who
 * can act on it. A 401 reaches an ordinary member as "the question could not be
 * run", which is true and useless; this says which of the two things is wrong
 * and puts the fix one click away.
 */
function KeyExpiry({ conn, onConnect }) {
  const age = conn?.keyAge
  if (!age?.set || !conn?.apiKeyMaxAgeDays) return null
  if (!age.stale && !(age.expiresInDays !== null && age.expiresInDays <= 1)) return null

  return (
    <div className={`card mb-5 flex flex-wrap items-center gap-3 p-4 ${age.stale ? 'ring-1 ring-red-200' : ''}`}>
      <AlertTriangle size={16} className={age.stale ? 'text-red-600' : 'text-amber-600'} />
      <div className="min-w-[16rem] flex-1">
        <p className={`text-[12.5px] font-semibold ${age.stale ? 'text-red-700' : 'text-amber-700'}`}>
          {age.stale
            ? 'The Metabase API key has expired'
            : age.expiresInDays === 1 ? 'The Metabase API key expires tomorrow' : 'The Metabase API key expires today'}
        </p>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-500">
          Keys on this instance last {conn.apiKeyMaxAgeDays} day{conn.apiKeyMaxAgeDays === 1 ? '' : 's'}.
          {age.stale
            ? ' Anything on this page is from the last successful refresh. Paste a new key to bring it back.'
            : ' Rotate it now and the dashboard will not stop.'}
        </p>
      </div>
      {onConnect && (
        <button
          type="button"
          onClick={onConnect}
          className="inline-flex items-center gap-2 rounded-2xl bg-clay-surface px-4 py-2.5 text-[12.5px] font-semibold text-ink-700 shadow-clay-sm"
        >
          <Plug size={14} /> Update the key
        </button>
      )}
    </div>
  )
}

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

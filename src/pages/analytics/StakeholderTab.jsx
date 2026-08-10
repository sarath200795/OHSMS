// ─────────────────────────────────────────────────────────────────────────────
// Analytics → Stakeholder Issues.
//
// The number this tab exists for is the crossover: how many customer complaints
// stopped being complaints and reached an authority. A complaint marked
// Resolved that produced an FIR is not resolved in any sense the business cares
// about, and a status column alone would say it was — so the crossover gets the
// first tile and the first panel, and everything below it is context for it.
//
// linkage.js owns the join and the counting. This file only scopes the two
// collections to the sites the viewer may see and arranges what comes back.
//
// THE MONTH RANGE. The two collections are dated by different fields — a
// complaint by when it was raised, a visit by when the incident happened — and
// the range is applied to each record by its own date, independently. The two
// ends of a linked pair can therefore fall in different months, and a complaint
// raised in January whose FIR landed in March drops out of the crossover when
// the range stops at January.
//
// The alternative — keeping a pair whenever either end is in range — was
// rejected because it makes every other number on the page a lie: "3 legal
// issues logged" would include a matter from a month the range excludes, and
// the notice, department and status splits would all count it. Independence is
// the only rule under which every denominator on screen means what it says.
//
// What it costs is reported rather than swallowed: escalatedOutOfRange counts
// the complaints whose matter fell outside the range, so the crossover tile can
// never quietly read zero while the range is doing the work.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from 'react'
import { ArrowRightLeft, MessageSquareWarning, Gavel, ShieldAlert } from 'lucide-react'
import { Badge } from '../../shared/ui'
import {
  DEPARTMENT_BY_KEY, NOTICE_TYPES, NOTICE_BY_KEY, SEVERE_NOTICES,
  ESCALATION_STATUS, ESCALATION_STATUS_BY_KEY, LEGAL_STATUS,
} from '../../modules/stakeholder/lib/constants'
import {
  withLegal, withEscalation, summarise, repeatMembers, legalByEscalation,
} from '../../modules/stakeholder/lib/linkage'
import { monthOf } from './moduleAnalytics'
import { Panel, Stat, NoData, Picker } from './ui'
import Breakdown from './Breakdown'

const clean = (v) => String(v ?? '').trim()

// The constants carry a Tailwind palette name; Breakdown wants a hex. One map
// here rather than a second severity palette invented per chart.
const HEX = { emerald: '#22c55e', blue: '#0ea5e9', amber: '#f59e0b', red: '#ef4444', slate: '#8a7660' }

// Badge speaks brand/gray/green/amber/red/blue/violet, the constants speak
// emerald/slate. Mapped rather than passed through, because an unmapped tone
// falls back to grey and would quietly render "Resolved" the same as "Closed".
const CHIP = { emerald: 'green', slate: 'gray', blue: 'blue', amber: 'amber', red: 'red' }

/**
 * Everything the tab draws, from the two collections and the viewer's sites.
 *
 * Both collections are scoped and filtered together and every panel reads the
 * one result, so nothing on screen can disagree with anything else on screen.
 * The cost is that the crossover only sees links whose BOTH ends survive the
 * scope — the panel says so rather than reporting a smaller number as fact.
 */
// Exported for its tests, which is worth losing fast refresh on this one tab
// for: an aggregation nobody can run in isolation is how a dashboard ends up
// confidently wrong.
// eslint-disable-next-line react-refresh/only-export-components
export function stakeholderAnalytics({
  escalations = [], legalIssues = [], sites = [], siteId = 'all', keepUnplaced = true,
  from = '', to = '',
} = {}) {
  const byId = new Map(sites.map((s) => [s.id, s]))

  // A record pointing at a site the viewer cannot see resolves to nothing, the
  // same as one with no site at all. That keeps `keepUnplaced` the single
  // switch over whether the unplaced are counted, and stops a stale or
  // foreign site id from carrying a count into somebody else's dashboard.
  const place = (r) => {
    const at = clean(r?.scope?.siteId)
    const site = at ? byId.get(at) : null
    return {
      id: site ? site.id : '',
      // The registry is authoritative while the site exists; the name stored on
      // the record is all that is left of one that does not.
      name: site?.name || clean(r?.scope?.siteName) || 'Unassigned',
    }
  }

  const inScope = (r) => {
    const at = place(r)
    if (siteId !== 'all') return at.id === siteId
    return at.id ? true : keepUnplaced
  }

  // Site visibility without the site picker applied, so the month options stay
  // the same set whichever site is chosen. Choices that disappear as you use
  // them make a filter impossible to reason about.
  const visible = (r) => Boolean(place(r).id) || keepUnplaced

  const inRange = (month) => {
    // Undated records survive a range rather than vanishing — a missing date is
    // a data-quality problem to surface, not one to hide. The count of them is
    // returned as `undated` so the number on screen stays explainable.
    if (!month) return true
    if (from && month < from) return false
    if (to && month > to) return false
    return true
  }

  const escScoped = escalations.filter((e) => e && inScope(e))
  const legalScoped = legalIssues.filter((l) => l && inScope(l))
  const esc = escScoped.filter((e) => inRange(monthOf(e.raisedOn)))
  const legal = legalScoped.filter((l) => inRange(monthOf(l.incidentDate)))

  // The union of both collections' months, so a month carrying only a
  // department visit is still offered — the two are dated by different fields
  // and neither collection alone knows the whole calendar.
  const months = [
    ...new Set([
      ...escalations.filter((e) => e && visible(e)).map((e) => monthOf(e.raisedOn)),
      ...legalIssues.filter((l) => l && visible(l)).map((l) => monthOf(l.incidentDate)),
    ]),
  ].filter(Boolean).sort()

  const undated = {
    escalations: esc.filter((e) => !monthOf(e.raisedOn)).length,
    legal: legal.filter((l) => !monthOf(l.incidentDate)).length,
  }
  undated.total = undated.escalations + undated.legal

  const joined = withLegal(esc, legal)
  const summary = summarise(esc, legal)
  const escalated = joined.filter((e) => e.escalated)

  // A complaint whose matter is dated in a month the range excludes reads as
  // "never escalated" everywhere above, which is the one thing this tab must
  // not say by accident. Measured against the site-scoped population rather
  // than the raw one, so this only ever reports the viewer's own range choice
  // and never hints at records at a site they cannot see.
  const linkedInScope = legalByEscalation(legalScoped)
  const escalatedOutOfRange = joined.filter(
    (e) => !e.escalated && (linkedInScope.get(clean(e.id)) || []).length > 0
  ).length

  // Ranked by NOTICE_TYPES position, which runs least to most serious, so the
  // worst matter is the first one read. Ties break on how much is still open.
  const rank = (k) => NOTICE_TYPES.findIndex((n) => n.key === clean(k))
  const crossover = escalated
    .map((e) => ({ ...e, siteLabel: place(e).name }))
    .sort((a, b) => rank(b.worstNotice) - rank(a.worstNotice) || b.openLegal - a.openLegal)

  // Our side says done, the authority's side does not. This is the sentence the
  // tab exists to make: these complaints are off the customer-service list with
  // a notice against them still open.
  const closedButLive = crossover.filter(
    (e) => ['resolved', 'closed'].includes(clean(e.status)) && e.openLegal > 0
  )

  const openSevere = legal.filter(
    (l) => clean(l.status) !== 'closed' && SEVERE_NOTICES.includes(clean(l.noticeType))
  ).length

  // One visit by two departments is one legal issue and two rows here, so these
  // do not add up to the number of legal issues — the panel subtitle says so.
  // Deduped per record: listing a department twice on one visit is a typo, not
  // two visits.
  const deptCount = new Map()
  for (const l of legal) {
    const keys = [...new Set((Array.isArray(l.departments) ? l.departments : []).map(clean).filter(Boolean))]
    for (const k of keys.length ? keys : ['__unrecorded']) deptCount.set(k, (deptCount.get(k) || 0) + 1)
  }
  const byDepartment = [...deptCount.entries()]
    .map(([key, value]) => ({
      key,
      name: key === '__unrecorded' ? 'Not recorded' : DEPARTMENT_BY_KEY[key]?.label || key,
      value,
    }))
    .sort((a, b) => b.value - a.value)

  // Left in NOTICE_TYPES order instead of sorted by count: least to most
  // serious IS the information here, and reordering by frequency would bury a
  // single sealing order under a pile of inspection reports.
  const noticeCount = new Map()
  for (const l of legal) {
    const k = clean(l.noticeType) || 'none'
    noticeCount.set(k, (noticeCount.get(k) || 0) + 1)
  }
  const byNotice = [
    ...NOTICE_TYPES.map((n) => ({ key: n.key, name: n.label, value: noticeCount.get(n.key) || 0, color: HEX[n.tone] })),
    // A notice type this build does not know about still happened. Showing it
    // raw beats dropping it and reporting a mix that is missing a row.
    ...[...noticeCount.entries()]
      .filter(([k]) => !NOTICE_BY_KEY[k])
      .map(([key, value]) => ({ key, name: key, value, color: HEX.slate })),
  ].filter((r) => r.value > 0)

  const byStatus = (rows, defs) => {
    const counts = new Map()
    for (const r of rows) {
      const k = clean(r.status) || 'open'
      counts.set(k, (counts.get(k) || 0) + 1)
    }
    return [
      ...defs.map((s) => ({ key: s.key, name: s.label, value: counts.get(s.key) || 0, color: HEX[s.tone] })),
      ...[...counts.entries()]
        .filter(([k]) => !defs.some((s) => s.key === k))
        .map(([key, value]) => ({ key, name: key, value, color: HEX.slate })),
    ].filter((r) => r.value > 0)
  }

  const escalatedIds = new Set(escalated.map((e) => e.id))
  const repeats = repeatMembers(esc).map((m) => ({
    ...m,
    // A member on their third complaint is one conversation; a member whose
    // complaints keep reaching an authority is a different one entirely.
    escalated: m.escalationIds.filter((id) => escalatedIds.has(id)).length,
  }))

  const bucket = new Map()
  const touch = (r) => {
    const at = place(r)
    const key = at.id || `name:${at.name}`
    if (!bucket.has(key)) bucket.set(key, { key, name: at.name, complaints: 0, escalated: 0, legal: 0, severe: 0 })
    return bucket.get(key)
  }
  for (const e of joined) {
    const b = touch(e)
    b.complaints += 1
    if (e.escalated) b.escalated += 1
  }
  for (const l of legal) {
    const b = touch(l)
    b.legal += 1
    if (SEVERE_NOTICES.includes(clean(l.noticeType))) b.severe += 1
  }
  const bySite = [...bucket.values()].sort(
    (a, b) => b.escalated - a.escalated || b.complaints - a.complaints || b.legal - a.legal
  )

  return {
    summary,
    months,
    undated,
    crossover,
    closedButLive,
    escalatedOutOfRange,
    openSevere,
    byDepartment,
    byNotice,
    escalationStatus: byStatus(esc, ESCALATION_STATUS),
    legalStatus: byStatus(legal, LEGAL_STATUS),
    repeats,
    bySite,
    // A legal issue whose complaint is not in this scope. Under a site filter
    // or a month range that is usually the filter's doing and not a deletion,
    // so the caption is written as "not in this scope" rather than "deleted".
    orphanLegal: withEscalation(legal, esc).filter((l) => l.brokenLink).length,
    // An authority that turned up with no customer complaint behind it.
    standaloneLegal: summary.legal.total - summary.legal.fromEscalation,
  }
}

const REPEATS_SHOWN = 8

export default function StakeholderTab({ escalations, legalIssues, sites, keepUnplaced = true }) {
  const [f, setF] = useState({ siteId: 'all', from: '', to: '' })

  const a = useMemo(
    () => stakeholderAnalytics({ escalations, legalIssues, sites, keepUnplaced, ...f }),
    [escalations, legalIssues, sites, keepUnplaced, f]
  )

  const s = a.summary
  const scoped = f.siteId !== 'all'
  const ranged = Boolean(f.from || f.to)
  const plural = (n, one, many) => (n === 1 ? one : many)

  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }))
  const reset = () => setF({ siteId: 'all', from: '', to: '' })

  // The months as the dropdowns spell them, so the sentence and the control the
  // reader just used say the same thing.
  const rangeLabel = f.from && f.to
    ? (f.from === f.to ? f.from : `${f.from} to ${f.to}`)
    : f.from ? `${f.from} onwards` : `up to ${f.to}`

  const picker = (
    <div className="card mb-5 flex flex-wrap items-end gap-3 p-4">
      <Picker id="sh-site" label="Site" value={f.siteId} onChange={set('siteId')}>
        <option value="all">All sites ({sites.length})</option>
        {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
      </Picker>
      <Picker id="sh-from" label="From" value={f.from} onChange={set('from')}>
        <option value="">Earliest</option>
        {a.months.map((m) => <option key={m} value={m}>{m}</option>)}
      </Picker>
      <Picker id="sh-to" label="To" value={f.to} onChange={set('to')}>
        <option value="">Latest</option>
        {a.months.map((m) => <option key={m} value={m}>{m}</option>)}
      </Picker>
      <button
        type="button"
        onClick={reset}
        className="rounded-2xl bg-clay-surface px-4 py-2.5 text-[12.5px] font-semibold text-ink-700 shadow-clay-sm"
      >
        Reset
      </button>
    </div>
  )

  if (s.escalations.total === 0 && s.legal.total === 0) {
    return (
      <div className="animate-fade-in-up">
        {picker}
        <div className="card px-6 py-14 text-center">
          <p className="text-[15px] font-bold text-ink-900">
            {ranged
              ? 'Nothing in this month range'
              : scoped ? 'Nothing recorded at this site' : 'No stakeholder issues recorded'}
          </p>
          <p className="mx-auto mt-1.5 max-w-[52ch] text-[13px] leading-relaxed text-ink-500">
            {ranged
              ? `Nothing ${scoped ? 'at this site ' : ''}falls in ${rangeLabel}. Widen From and To, or reset the filters — complaints are dated by when they were raised and visits by the date of the incident, so the two can land in different months.`
              : scoped
                ? 'Pick All sites to see the rest, or log a complaint or department visit against this one under Stakeholder Issues.'
                : 'Log a customer escalation or a department visit under Stakeholder Issues — including visits that produced no notice, which is the evidence an inspection happened and passed.'}
          </p>
        </div>
      </div>
    )
  }

  // Every figure below is one of these two populations, so the caveats are
  // stated once here rather than repeated on each panel.
  const crossoverNote = [
    'Worst notice first — the notice served is what the complaint actually became.',
    scoped && 'Both sides are narrowed to this site, so a notice filed against another site will not appear here.',
    ranged && 'Both sides are dated on their own, so a complaint appears here only when the matter it became falls in this range too.',
  ].filter(Boolean).join(' ')

  const orphanCause = ranged && scoped
    ? 'the site filter or the month range excludes it'
    : ranged ? 'the month range excludes it'
      : scoped ? 'the site filter excludes it' : 'it has been deleted'

  const inScopeTotal = s.escalations.total + s.legal.total
  const noteBelowStats = ranged || a.undated.total > 0

  // An empty crossover list says this in its own empty state, so the note under
  // the panel would only repeat it.
  const showSevered = a.escalatedOutOfRange > 0 && a.crossover.length > 0

  return (
    <div className="animate-fade-in-up">
      {picker}

      <div className={`${noteBelowStats ? 'mb-2' : 'mb-5'} grid gap-3 sm:grid-cols-2 lg:grid-cols-4`}>
        <Stat
          icon={ArrowRightLeft}
          label="Reached an authority"
          value={s.escalations.escalatedToLegal}
          sub={`of ${s.escalations.total} ${plural(s.escalations.total, 'complaint', 'complaints')} in scope`}
          tone="#dc2626"
        />
        <Stat
          icon={MessageSquareWarning}
          label="Complaints still open"
          value={s.escalations.open}
          sub="open or in progress"
          tone="#f59e0b"
        />
        <Stat
          icon={Gavel}
          label="Legal issues still open"
          value={s.legal.open}
          sub={`of ${s.legal.total} logged`}
          tone="#0891b2"
        />
        <Stat
          icon={ShieldAlert}
          label="Serious notices open"
          value={a.openSevere}
          sub={`of ${s.legal.severe} served — a reply, a fix or a court date`}
          tone="#b91c1c"
        />
      </div>

      {/* Every figure above has been narrowed, and both reasons mislead if left
          unsaid: which months are in, and which records have no month at all. */}
      {noteBelowStats && (
        <p className="mb-5 text-[11.5px] leading-relaxed text-ink-400">
          {ranged &&
            `Narrowed to ${rangeLabel} — complaints by the date they were raised, department visits by the date of the incident. `}
          {a.undated.total > 0 &&
            `${a.undated.total} of ${inScopeTotal} ${plural(a.undated.total, 'record carries', 'records carry')} no date ` +
            `(${a.undated.escalations} ${plural(a.undated.escalations, 'complaint', 'complaints')}, ` +
            `${a.undated.legal} ${plural(a.undated.legal, 'visit', 'visits')}) and ` +
            `${plural(a.undated.total, 'is', 'are')} counted in every range rather than hidden.`}
        </p>
      )}

      <Panel
        title="Complaints that reached an authority"
        subtitle={crossoverNote}
        right={
          <Badge tone={s.escalations.escalatedToLegal ? 'amber' : 'gray'}>
            {s.escalations.escalatedToLegal} of {s.escalations.total}
          </Badge>
        }
        className={a.orphanLegal > 0 || showSevered ? 'mb-3' : 'mb-5'}
      >
        {a.crossover.length === 0 ? (
          <NoData height={180}>
            {s.escalations.total === 0
              ? 'No complaints in this scope, so nothing here can have crossed over. The legal issues below stand on their own.'
              : a.escalatedOutOfRange > 0
                ? `${a.escalatedOutOfRange} ${plural(a.escalatedOutOfRange, 'complaint', 'complaints')} here reached an authority in a matter dated outside this range. Clear From and To to see ${plural(a.escalatedOutOfRange, 'it', 'them')}.`
                : 'No complaint here has produced a legal issue. The link is recorded on the legal issue — set “From complaint” when logging one so it shows up in this panel.'}
          </NoData>
        ) : (
          <>
            {a.closedButLive.length > 0 && (
              <div className="mb-3 rounded-2xl bg-red-50 px-4 py-3">
                <p className="text-[12.5px] font-bold leading-snug text-red-700">
                  {a.closedButLive.length}{' '}
                  {plural(a.closedButLive.length, 'complaint is', 'complaints are')} marked resolved or closed
                  with a notice still open
                </p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-red-700/80">
                  Off the customer-service list, still live with an authority. The escalation status alone
                  would read {plural(a.closedButLive.length, 'this one', 'these')} as finished.
                </p>
              </div>
            )}
            <ul className="max-h-[400px] space-y-2 overflow-y-auto pr-1">
              {a.crossover.map((e) => {
                const notice = NOTICE_BY_KEY[e.worstNotice]
                const status = ESCALATION_STATUS_BY_KEY[clean(e.status)]
                return (
                  <li
                    key={e.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl bg-clay-surface px-3.5 py-2.5 shadow-clay-inset"
                  >
                    <span className="font-mono text-[11px] text-ink-400">{e.docId || '—'}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink-900">
                      {e.title || 'Untitled complaint'}
                    </span>
                    <span className="truncate text-[11.5px] text-ink-400">{e.siteLabel}</span>
                    <Badge tone={CHIP[status?.tone] || 'gray'}>{status?.label || clean(e.status) || '—'}</Badge>
                    <Badge tone={CHIP[notice?.tone] || 'gray'}>{notice?.label || clean(e.worstNotice) || '—'}</Badge>
                    <span className="text-[11.5px] font-semibold text-ink-500">
                      {e.openLegal > 0
                        ? `${e.openLegal} of ${e.legalCount} open`
                        : `${e.legalCount} ${plural(e.legalCount, 'matter', 'matters')}, all closed`}
                    </span>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </Panel>

      {/* Both ends of a link can be filtered away independently, and either
          direction makes the crossover read as complete when it is not. */}
      {(a.orphanLegal > 0 || showSevered) && (
        <div className="mb-5 space-y-1.5 text-[11.5px] leading-relaxed text-ink-400">
          {a.orphanLegal > 0 && (
            <p>
              {a.orphanLegal} legal {plural(a.orphanLegal, 'issue', 'issues')} here came from a complaint that is
              not in this scope — {orphanCause}. Counted in the panels below, but not in the crossover above.
            </p>
          )}
          {showSevered && (
            <p>
              {a.escalatedOutOfRange} {plural(a.escalatedOutOfRange, 'complaint', 'complaints')} here reached an
              authority in a matter dated outside this range, so {plural(a.escalatedOutOfRange, 'it counts', 'they count')} above
              as never escalated. Clear From and To to see {plural(a.escalatedOutOfRange, 'it', 'them')}.
            </p>
          )}
        </div>
      )}

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Breakdown
          title="Complaints by status"
          subtitle={`${s.escalations.open} of ${s.escalations.total} still open or in progress`}
          rows={a.escalationStatus}
          color="#e8a33d"
        />
        <Breakdown
          title="Legal issues by status"
          subtitle={
            a.standaloneLegal > 0
              ? `${a.standaloneLegal} of ${s.legal.total} had no complaint behind ${plural(a.standaloneLegal, 'it', 'them')}`
              : `${s.legal.open} of ${s.legal.total} still need a response`
          }
          rows={a.legalStatus}
        />
        <Breakdown
          title="Notices served"
          subtitle={`${s.legal.severe} of ${s.legal.total} carry a clock — a reply, a fix or a court date`}
          rows={a.byNotice}
        />
        <Breakdown
          title="Departments that visited"
          subtitle="One visit by two departments counts under both, so these do not add up to the legal issues."
          rows={a.byDepartment}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="By site" subtitle="Where complaints turn into notices">
          {a.bySite.length === 0 ? (
            <NoData height={180}>Nothing recorded in this scope.</NoData>
          ) : (
            <div className="-mx-1 overflow-x-auto">
              <table className="w-full min-w-[420px] text-[12.5px]">
                <thead className="text-left text-[10.5px] uppercase tracking-[0.08em] text-ink-400">
                  <tr>
                    <th className="px-2 py-1.5 font-bold">Site</th>
                    <th className="px-2 py-1.5 text-right font-bold">Complaints</th>
                    <th className="px-2 py-1.5 text-right font-bold">Reached authority</th>
                    <th className="px-2 py-1.5 text-right font-bold">Legal issues</th>
                    <th className="px-2 py-1.5 text-right font-bold">Serious</th>
                  </tr>
                </thead>
                <tbody>
                  {a.bySite.map((row) => (
                    <tr key={row.key} className="border-t border-ink-100">
                      <td className="max-w-[180px] truncate px-2 py-2 font-semibold text-ink-800">{row.name}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-ink-700">{row.complaints}</td>
                      <td className={`px-2 py-2 text-right tabular-nums ${row.escalated ? 'font-bold text-red-700' : 'text-ink-300'}`}>
                        {row.escalated}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-ink-700">{row.legal}</td>
                      <td className={`px-2 py-2 text-right tabular-nums ${row.severe ? 'font-bold text-red-700' : 'text-ink-300'}`}>
                        {row.severe}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        {/* Hand-rolled rather than a Breakdown because the empty state is the
            useful half: "nobody complained twice" is good news and must not be
            reported as "nothing recorded". */}
        <Panel title="Repeat complainants" subtitle="Members appearing in more than one complaint">
          {a.repeats.length === 0 ? (
            <NoData height={180}>
              No member appears in more than one complaint here. Names are read from the members recorded on
              each escalation, so a complaint logged without one cannot be matched to another.
            </NoData>
          ) : (
            <>
              <ul className="space-y-2">
                {a.repeats.slice(0, REPEATS_SHOWN).map((m) => (
                  <li
                    key={m.memberId || m.name}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl bg-clay-surface px-3.5 py-2.5 shadow-clay-inset"
                  >
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink-900">
                      {m.name || m.memberId}
                    </span>
                    {m.name && m.memberId && <span className="font-mono text-[11px] text-ink-400">{m.memberId}</span>}
                    <Badge tone="gray">{m.count} complaints</Badge>
                    {m.escalated > 0 && (
                      <Badge tone="red">{m.escalated} reached an authority</Badge>
                    )}
                  </li>
                ))}
              </ul>
              {a.repeats.length > REPEATS_SHOWN && (
                <p className="mt-2.5 text-[11.5px] text-ink-400">
                  Showing the {REPEATS_SHOWN} most frequent of {a.repeats.length}.
                </p>
              )}
            </>
          )}
        </Panel>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Organization settings → Integrations → Metabase.
//
// The connection form itself is shared with the ODIN tab, which offers the same
// form inline when nothing is connected yet — see shared/integrations/
// MetabaseConnect.jsx for why it lives there rather than here.
//
// What this page adds is the reference: exactly which columns each question
// should return. It is PRINTED rather than buried in documentation because a
// question that returns the right data under a name ODIN does not recognise is
// the commonest way this ends up blank, and it is a thirty-second fix in
// Metabase once you can see the list.
// ─────────────────────────────────────────────────────────────────────────────
import { Database, ExternalLink } from 'lucide-react'
import { Card } from '../../shared/ui'
import MetabaseConnect from '../../shared/integrations/MetabaseConnect'

// Mirrors COLUMN_ALIASES in functions/lib/metabase.js. Kept as prose rather
// than imported: the server file is the authority on the matching, and this is
// the human-readable half — the aliases it accepts are broader than what is
// worth printing on a settings screen.
const FINDINGS_COLUMNS = [
  ['Site', 'site / site_name / location — the site the finding was raised at'],
  ['Region', 'region / zone / area — drives the region-wise status bars'],
  ['Entity', 'entity / business_unit / company — drives the entity-wise pass rates'],
  ['Status', 'status — Open, In Progress, On Hold, Closed (synonyms are matched)'],
  ['Sub-category', 'sub_category — the finding sub-category, charted as bars and a pie'],
  ['Category', 'category — optional, the parent grouping of the sub-category'],
  ['Audit date', 'audit_date / date — the day the finding was raised'],
  ['Closed date', 'closed_date — optional, used for the N+7 closure view'],
  ['Latitude / Longitude', 'optional. Without them a site is placed from your own site register instead'],
  ['Count', 'optional. Include it if the question is already grouped; otherwise one row = one finding'],
  ['Pass / Fail', 'optional. If your findings rows carry check counts, ODIN draws the pass percentages straight from them and no second question is needed'],
]

const AUDIT_COLUMNS = [
  ['Site, Region, Entity', 'the same three columns as the findings question'],
  ['Audit date', 'audit_date — the day of the audit'],
  ['Pass / Fail', 'pass and fail — how many checks passed and how many failed on the day. This is the preferred form: the counts carry the size of the audit'],
  ['Pass N+7 / Fail N+7', 'the same two counts at the seven-day re-check'],
  ['Pass %', 'pass_percentage — use this instead if you only hold the percentage'],
  ['Pass % (N+7)', 'pass_percentage_n7 — the percentage at the seven-day re-check'],
  ['Checks total', 'optional. Supply it when some checks were neither passed nor failed; otherwise pass + fail is the total'],
]

export default function MetabaseSettings({ orgId, actor }) {
  return (
    <div className="max-w-2xl space-y-5">
      <MetabaseConnect orgId={orgId} actor={actor} />

      <Card>
        <h3 className="flex items-center gap-2 font-semibold text-ink-800">
          <Database size={17} className="text-brand-600" /> What each question should return
        </h3>
        <p className="mb-4 mt-1 text-sm text-ink-500">
          Column names are matched case-insensitively and ignore spaces and underscores, so
          <code> Site Name</code>, <code>site_name</code> and <code>SITENAME</code> are the same column.
          Anything ODIN does not recognise is listed on the ODIN tab rather than dropped silently.
        </p>

        <ColumnList title="Findings question (required)" rows={FINDINGS_COLUMNS} />
        <ColumnList title="Audits question (optional)" rows={AUDIT_COLUMNS} className="mt-5" />

        {/* The one distinction that catches people out, said where they will be
            looking when it catches them. */}
        <p className="mt-5 rounded-2xl bg-clay-surface/60 px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-600 shadow-clay-inset">
          <b>Pass</b> and <b>Pass %</b> are different columns. A bare <code>pass</code> beside a bare
          <code> fail</code> is read as a COUNT of checks; <code>pass %</code> is read as a percentage.
          Give ODIN the counts where you have them — they carry how big each audit was, which is what
          lets a region be weighted properly instead of averaging a four-point audit against a
          four-hundred-point one.
        </p>

        <p className="mt-3 flex items-start gap-2 text-[11.5px] leading-relaxed text-ink-400">
          <ExternalLink size={13} className="mt-0.5 flex-none" />
          Each question is run with your API key&apos;s permissions, so it must be readable by the group
          that key belongs to. ODIN reads at most 20,000 rows per question and says so on the dashboard
          when a question returns more — group or filter in Metabase to stay under it.
        </p>
      </Card>
    </div>
  )
}

function ColumnList({ title, rows, className = '' }) {
  return (
    <div className={className}>
      <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-400">{title}</p>
      <dl className="space-y-1.5">
        {rows.map(([name, desc]) => (
          <div key={name} className="flex flex-wrap gap-x-2 rounded-xl bg-clay-surface/60 px-3 py-2 shadow-clay-inset">
            <dt className="text-[12.5px] font-bold text-ink-800">{name}</dt>
            <dd className="text-[12px] text-ink-500">{desc}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

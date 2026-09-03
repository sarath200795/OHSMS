import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Signpost, ShieldCheck, AlertTriangle, Ban, CircleSlash, ClipboardList, Filter, X, ArrowRight, Building2, GitCompareArrows, Copy } from 'lucide-react'
import { PageHeader, EmptyState, Spinner } from '../components/ui'
import ChipRow from '../components/ChipRow'
import { useFleet } from '../context/FleetContext'
import { signageSummary, siteAttributeMap } from '../lib/signageLogic'
import { REGISTERS, registerGapSummary, siteRegisters } from '../lib/siteRegisters'
import { SIGNAGE_CONDITION_COLOR, REGIONS, ENTITIES } from '../lib/constants'
import { HealthBar } from '../components/AssetHealth'
import IncompleteNotice from '../../../shared/ui/IncompleteNotice'

/**
 * Why the site counts on this page and on the extinguisher register differ.
 *
 * There is no single site list in this module: useFleet takes the distinct
 * centre name across five registers, so any site named in ANY of them is a row
 * here. That is deliberate — a site with no signage has to appear or its gap
 * disappears with it — but it leaves two very different things looking
 * identical, and this panel is the only place that tells them apart.
 *
 * A site genuinely missing from a register is work: nobody surveyed it. A site
 * whose name is spelt two ways is a PHANTOM: it sits in the denominator at 0 %
 * forever, so it does not merely miscount sites, it understates compliance and
 * looks exactly like a site that needs attention. Variants are shown first for
 * that reason.
 */
function RegisterGaps({ result }) {
  const variants = result.variants
  const gaps = REGISTERS.filter((r) => result.missing[r.key]?.length)
  if (!variants.length && !gaps.length) return null

  return (
    <div className="card mt-6 p-4">
      <div className="mb-1 flex items-center gap-2">
        <GitCompareArrows size={16} className="text-ink-400" />
        <p className="text-sm font-bold text-ink-900">Where these sites come from</p>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-ink-500">
        {registerGapSummary(result, 'ext') ||
          'Every register names the same sites.'}{' '}
        Site names are free text on each record, not a link to the site register,
        so a name spelt two ways counts as two sites here.
      </p>

      {variants.length > 0 && (
        <div className="mb-4 rounded-xl bg-amber-50 p-3">
          <p className="flex items-center gap-1.5 text-xs font-bold text-amber-900">
            <Copy size={13} />
            {variants.length} site name{variants.length === 1 ? '' : 's'} spelt more than one way
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-amber-800">
            Each of these is one site counted twice. The duplicate reads 0 % here
            and pulls overall coverage down — rename it on the register to fix
            the figure.
          </p>
          <ul className="mt-2 space-y-1">
            {variants.map((v) => (
              <li key={v.key} className="text-[11.5px] text-amber-900">
                {v.names.map((n) => (
                  <span key={n} className="mr-1.5 inline-block rounded bg-white/70 px-1.5 py-0.5 font-semibold">{n}</span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {gaps.map((r) => (
          <div key={r.key} className="rounded-xl bg-clay-50 p-3">
            <p className="text-xs font-bold text-ink-800">
              Not on the {r.name.toLowerCase()} register
              <span className="ml-1.5 font-semibold text-ink-400">
                {result.missing[r.key].length} of {result.totals.any}
              </span>
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-500">
              {result.missing[r.key].slice(0, 12).join(' · ')}
              {result.missing[r.key].length > 12 &&
                ` · and ${result.missing[r.key].length - 12} more`}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

function Stat({ icon: Icon, label, value, color }) {
  return (
    <div className="card flex items-center gap-3 p-4">
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl" style={{ backgroundColor: `${color}1a`, color }}><Icon size={20} /></div>
      <div className="min-w-0"><p className="text-2xl font-extrabold text-ink-900">{value}</p><p className="truncate text-xs font-semibold text-ink-500">{label}</p></div>
    </div>
  )
}

// Coverage as a thin bar — green once a row is whole, amber while it is not.
function Meter({ pct }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-ink-100">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: pct === 100 ? '#16a34a' : pct >= 60 ? '#f59e0b' : '#dc2626' }} />
      </div>
      <span className={`text-xs font-bold ${pct === 100 ? 'text-green-600' : pct >= 60 ? 'text-amber-600' : 'text-red-600'}`}>{pct}%</span>
    </div>
  )
}

const EMPTY_FILTERS = { regions: [], entities: [] }

export default function SignageDashboard() {
  const { signages, sites, extinguishers, aeds, fas, mockDrills, incomplete, loading } = useFleet()
  const [filters, setFilters] = useState(EMPTY_FILTERS)

  const f = filters
  const anyActive = f.regions.length > 0 || f.entities.length > 0
  const toggle = (field, value) =>
    setFilters((prev) => {
      const cur = prev[field]
      return { ...prev, [field]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] }
    })
  const clearFilters = () => setFilters(EMPTY_FILTERS)

  // Region / entity come from the site's assets, exactly as the signage matrix
  // resolves them — the signage records themselves often leave both blank.
  const siteRegion = useMemo(() => siteAttributeMap('region', extinguishers, signages), [extinguishers, signages])
  const siteEntity = useMemo(() => siteAttributeMap('entity', extinguishers, signages), [extinguishers, signages])

  // Sites in scope — kept even with no signage at all, so a site that has never
  // been surveyed reads as 0 % rather than disappearing from the denominator.
  const scopedSites = useMemo(
    () => sites.filter((site) => {
      if (f.regions.length && !f.regions.includes(siteRegion[site])) return false
      if (f.entities.length && !f.entities.includes(siteEntity[site])) return false
      return true
    }),
    [sites, f.regions, f.entities, siteRegion, siteEntity]
  )

  const s = useMemo(() => signageSummary(scopedSites, signages, extinguishers), [scopedSites, signages, extinguishers])

  // Deliberately NOT narrowed by the region / entity filters. The question it
  // answers — why does this page count more sites than the extinguisher
  // register — is about the whole estate, and a filtered answer would move
  // every time somebody touched a chip.
  const registers = useMemo(
    () => siteRegisters({ extinguishers, signages, aeds, fas, mockDrills }),
    [extinguishers, signages, aeds, fas, mockDrills]
  )

  if (loading) return <div className="grid place-items-center py-20"><Spinner size={28} /></div>

  return (
    <div>
      <PageHeader title="Signage Compliance" subtitle="Site-wise signage coverage across every safety signage type" icon={Signpost}>
        <Link to="/equipment/signages" className="btn-soft">Open Signage Register <ArrowRight size={15} /></Link>
      </PageHeader>

      <IncompleteNotice incomplete={incomplete} className="mb-4" />

      {sites.length === 0 ? (
        <EmptyState icon={Signpost} title="No sites yet" hint="Add a site's first signage record to track compliance here."
          action={<Link to="/equipment/signages" className="btn-primary">Go to Signage Register</Link>} />
      ) : (
        <>
          <div className="card mb-4 space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-ink-400"><Filter size={13} /> Filters</span>
              <span className="text-xs text-ink-500">{scopedSites.length} of {sites.length} sites</span>
              {anyActive ? <button className="btn-ghost ml-auto" onClick={clearFilters}><X size={15} /> Clear</button> : null}
            </div>
            <ChipRow label="Region" options={REGIONS} selected={f.regions} onToggle={(v) => toggle('regions', v)} />
            <ChipRow label="Entity" options={ENTITIES} selected={f.entities} onToggle={(v) => toggle('entities', v)} />
          </div>

          {scopedSites.length === 0 ? (
            <EmptyState icon={Filter} title="No sites match your filters" hint="Try clearing or widening the region / entity filters above."
              action={<button className="btn-ghost" onClick={clearFilters}><X size={15} /> Clear filters</button>} />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-6">
                <Stat icon={Building2} label="Sites in scope" value={s.sites} color="#6366f1" />
                <Stat icon={ShieldCheck} label="Overall coverage" value={`${s.compliance}%`} color="#16a34a" />
                <Stat icon={ShieldCheck} label="Fully compliant sites" value={s.fullyCompliant} color="#0ea5e9" />
                <Stat icon={Ban} label="Sites with gaps" value={s.sitesWithGaps} color="#dc2626" />
                <Stat icon={AlertTriangle} label="Signs needing attention" value={s.issue} color="#f59e0b" />
                <Stat icon={ClipboardList} label="Signage records" value={s.records} color="#7c3aed" />
              </div>

              <div className="mt-6 grid gap-6 lg:grid-cols-2">
                <HealthBar
                  title={`Signage status — ${s.cells} checks (${s.sites} sites × ${s.types} types)`}
                  segments={[
                    { label: 'In place', value: s.ok, color: '#16a34a' },
                    { label: 'Needs attention', value: s.issue, color: '#f59e0b' },
                    { label: 'Recorded missing', value: s.missing, color: '#dc2626' },
                    { label: 'Never recorded', value: s.notRecorded, color: '#cbd5e1' },
                  ]}
                />
                <div className="card p-4">
                  <p className="mb-3 text-xs font-bold uppercase tracking-wide text-ink-500">Condition of recorded signage</p>
                  {s.records === 0 ? (
                    <p className="py-6 text-center text-sm text-ink-400">No signage recorded for these sites yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {Object.entries(SIGNAGE_CONDITION_COLOR).map(([cond, color]) => {
                        const n = s.byCondition[cond] || 0
                        const pct = s.records ? Math.round((n / s.records) * 100) : 0
                        return (
                          <div key={cond} className="flex items-center gap-3 text-sm">
                            <span className="flex w-28 shrink-0 items-center gap-1.5 text-ink-600">
                              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} /> {cond}
                            </span>
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100">
                              <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                            </div>
                            <span className="w-14 shrink-0 text-right text-xs font-bold text-ink-800">{n}</span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-6 grid gap-6 lg:grid-cols-2">
                <div className="card overflow-hidden">
                  <p className="border-b border-clay-200/60 px-4 py-3 text-xs font-bold uppercase tracking-wide text-ink-500">By signage type — weakest first</p>
                  <div className="max-h-[420px] overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-clay-100/90 text-left text-[11px] uppercase tracking-wide text-ink-500">
                        <tr><th className="px-4 py-2">Type</th><th className="px-4 py-2 text-center">Sites</th><th className="px-4 py-2 text-center">Gaps</th><th className="px-4 py-2 text-center">Issues</th><th className="px-4 py-2">Coverage</th></tr>
                      </thead>
                      <tbody className="divide-y divide-clay-200/60">
                        {s.byType.map((r) => (
                          <tr key={r.type} className="hover:bg-ink-50/70">
                            <td className="px-4 py-2.5 font-semibold text-ink-800">{r.type}</td>
                            <td className="px-4 py-2.5 text-center text-ink-600">{r.covered}/{s.sites}</td>
                            <td className="px-4 py-2.5 text-center">{r.gaps > 0 ? <span className="font-bold text-red-600">{r.gaps}</span> : <span className="text-ink-400">0</span>}</td>
                            <td className="px-4 py-2.5 text-center">{r.issues > 0 ? <span className="font-bold text-amber-600">{r.issues}</span> : <span className="text-ink-400">0</span>}</td>
                            <td className="px-4 py-2.5"><Meter pct={r.compliance} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="card overflow-hidden">
                  <p className="border-b border-clay-200/60 px-4 py-3 text-xs font-bold uppercase tracking-wide text-ink-500">By site — most gaps first</p>
                  <div className="max-h-[420px] overflow-auto">
                    <table className="w-full min-w-[420px] text-sm">
                      <thead className="sticky top-0 bg-clay-100/90 text-left text-[11px] uppercase tracking-wide text-ink-500">
                        <tr><th className="px-4 py-2">Site</th><th className="px-4 py-2">Region / Entity</th><th className="px-4 py-2 text-center">Gaps</th><th className="px-4 py-2 text-center">Issues</th><th className="px-4 py-2">Coverage</th></tr>
                      </thead>
                      <tbody className="divide-y divide-clay-200/60">
                        {s.bySite.map((r) => (
                          <tr key={r.site} className="hover:bg-ink-50/70">
                            <td className="px-4 py-2.5 font-semibold text-ink-800" title={r.missingTypes.length ? `Missing: ${r.missingTypes.join(', ')}` : 'All signage types covered'}>{r.site}</td>
                            <td className="px-4 py-2.5 text-xs text-ink-500">{[r.region, r.entity].filter(Boolean).join(' · ') || '—'}</td>
                            <td className="px-4 py-2.5 text-center">{r.gaps > 0 ? <span className="font-bold text-red-600">{r.gaps}</span> : <span className="text-green-600">0</span>}</td>
                            <td className="px-4 py-2.5 text-center">{r.issues > 0 ? <span className="font-bold text-amber-600">{r.issues}</span> : <span className="text-ink-400">0</span>}</td>
                            <td className="px-4 py-2.5"><Meter pct={r.compliance} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-500">
                <CircleSlash size={13} /> Coverage counts a signage type as covered once the site has a record saying the sign
                is THERE; the fire-extinguisher sign additionally has to match the site&rsquo;s extinguisher count. Damaged, faded
                and obstructed signs still count as covered — they are listed under Issues. A sign recorded as Missing does not:
                that record is a survey saying the sign is absent.
              </p>
            </>
          )}

          {/* Outside the filtered branch on purpose. This answers "why does
              this page count more sites than the extinguisher register", which
              is a question about the whole estate — an answer that moved every
              time somebody touched a region chip would not be one. */}
          <RegisterGaps result={registers} />
        </>
      )}
    </div>
  )
}

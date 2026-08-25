import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { MapPin, Flame, HeartPulse, BellRing, Boxes, TriangleAlert, ArrowRight } from 'lucide-react'
import { PageHeader, EmptyState, Spinner } from '../components/ui'
import { useFleet } from '../context/FleetContext'
import { useAccessibleSites } from '../../../shared/org/useAccessibleSites'
import { summariseLinkedSites } from '../lib/linkedSites'

// Which registry sites the equipment is actually keyed to. The repository can
// already link unmatched units; this is the other half — what that linking has
// achieved so far, and what is still floating on a free-text name.
//
// Signages are absent on purpose: they carry a center name but no siteId, so
// there is no link to report. Counting them here would inflate every total.

const KINDS = [
  { key: 'ext', label: 'Extinguishers', short: 'Ext', icon: Flame },
  { key: 'aed', label: 'AED', short: 'AED', icon: HeartPulse },
  { key: 'fas', label: 'Fire alarm', short: 'FAS', icon: BellRing },
]

function Stat({ label, value, tone = 'text-ink-900' }) {
  return (
    <div className="card px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-ink-400">{label}</p>
      <p className={`text-2xl font-black ${tone}`}>{value}</p>
    </div>
  )
}

const Count = ({ n }) => (n ? <span className="font-semibold text-ink-800">{n}</span> : <span className="text-ink-300">—</span>)

export default function LinkedSites() {
  const { extinguishers, aeds, fas, loading } = useFleet()
  const sites = useAccessibleSites()

  const summary = useMemo(
    () => summariseLinkedSites({ extinguishers, aeds, fas }, sites),
    [extinguishers, aeds, fas, sites]
  )
  const { linked, empty, unlinked, orphaned, totals } = summary

  if (loading) return <div className="grid place-items-center py-20"><Spinner size={28} /></div>

  return (
    <div>
      <PageHeader
        title="Sites"
        subtitle={`${totals.sitesLinked} of ${totals.sitesTotal} site${totals.sitesTotal === 1 ? '' : 's'} have equipment linked · extinguishers, AEDs and fire-alarm devices`}
        icon={MapPin}
      >
        <Link to="/equipment/repository" className="btn-ghost"><Boxes size={16} /> Repository</Link>
      </PageHeader>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Sites with equipment" value={totals.sitesLinked} />
        <Stat label="Assets linked" value={totals.assetsLinked} />
        <Stat label="Assets not linked" value={totals.assetsUnlinked} tone={totals.assetsUnlinked ? 'text-amber-700' : 'text-ink-900'} />
        <Stat label="Sites with none" value={empty.length} tone={empty.length ? 'text-ink-500' : 'text-ink-900'} />
      </div>

      {linked.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title="No equipment is linked to a site yet"
          hint="Open the repository and use Link to sites to match each unit's center name against the site registry."
        />
      ) : (
        <div className="card mb-5 overflow-hidden">
          <div className="border-b border-clay-200/60 px-4 py-3">
            <p className="font-bold text-ink-900">Linked sites</p>
            <p className="text-xs text-ink-500">Counted by the stored site link, not by the name typed on the asset.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-clay-100/60 text-left text-[11px] uppercase tracking-wide text-ink-400">
                <tr>
                  <th className="px-4 py-2">Site</th>
                  <th className="px-4 py-2">Region</th>
                  <th className="px-4 py-2">Entity</th>
                  {KINDS.map((k) => <th key={k.key} className="px-4 py-2 text-right">{k.short}</th>)}
                  <th className="px-4 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-clay-200/60">
                {linked.map(({ site, counts }) => (
                  <tr key={site.id} className="hover:bg-clay-100/40">
                    <td className="px-4 py-2.5 font-semibold text-ink-900">{site.name || site.id}</td>
                    <td className="px-4 py-2.5 text-ink-500">{site.region || '—'}</td>
                    <td className="px-4 py-2.5 text-ink-500">{site.entity || '—'}</td>
                    {KINDS.map((k) => <td key={k.key} className="px-4 py-2.5 text-right"><Count n={counts[k.key]} /></td>)}
                    <td className="px-4 py-2.5 text-right font-bold text-ink-900">{counts.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {unlinked.length > 0 && (
        <div className="card mb-5 overflow-hidden">
          <div className="flex items-center gap-3 border-b border-clay-200/60 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-bold text-ink-900">Not linked to any site</p>
              <p className="text-xs text-ink-500">
                {totals.assetsUnlinked} asset{totals.assetsUnlinked === 1 ? '' : 's'} across {unlinked.length} center
                name{unlinked.length === 1 ? '' : 's'}. These carry a typed-in name only, so they cannot be picked by site.
              </p>
            </div>
            <Link to="/equipment/repository" className="btn-soft px-3 py-1.5 text-xs">Link them <ArrowRight size={14} /></Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-clay-100/60 text-left text-[11px] uppercase tracking-wide text-ink-400">
                <tr>
                  <th className="px-4 py-2">Center name on the asset</th>
                  {KINDS.map((k) => <th key={k.key} className="px-4 py-2 text-right">{k.short}</th>)}
                  <th className="px-4 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-clay-200/60">
                {unlinked.map(({ centerName, counts }) => (
                  <tr key={centerName} className="hover:bg-clay-100/40">
                    <td className="px-4 py-2.5 text-ink-800">{centerName}</td>
                    {KINDS.map((k) => <td key={k.key} className="px-4 py-2.5 text-right"><Count n={counts[k.key]} /></td>)}
                    <td className="px-4 py-2.5 text-right font-bold text-ink-900">{counts.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {orphaned.length > 0 && (
        <div className="card mb-5 overflow-hidden border border-amber-200">
          <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3">
            <TriangleAlert size={18} className="text-amber-700" />
            <div>
              <p className="font-bold text-amber-900">Linked to a site that is not in your registry</p>
              <p className="text-xs text-amber-800">
                {totals.assetsOrphaned} asset{totals.assetsOrphaned === 1 ? '' : 's'} point at a site id that no longer
                exists, or one outside your site scope. Re-link them from the repository.
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-clay-100/60 text-left text-[11px] uppercase tracking-wide text-ink-400">
                <tr><th className="px-4 py-2">Site id</th><th className="px-4 py-2 text-right">Assets</th></tr>
              </thead>
              <tbody className="divide-y divide-clay-200/60">
                {orphaned.map(({ siteId, counts }) => (
                  <tr key={siteId}>
                    <td className="px-4 py-2.5 font-mono text-xs text-ink-700">{siteId}</td>
                    <td className="px-4 py-2.5 text-right font-bold text-ink-900">{counts.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {empty.length > 0 && (
        <div className="card p-4">
          <p className="font-bold text-ink-900">Sites with no equipment recorded</p>
          <p className="mb-3 text-xs text-ink-500">In the registry and within your scope, but nothing links to them.</p>
          <div className="flex flex-wrap gap-1.5">
            {empty.map((s) => (
              <span key={s.id} className="rounded-xl bg-clay-100 px-2.5 py-1 text-xs text-ink-600">{s.name || s.id}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

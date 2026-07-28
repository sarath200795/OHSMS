import { MapPin } from 'lucide-react'
import { useData } from '../context/DataContext'

/** Compact site selector that drives the org-wide `siteFilter` in DataContext.
 *  Renders nothing when no sites exist yet. */
export default function SiteFilter() {
  const { sites, siteFilter, setSiteFilter } = useData()
  if (!sites.length) return null

  return (
    <div className="relative">
      <MapPin size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
      <select
        value={siteFilter}
        onChange={(e) => setSiteFilter(e.target.value)}
        className="rounded-2xl border border-transparent bg-clay-surface py-2.5 pl-9 pr-8 text-sm font-semibold text-ink-700 shadow-clay-inset outline-none focus:border-brand-300 focus:ring-2 focus:ring-brand-200"
        title="Filter by site"
      >
        <option value="All">All sites</option>
        {sites.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}{s.code ? ` (${s.code})` : ''}
          </option>
        ))}
      </select>
    </div>
  )
}

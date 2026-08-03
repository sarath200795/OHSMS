import { useMemo, useState } from 'react'
import { CloudSun, MapPin, RefreshCw } from 'lucide-react'
import { PageHeader, Card, Select, EmptyState } from '../../../shared/ui'
import { useAccessibleSites, useSiteFacets } from '../../../shared/org/useAccessibleSites'
import { useAllSiteWeather } from '../lib/useAllSiteWeather'
import { BANDS, BAND_LABEL, levelOf } from '../lib/weatherRisk'

// Same five bands as the map bubble, in the clay palette rather than Leaflet's.
const BAND_STYLE = {
  none: { chip: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500', ring: 'border-emerald-200' },
  low: { chip: 'bg-yellow-50 text-yellow-700', dot: 'bg-yellow-500', ring: 'border-yellow-200' },
  moderate: { chip: 'bg-orange-50 text-orange-700', dot: 'bg-orange-500', ring: 'border-orange-200' },
  high: { chip: 'bg-red-50 text-red-700', dot: 'bg-red-500', ring: 'border-red-200' },
  severe: { chip: 'bg-red-900 text-red-50', dot: 'bg-red-300', ring: 'border-red-900' },
}

const mapsLink = (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`

/**
 * Weather risk across every site the viewer can see, worst first.
 *
 * The map answers "what is it like there" one pin at a time. This answers the
 * question a safety lead actually starts the day with: which of my sites should
 * not be doing work at height this morning.
 */
export default function SiteWeather() {
  const sites = useAccessibleSites()
  const { regions, entities } = useSiteFacets(sites)
  const [region, setRegion] = useState('')
  const [entity, setEntity] = useState('')

  const scoped = useMemo(
    () => sites.filter((s) => (!region || s.region === region) && (!entity || s.entity === entity)),
    [sites, region, entity]
  )

  const { byId, done, total } = useAllSiteWeather(scoped)

  const located = scoped.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
  const unmapped = scoped.length - located.length

  // Worst first, and sites still loading sink to the bottom rather than jumping
  // around as each result lands.
  const ordered = useMemo(() => {
    return [...located].sort((a, b) => {
      const la = byId[a.id] ? levelOf(byId[a.id].risk.band) : -1
      const lb = byId[b.id] ? levelOf(byId[b.id].risk.band) : -1
      return lb - la || a.name.localeCompare(b.name)
    })
  }, [located, byId])

  const tally = useMemo(() => {
    const counts = Object.fromEntries(BANDS.map((b) => [b, 0]))
    for (const s of located) {
      const r = byId[s.id]
      if (r) counts[r.risk.band] += 1
    }
    return counts
  }, [located, byId])

  const loading = done < total

  return (
    <div>
      <PageHeader
        title="Weather Risk"
        subtitle="Current conditions at each site, read as occupational risk — heat, wind, lightning, rain, UV and visibility."
        icon={CloudSun}
        actions={
          loading ? (
            <span className="flex items-center gap-1.5 text-sm text-ink-400">
              <RefreshCw size={14} className="animate-spin" /> {done} of {total}
            </span>
          ) : null
        }
      />

      <div className="mb-5 flex flex-wrap gap-2">
        <Select value={region} onChange={(e) => setRegion(e.target.value)} className="w-auto">
          <option value="">All regions</option>
          {regions.map((r) => <option key={r} value={r}>{r}</option>)}
        </Select>
        <Select value={entity} onChange={(e) => setEntity(e.target.value)} className="w-auto">
          <option value="">All entities</option>
          {entities.map((r) => <option key={r} value={r}>{r}</option>)}
        </Select>
      </div>

      {/* Only bands that are actually present — a row of zeroes is noise. */}
      <div className="mb-5 flex flex-wrap gap-2">
        {BANDS.filter((b) => tally[b] > 0).reverse().map((b) => (
          <span key={b} className={`flex items-center gap-2 rounded-2xl px-3.5 py-2 text-sm font-semibold ${BAND_STYLE[b].chip}`}>
            <span className={`h-2 w-2 rounded-full ${BAND_STYLE[b].dot}`} />
            {tally[b]} {BAND_LABEL[b].toLowerCase()}
          </span>
        ))}
      </div>

      {located.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title="No mapped sites"
          description="Weather is read from a site's latitude and longitude. Add coordinates to a site to see its conditions here."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {ordered.map((s) => (
            <SiteCard key={s.id} site={s} result={byId[s.id]} />
          ))}
        </div>
      )}

      {unmapped > 0 && (
        <p className="mt-5 text-sm text-ink-400">
          {unmapped} site{unmapped === 1 ? ' has' : 's have'} no coordinates and cannot be checked.
        </p>
      )}

      <p className="mt-6 text-xs text-ink-300">
        Conditions from Open-Meteo at the nearest ~1 km, refreshed every 15 minutes. Guidance only —
        it does not replace a site assessment.
      </p>
    </div>
  )
}

function SiteCard({ site, result }) {
  if (!result) {
    return (
      <Card className="p-5">
        <p className="text-[15px] font-bold text-ink-900">{site.name}</p>
        <p className="text-xs text-ink-400">{[site.region, site.entity].filter(Boolean).join(' · ') || '—'}</p>
        <p className="mt-4 text-sm italic text-ink-300">Checking conditions…</p>
      </Card>
    )
  }

  const { risk, obs } = result
  const style = BAND_STYLE[risk.band]

  return (
    <Card className={`border-l-4 p-5 ${style.ring}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-bold text-ink-900">{site.name}</p>
          <p className="truncate text-xs text-ink-400">
            {[site.region, site.entity].filter(Boolean).join(' · ') || '—'}
          </p>
        </div>
        <span className={`flex flex-none items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${style.chip}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
          {BAND_LABEL[risk.band]}
        </span>
      </div>

      <p className="mt-2 text-sm text-ink-500">
        {obs.apparentTempC != null ? `Feels like ${Math.round(obs.apparentTempC)}°C` : '—'}
        {obs.windKph != null ? ` · wind ${Math.round(obs.windKph)} km/h` : ''}
      </p>

      {risk.hazards.length === 0 ? (
        <p className="mt-3 text-sm text-ink-400">Nothing here restricts outdoor work.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {risk.hazards.map((h) => (
            <li key={h.key} className="flex gap-2">
              <span className={`mt-1.5 h-1.5 w-1.5 flex-none rounded-full ${BAND_STYLE[h.band].dot}`} />
              <span className="min-w-0">
                <span className="text-[13px] font-semibold text-ink-800">{h.label}</span>
                <span className="text-[13px] text-ink-400"> · {h.value}</span>
                <span className="block text-xs leading-snug text-ink-400">{h.affects}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <a
        href={mapsLink(site.lat, site.lng)}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 hover:underline"
      >
        <MapPin size={13} /> Open location
      </a>
    </Card>
  )
}

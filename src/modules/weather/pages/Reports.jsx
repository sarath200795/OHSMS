import { useMemo } from 'react'
import toast from 'react-hot-toast'
import { CloudSun, AlertTriangle, Ban, ShieldAlert } from 'lucide-react'
import { useAccessibleSites } from '../../../shared/org/useAccessibleSites'
import ModuleReportsPage from '../../../shared/reports/ModuleReportsPage'
import { Stat } from '../../../pages/analytics/ui'
import { BANDS, BAND_LABEL } from '../lib/weatherRisk'
import { useAllSiteWeather } from '../lib/useAllSiteWeather'
import { weatherExportRows, exportWeatherRisk } from '../lib/weatherExport'

export default function Reports() {
  const sites = useAccessibleSites()
  const located = sites.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
  const { byId, done, total } = useAllSiteWeather(located)

  const tally = useMemo(() => {
    const counts = Object.fromEntries(BANDS.map((b) => [b, 0]))
    for (const s of located) {
      const r = byId[s.id]
      if (r) counts[r.risk.band] += 1
    }
    return counts
  }, [located, byId])

  const onExport = () => {
    const rows = weatherExportRows(located, byId)
    if (!rows.length) {
      toast.error('Nothing to export')
      return
    }
    exportWeatherRisk(rows, `weather-risk-${rows.length}-sites.xlsx`)
    toast.success(`Exported ${rows.length} site${rows.length === 1 ? '' : 's'}`)
  }

  return (
    <ModuleReportsPage
      moduleKey="weather"
      subtitle={
        done < total
          ? `Checking weather at ${done} of ${total} mapped sites.`
          : `Occupational weather risk at ${located.length} mapped site${located.length === 1 ? '' : 's'}.`
      }
      onExport={onExport}
      exportLabel="Download workbook"
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat icon={CloudSun} label={BAND_LABEL.none} value={tally.none} tone="#10b981" />
        <Stat icon={CloudSun} label={BAND_LABEL.low} value={tally.low} tone="#eab308" />
        <Stat
          icon={ShieldAlert}
          label={BAND_LABEL.moderate}
          value={tally.moderate}
          tone="#f97316"
        />
        <Stat icon={AlertTriangle} label={BAND_LABEL.high} value={tally.high} tone="#ef4444" />
        <Stat icon={Ban} label={BAND_LABEL.severe} value={tally.severe} tone="#7f1d1d" />
      </div>
    </ModuleReportsPage>
  )
}

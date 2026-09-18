import { AlertTriangle, CheckCircle2, ShieldAlert, ListChecks } from 'lucide-react'
import { toCsv } from '../../../shared/lib/csv'
import { downloadText } from '../../../shared/lib/download'
import ModuleReportsPage from '../../../shared/reports/ModuleReportsPage'
import { Stat } from '../../../pages/analytics/ui'
import { BANDS } from '../lib/riskMatrix'
import { flattenHazards, summarize } from '../lib/raStats'
import { useRa } from '../context/RaContext'

const COLUMNS = [
  { key: 'assessment', label: 'Assessment' },
  { key: 'site', label: 'Site' },
  { key: 'activity', label: 'Activity' },
  { key: 'hazard', label: 'Hazard' },
  { key: 'initial', label: 'Initial risk' },
  { key: 'residual', label: 'Residual risk' },
  { key: 'alarp', label: 'ALARP' },
]

export default function Reports() {
  const { assessments, summary } = useRa()
  const live = (assessments || []).filter((a) => a.kind !== 'baseline')
  const stats = summary || summarize(live)

  const onExport = () => {
    const rows = flattenHazards(live).map((r) => ({
      assessment: r.assessmentName,
      site: r.siteName,
      activity: r.activityTitle,
      hazard: r.hazard?.description || r.hazard?.title || r.hazard?.name || '',
      initial: r.initial?.label || '',
      residual: r.residual?.label || '',
      alarp: r.hazard?.alarp ? 'Yes' : 'No',
    }))
    downloadText(toCsv(rows, COLUMNS), 'hira-report.csv')
  }

  return (
    <ModuleReportsPage
      moduleKey="hira"
      subtitle="Live site risks (baselines excluded). Residual risk keeps ALARP hazards at their initial score."
      onExport={onExport}
    >
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={ShieldAlert}
          label="Assessments"
          value={stats.totalAssessments}
          tone="#0ea5e9"
        />
        <Stat icon={AlertTriangle} label="Hazards" value={stats.totalHazards} tone="#f59e0b" />
        <Stat
          icon={AlertTriangle}
          label="High / critical"
          value={stats.highCritical}
          tone="#dc2626"
          sub="residual risk"
        />
        <Stat
          icon={ListChecks}
          label="Overdue actions"
          value={stats.overdueActions}
          tone="#a855f7"
        />
      </div>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {BANDS.map((b) => (
          <Stat
            key={b.key}
            icon={b.permissible ? CheckCircle2 : AlertTriangle}
            label={b.label}
            value={stats.byBand?.[b.key] || 0}
            tone={b.color}
            sub="residual band"
          />
        ))}
      </div>
      <p className="text-[12.5px] leading-relaxed text-ink-500">
        {stats.alarp} hazard{stats.alarp === 1 ? '' : 's'} marked ALARP, {stats.openActions} open
        control action{stats.openActions === 1 ? '' : 's'}. Permissible (negligible + low):{' '}
        {stats.permissible}.
      </p>
    </ModuleReportsPage>
  )
}

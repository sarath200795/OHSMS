import { useMemo } from 'react'
import { Target, TrendingDown, TrendingUp, CircleDashed } from 'lucide-react'
import { toCsv } from '../../../shared/lib/csv'
import { downloadText } from '../../../shared/lib/download'
import ModuleReportsPage from '../../../shared/reports/ModuleReportsPage'
import IncompleteNotice from '../../../shared/ui/IncompleteNotice'
import { Stat } from '../../../pages/analytics/ui'
import { buildScorecard } from '../lib/kpis'
import { useObjectives } from '../context/ObjectivesContext'

const COLUMNS = [
  { key: 'kpi', label: 'KPI' },
  { key: 'actual', label: 'Actual' },
  { key: 'target', label: 'Target' },
  { key: 'rag', label: 'RAG' },
  { key: 'unit', label: 'Unit' },
]

export default function Reports() {
  const { objectives, data, incomplete } = useObjectives()
  const rows = useMemo(() => buildScorecard(data, objectives, 'org', '', 'all'), [data, objectives])

  const summary = useMemo(() => {
    const counted = rows.filter((r) => r.rag.key !== 'no_data')
    return {
      tracked: counted.length,
      onTrack: counted.filter((r) => r.rag.key === 'on_track').length,
      atRisk: counted.filter((r) => r.rag.key === 'at_risk').length,
      offTrack: counted.filter((r) => r.rag.key === 'off_track').length,
    }
  }, [rows])

  const onExport = () => {
    downloadText(
      toCsv(
        rows.map((r) => ({
          kpi: r.kpi.label,
          actual: r.value ?? '',
          target: r.target ?? '',
          rag: r.rag.label,
          unit: r.kpi.unit,
        })),
        COLUMNS
      ),
      'objectives-report.csv'
    )
  }

  return (
    <ModuleReportsPage
      moduleKey="objectives"
      subtitle="Organisation-level KPI scorecard. Actuals are computed live from the modules that own the data — they are not snapshotted here."
      onExport={onExport}
    >
      <IncompleteNotice incomplete={incomplete} className="mb-5" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Target} label="Tracked KPIs" value={summary.tracked} tone="#0ea5e9" />
        <Stat icon={TrendingUp} label="On track" value={summary.onTrack} tone="#16a34a" />
        <Stat icon={CircleDashed} label="At risk" value={summary.atRisk} tone="#d97706" />
        <Stat icon={TrendingDown} label="Off track" value={summary.offTrack} tone="#dc2626" />
      </div>
    </ModuleReportsPage>
  )
}

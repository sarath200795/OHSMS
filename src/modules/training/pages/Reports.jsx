import { AlertTriangle, BookOpen, GraduationCap, Clock } from 'lucide-react'
import { toCsv } from '../../../shared/lib/csv'
import { downloadText } from '../../../shared/lib/download'
import ModuleReportsPage from '../../../shared/reports/ModuleReportsPage'
import { Stat } from '../../../pages/analytics/ui'
import { useTraining } from '../context/TrainingContext'
import { buildStatusReport, REPORT_COLUMNS, todayISO } from '../lib/status'

export default function Reports() {
  const { records, courses, users, assignments, stats, assignmentStats } = useTraining()

  const onExport = () => {
    const rows = buildStatusReport(users, courses, records, assignments, { to: todayISO() })
    downloadText(toCsv(rows, REPORT_COLUMNS), 'training-status-report.csv')
  }

  return (
    <ModuleReportsPage
      moduleKey="training"
      subtitle="Certification status across the employee × course matrix, plus open assignments. CSV is the same register as Employee Status."
      onExport={onExport}
    >
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={GraduationCap} label="Records" value={stats.total} tone="#0ea5e9" />
        <Stat icon={BookOpen} label="Valid" value={stats.valid} tone="#16a34a" />
        <Stat icon={Clock} label="Expiring soon" value={stats.expiring} tone="#d97706" />
        <Stat icon={AlertTriangle} label="Expired" value={stats.expired} tone="#dc2626" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat icon={Clock} label="Assignments open" value={assignmentStats.open} tone="#0ea5e9" />
        <Stat icon={Clock} label="Due soon" value={assignmentStats.due_soon} tone="#d97706" />
        <Stat icon={AlertTriangle} label="Overdue" value={assignmentStats.overdue} tone="#dc2626" />
      </div>
    </ModuleReportsPage>
  )
}

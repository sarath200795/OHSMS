import { Clock, FileCheck, ShieldAlert, Ban } from 'lucide-react'
import { toCsv } from '../../../shared/lib/csv'
import { downloadText } from '../../../shared/lib/download'
import ModuleReportsPage from '../../../shared/reports/ModuleReportsPage'
import { Stat } from '../../../pages/analytics/ui'
import { dashboardBuckets, STATUS_META } from '../lib/permitStatus'
import { usePermits } from '../context/PermitContext'

const COLUMNS = [
  { key: 'docId', label: 'ID' },
  { key: 'workType', label: 'Work type' },
  { key: 'site', label: 'Site' },
  { key: 'status', label: 'Status' },
  { key: 'date', label: 'Date' },
  { key: 'observations', label: 'Open observations' },
]

export default function Reports() {
  const { permits } = usePermits()
  const buckets = dashboardBuckets(permits)

  const onExport = () => {
    const rows = (permits || []).map((p) => ({
      docId: p.docId || p.id || '',
      workType: p.workType || '',
      site: p.siteName || p.siteId || '',
      status: STATUS_META[p.status]?.label || p.status || '',
      date: p.date || p.validFrom || '',
      observations: p.openUnsafeCount || 0,
    }))
    downloadText(toCsv(rows, COLUMNS), 'permits-report.csv')
  }

  return (
    <ModuleReportsPage
      moduleKey="ptw"
      subtitle="Each permit lands in exactly one bucket. An expired permit is Not Closed, never also In Progress."
      onExport={onExport}
    >
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={FileCheck} label="Awaiting approval" value={buckets.open} tone="#64748b" />
        <Stat icon={Clock} label="In progress" value={buckets.inProgress} tone="#2563eb" />
        <Stat icon={Clock} label="Extended" value={buckets.extended} tone="#7c3aed" />
        <Stat
          icon={ShieldAlert}
          label="Not closed"
          value={buckets.notClosed}
          tone="#dc2626"
          sub={`${buckets.notClosedExtended} extended before expiry`}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Stat
          icon={ShieldAlert}
          label="Open with observations"
          value={buckets.withObservations}
          tone="#ea580c"
        />
        <Stat icon={FileCheck} label="Closed" value={buckets.closed} tone="#334155" />
        <Stat icon={Ban} label="Rejected" value={buckets.rejected} tone="#991b1b" />
      </div>
    </ModuleReportsPage>
  )
}

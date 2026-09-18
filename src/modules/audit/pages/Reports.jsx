import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileSearch, Hourglass } from 'lucide-react'
import { useAuth } from '../../../shared/auth/AuthContext'
import { toCsv } from '../../../shared/lib/csv'
import { downloadText } from '../../../shared/lib/download'
import ModuleReportsPage from '../../../shared/reports/ModuleReportsPage'
import { Stat } from '../../../pages/analytics/ui'
import { subscribeAuditFindings, subscribeAuditPlans } from '../services/auditModule'

const COLUMNS = [
  { key: 'docId', label: 'ID' },
  { key: 'site', label: 'Site' },
  { key: 'status', label: 'Status' },
  { key: 'auditor', label: 'Auditor' },
  { key: 'auditee', label: 'Auditee' },
  { key: 'dept', label: 'Department' },
  { key: 'auditDate', label: 'Date' },
]

export default function Reports() {
  const { orgId } = useAuth()
  const [plans, setPlans] = useState([])
  const [findings, setFindings] = useState([])

  useEffect(() => {
    if (!orgId) return undefined
    const u1 = subscribeAuditPlans(orgId, setPlans)
    const u2 = subscribeAuditFindings(orgId, setFindings)
    return () => {
      u1()
      u2()
    }
  }, [orgId])

  const stats = useMemo(
    () => ({
      plans: plans.length,
      open: findings.filter((a) => a.status === 'Reported').length,
      inProgress: findings.filter((a) => a.status === 'Submitted for Verification').length,
      closed: findings.filter((a) => a.status === 'Closed').length,
      total: findings.length,
    }),
    [plans, findings]
  )

  const onExport = () => {
    const rows = findings.map((r) => ({
      docId: r.docId || r.id || '',
      site: r.siteId || r.taskDetails?.siteId || '',
      status: r.status || '',
      auditor: r.taskDetails?.auditor || '',
      auditee: r.taskDetails?.auditee || '',
      dept: r.taskDetails?.dept || '',
      auditDate: r.auditDate || '',
    }))
    downloadText(toCsv(rows, COLUMNS), 'audit-findings-report.csv')
  }

  return (
    <ModuleReportsPage
      moduleKey="audit"
      subtitle={`${stats.plans} scheduled plan${stats.plans === 1 ? '' : 's'} on the shared organisation database. Finding counts match the in-module dashboard.`}
      onExport={onExport}
    >
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={AlertTriangle} label="Open findings" value={stats.open} tone="#e11d48" />
        <Stat
          icon={Hourglass}
          label="Verification pending"
          value={stats.inProgress}
          tone="#ea580c"
        />
        <Stat icon={CheckCircle2} label="Closed" value={stats.closed} tone="#16a34a" />
        <Stat icon={FileSearch} label="Total audits" value={stats.total} tone="#7c3aed" />
      </div>
    </ModuleReportsPage>
  )
}

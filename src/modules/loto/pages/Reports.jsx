import { useMemo } from 'react'
import { CheckCircle2, FileWarning, Lock, PenLine } from 'lucide-react'
import ModuleReportsPage from '../../../shared/reports/ModuleReportsPage'
import { Stat } from '../../../pages/analytics/ui'
import { PROCEDURE_STATUS, PROCEDURE_STATUS_META, LOCK_STATUS } from '../constants/procedures'
import { useOrgProcedures } from '../hooks/useOrgProcedures'
import { downloadRegisterCsv } from '../utils/registerExport'

export default function Reports() {
  const { procedures } = useOrgProcedures()

  const stats = useMemo(() => {
    const byStatus = Object.fromEntries(Object.values(PROCEDURE_STATUS).map((s) => [s, 0]))
    const byLock = { unlocked: 0, partial: 0, locked: 0 }
    for (const p of procedures) {
      if (p.status in byStatus) byStatus[p.status] += 1
      const lock = p.lockSummary?.status || LOCK_STATUS.UNLOCKED
      if (lock in byLock) byLock[lock] += 1
    }
    return { total: procedures.length, byStatus, byLock }
  }, [procedures])

  return (
    <ModuleReportsPage
      moduleKey="loto"
      subtitle="Procedure lifecycle and lock state from the shared org procedures register — not a module-local database."
      onExport={() => downloadRegisterCsv(procedures)}
      exportLabel="Download register CSV"
    >
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={PenLine}
          label={PROCEDURE_STATUS_META[PROCEDURE_STATUS.DRAFT].label}
          value={stats.byStatus[PROCEDURE_STATUS.DRAFT]}
          tone="#8a7660"
        />
        <Stat
          icon={FileWarning}
          label={PROCEDURE_STATUS_META[PROCEDURE_STATUS.PENDING_APPROVAL].label}
          value={stats.byStatus[PROCEDURE_STATUS.PENDING_APPROVAL]}
          tone="#d97706"
        />
        <Stat
          icon={CheckCircle2}
          label={PROCEDURE_STATUS_META[PROCEDURE_STATUS.APPROVED].label}
          value={stats.byStatus[PROCEDURE_STATUS.APPROVED]}
          tone="#16a34a"
        />
        <Stat
          icon={FileWarning}
          label={PROCEDURE_STATUS_META[PROCEDURE_STATUS.REJECTED].label}
          value={stats.byStatus[PROCEDURE_STATUS.REJECTED]}
          tone="#dc2626"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat icon={Lock} label="Unlocked" value={stats.byLock.unlocked} tone="#8a7660" />
        <Stat icon={Lock} label="Partially locked" value={stats.byLock.partial} tone="#d97706" />
        <Stat icon={Lock} label="Locked out" value={stats.byLock.locked} tone="#dc2626" />
      </div>
      <p className="mt-4 text-[12.5px] text-ink-500">
        {stats.total} procedure{stats.total === 1 ? '' : 's'} in scope.
      </p>
    </ModuleReportsPage>
  )
}

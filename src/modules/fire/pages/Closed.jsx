import { useMemo, useState } from 'react'
import { CheckCircle2, QrCode, Download } from 'lucide-react'
import toast from 'react-hot-toast'
import { PageHeader, EmptyState } from '../components/ui'
import ExtinguisherTable from '../components/ExtinguisherTable'
import ListFilters from '../components/ListFilters'
import { TableSkeleton } from '../components/Skeleton'
import { useFleet } from '../context/FleetContext'
import { emptyFilters, applyListFilters } from '../lib/listFilter'
import { exportExtinguishers } from '../lib/exporter'

export default function Closed() {
  const { closed, loading } = useFleet()
  const today = useMemo(() => new Date(), [])
  const [filters, setFilters] = useState(emptyFilters())

  const visible = useMemo(() => applyListFilters(closed, filters), [closed, filters])

  const doExport = () => {
    if (!visible.length) return toast.error('Nothing to export')
    exportExtinguishers(visible, `refilled-closed-${visible.length}.xlsx`, today)
    toast.success(`Exported ${visible.length} rows`)
  }

  return (
    <div>
      <PageHeader
        title="Refilled & Closed"
        subtitle="Completed refill cycles with updated due dates."
        icon={CheckCircle2}
      >
        <button className="btn-ghost" onClick={doExport}><Download size={16} /> Export</button>
      </PageHeader>

      {closed.length > 0 && <ListFilters filters={filters} onChange={setFilters} />}

      {loading ? (
        <TableSkeleton rows={5} cols={6} />
      ) : closed.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="No closed cycles yet" hint="Completed refills will be recorded here." />
      ) : visible.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="No matches" hint="Try adjusting the filters above." />
      ) : (
        <ExtinguisherTable
          items={visible}
          today={today}
          showDefectChips={false}
          showActionBy
          renderActions={(ext) => (
            <a className="btn-ghost px-2.5 py-1.5 text-xs" href={`/qr/${ext.qrToken}`} target="_blank" rel="noreferrer" title="Public QR">
              <QrCode size={14} />
            </a>
          )}
        />
      )}
    </div>
  )
}

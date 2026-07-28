import { useMemo, useState } from 'react'
import { Truck, CheckCircle2, QrCode, Download } from 'lucide-react'
import toast from 'react-hot-toast'
import { PageHeader, EmptyState, Modal, Spinner } from '../components/ui'
import ExtinguisherTable from '../components/ExtinguisherTable'
import ListFilters from '../components/ListFilters'
import { TableSkeleton } from '../components/Skeleton'
import { useFleet } from '../context/FleetContext'
import { useAuth } from '../context/AuthContext'
import { markRefilledAndClosed } from '../lib/firestore'
import { emptyFilters, applyListFilters } from '../lib/listFilter'
import { exportExtinguishers } from '../lib/exporter'

export default function InProcess() {
  const { inProcess, loading } = useFleet()
  const { orgId, orgName, profile } = useAuth()
  const today = useMemo(() => new Date(), [])
  const [closing, setClosing] = useState(null) // ext being closed
  const [dates, setDates] = useState({ dateOfNextRefill: '', dateOfNextHPT: '' })
  const [busy, setBusy] = useState(false)
  const [filters, setFilters] = useState(emptyFilters())

  const visible = useMemo(() => applyListFilters(inProcess, filters), [inProcess, filters])

  const doExport = () => {
    if (!visible.length) return toast.error('Nothing to export')
    exportExtinguishers(visible, `in-process-${visible.length}.xlsx`, today)
    toast.success(`Exported ${visible.length} rows`)
  }

  const openClose = (ext) => {
    setClosing(ext)
    setDates({ dateOfNextRefill: '', dateOfNextHPT: '' })
  }

  const confirmClose = async () => {
    if (!dates.dateOfNextRefill || !dates.dateOfNextHPT) {
      return toast.error('Enter both new due dates')
    }
    setBusy(true)
    try {
      await markRefilledAndClosed(orgId, orgName, closing.id, dates, profile?.name)
      toast.success('Refilled & closed — dates updated, defects cleared')
      setClosing(null)
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="In Process of Refilling"
        subtitle="Units currently with the vendor. Mark refilled & closed when returned."
        icon={Truck}
      >
        <button className="btn-ghost" onClick={doExport}><Download size={16} /> Export</button>
      </PageHeader>

      {inProcess.length > 0 && <ListFilters filters={filters} onChange={setFilters} />}

      {loading ? (
        <TableSkeleton rows={5} cols={7} />
      ) : inProcess.length === 0 ? (
        <EmptyState icon={Truck} title="None in process" hint="Mark a due extinguisher as received by vendor to start." />
      ) : visible.length === 0 ? (
        <EmptyState icon={Truck} title="No matches" hint="Try adjusting the filters above." />
      ) : (
        <ExtinguisherTable
          items={visible}
          today={today}
          showActionBy
          renderActions={(ext) => (
            <>
              <button className="btn bg-green-600 px-2.5 py-1.5 text-xs text-white hover:bg-green-700" onClick={() => openClose(ext)}>
                <CheckCircle2 size={14} /> Refilled & closed
              </button>
              <a className="btn-ghost px-2.5 py-1.5 text-xs" href={`/qr/${ext.qrToken}`} target="_blank" rel="noreferrer" title="Public QR">
                <QrCode size={14} />
              </a>
            </>
          )}
        />
      )}

      <Modal open={!!closing} onClose={() => setClosing(null)} title="Refilled & Closed">
        <p className="mb-4 text-sm text-ink-600">
          Confirm the refill of <strong>{closing?.serialNo || closing?.type}</strong> and set its new
          due dates. Any active defects will be cleared and the unit reactivated.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">New Next Refill date</label>
            <input type="date" className="input" value={dates.dateOfNextRefill} onChange={(e) => setDates({ ...dates, dateOfNextRefill: e.target.value })} />
          </div>
          <div>
            <label className="label">New Next HPT date</label>
            <input type="date" className="input" value={dates.dateOfNextHPT} onChange={(e) => setDates({ ...dates, dateOfNextHPT: e.target.value })} />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setClosing(null)}>Cancel</button>
          <button className="btn bg-green-600 text-white hover:bg-green-700" onClick={confirmClose} disabled={busy}>
            {busy ? <Spinner size={18} /> : (<><CheckCircle2 size={16} /> Confirm & close</>)}
          </button>
        </div>
      </Modal>
    </div>
  )
}

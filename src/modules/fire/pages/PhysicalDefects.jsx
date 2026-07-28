import { useMemo, useState } from 'react'
import { Wrench, AlertTriangle, QrCode, CheckCircle2, Download, FileText } from 'lucide-react'
import toast from 'react-hot-toast'
import { PageHeader, EmptyState, Modal, Spinner } from '../components/ui'
import ExtinguisherTable from '../components/ExtinguisherTable'
import ReportDefectModal from '../components/ReportDefectModal'
import SubmitQuotationModal from '../components/SubmitQuotationModal'
import ListFilters from '../components/ListFilters'
import { TableSkeleton } from '../components/Skeleton'
import { useFleet } from '../context/FleetContext'
import { useAuth } from '../context/AuthContext'
import { resolveDefects } from '../lib/firestore'
import { emptyFilters, applyListFilters } from '../lib/listFilter'
import { exportExtinguishers } from '../lib/exporter'
import { deriveStatus, hasQuotation } from '../lib/extinguisherLogic'
import { DEFECT_BY_KEY, PHYSICAL_DEFECT_KEYS } from '../lib/constants'

export default function PhysicalDefects() {
  const { physicalDefects, loading } = useFleet()
  const { orgId, orgName, profile } = useAuth()
  const today = useMemo(() => new Date(), [])
  const [reportFor, setReportFor] = useState(null)
  const [quoteFor, setQuoteFor] = useState(null)
  const [resolving, setResolving] = useState(null)
  const [busy, setBusy] = useState(false)
  const [filters, setFilters] = useState(emptyFilters())

  const visible = useMemo(() => applyListFilters(physicalDefects, filters), [physicalDefects, filters])

  const doExport = () => {
    if (!visible.length) return toast.error('Nothing to export')
    exportExtinguishers(visible, `physical-defects-${visible.length}.xlsx`, today)
    toast.success(`Exported ${visible.length} rows`)
  }

  const physical = (ext) => deriveStatus(ext, today).physicalDefects

  const confirmResolve = async () => {
    setBusy(true)
    try {
      // keep any refill-type defects, clear only physical ones
      const remaining = (resolving.physicalDefects || []).filter((k) => !PHYSICAL_DEFECT_KEYS.includes(k))
      await resolveDefects(orgId, orgName, resolving.id, remaining, profile?.name)
      toast.success('Physical defects resolved')
      setResolving(null)
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Physical Defects"
        subtitle="Units with PIN, stand, hose, or handle damage requiring physical repair."
        icon={Wrench}
      >
        <button className="btn-ghost" onClick={doExport}><Download size={16} /> Export</button>
      </PageHeader>

      {physicalDefects.length > 0 && <ListFilters filters={filters} onChange={setFilters} />}

      {loading ? (
        <TableSkeleton rows={5} cols={7} />
      ) : physicalDefects.length === 0 ? (
        <EmptyState icon={Wrench} title="No physical defects" hint="All units are physically intact. 🛠️" />
      ) : visible.length === 0 ? (
        <EmptyState icon={Wrench} title="No matches" hint="Try adjusting the filters above." />
      ) : (
        <ExtinguisherTable
          items={visible}
          today={today}
          renderActions={(ext) => (
            <>
              {hasQuotation(ext) ? (
                <button className="btn bg-green-600 px-2.5 py-1.5 text-xs text-white hover:bg-green-700" onClick={() => setResolving(ext)} title="Quotation submitted — resolve defects">
                  <CheckCircle2 size={14} /> Resolve
                </button>
              ) : (
                <button className="btn bg-cyan-600 px-2.5 py-1.5 text-xs text-white hover:bg-cyan-700" onClick={() => setQuoteFor(ext)} title="Submit a vendor quotation before resolving">
                  <FileText size={14} /> Submit quotation
                </button>
              )}
              {hasQuotation(ext) && (
                ext.quotation?.fileData ? (
                  <a href={ext.quotation.fileData} target="_blank" rel="noreferrer" className="chip bg-cyan-50 text-cyan-700 hover:underline" title={`Quoted ${ext.quotation?.amount ?? ''} · ${ext.quotation?.vendor || ''} — view document`}>
                    <CheckCircle2 size={12} /> Quoted · View
                  </a>
                ) : (
                  <span className="chip bg-cyan-50 text-cyan-700" title={`Quoted ${ext.quotation?.amount ?? ''} · ${ext.quotation?.vendor || ''}`}>
                    <CheckCircle2 size={12} /> Quoted
                  </span>
                )
              )}
              <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => setReportFor(ext)} title="Report another defect">
                <AlertTriangle size={14} />
              </button>
              <a className="btn-ghost px-2.5 py-1.5 text-xs" href={`/qr/${ext.qrToken}`} target="_blank" rel="noreferrer" title="Public QR">
                <QrCode size={14} />
              </a>
            </>
          )}
        />
      )}

      <ReportDefectModal
        open={!!reportFor}
        onClose={() => setReportFor(null)}
        ext={reportFor}
        orgId={orgId}
        reporter={{ uid: profile?.uid, name: profile?.name }}
      />

      <SubmitQuotationModal
        open={!!quoteFor}
        onClose={() => setQuoteFor(null)}
        ext={quoteFor}
        orgId={orgId}
        orgName={orgName}
        actor={{ uid: profile?.uid, name: profile?.name }}
      />

      <Modal open={!!resolving} onClose={() => setResolving(null)} title="Resolve physical defects">
        {resolving && (
          <>
            <p className="text-sm text-ink-600">
              Mark these physical defects on <strong>{resolving.serialNo || resolving.type}</strong> as repaired?
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {physical(resolving).map((k) => (
                <span key={k} className="chip" style={{ backgroundColor: `${DEFECT_BY_KEY[k].color}1a`, color: DEFECT_BY_KEY[k].color }}>
                  {DEFECT_BY_KEY[k].label}
                </span>
              ))}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setResolving(null)}>Cancel</button>
              <button className="btn bg-green-600 text-white hover:bg-green-700" onClick={confirmResolve} disabled={busy}>
                {busy ? <Spinner size={18} /> : 'Mark resolved'}
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}

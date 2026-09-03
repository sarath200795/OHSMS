import { useMemo, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Boxes, Download, Trash2, QrCode, AlertTriangle, Filter, Pencil, CheckCircle2, Truck, FileText, CalendarX, Plus, Upload, Gauge } from 'lucide-react'
import toast from 'react-hot-toast'
import { PageHeader, EmptyState, Modal, Spinner } from '../components/ui'
import { TableSkeleton } from '../components/Skeleton'
import ExtinguisherTable from '../components/ExtinguisherTable'
import ReportDefectModal from '../components/ReportDefectModal'
import EditExtinguisherModal from '../components/EditExtinguisherModal'
import LinkSitesModal from '../components/LinkSitesModal'
import SubmitQuotationModal from '../components/SubmitQuotationModal'
import SubmitHptModal from '../components/SubmitHptModal'
import AttachmentChips from '../components/AttachmentChips'
import ListFilters from '../components/ListFilters'
import { useAuth } from '../context/AuthContext'
import { useFleet } from '../context/FleetContext'
import { deriveStatus, isToBeRefilled, hasQuotation, hasDateIssue } from '../lib/extinguisherLogic'
import { requiredStep, WORKFLOW_STEP } from '../lib/hpt'
import { exportExtinguishers } from '../lib/exporter'
import { bulkDeleteExtinguishers, markReceivedByVendor, resolveDefects, backfillExtinguisherQr, linkExtinguishersToSites } from '../lib/firestore'
import { planSiteLinks } from '../lib/siteLink'
import { listLinkedAssets, filterByLinkState, siteIdSet, isLinkedToSite } from '../lib/linkedSites'
import LinkStateChips from '../components/LinkStateChips'
import { useAccessibleSites } from '../../../shared/org/useAccessibleSites'
import { emptyFilters, applyListFilters, hasActiveFilters } from '../lib/listFilter'
import { CATEGORY_LIST, PHYSICAL_DEFECT_KEYS } from '../lib/constants'
import { readableOnTint, solidBackground } from '../../../shared/lib/contrast'

export default function Repository() {
  const { org, extinguishers, loading, capped, loadCap } = useFleet()
  const { orgId, orgName, profile } = useAuth()
  const navigate = useNavigate()
  const today = useMemo(() => new Date(), [])

  // All filtering is client-side over the in-memory fleet — no queries, no
  // composite-index combinatorics, every matching row present at once.
  const [filters, setFilters] = useState(emptyFilters())
  const [activeCats, setActiveCats] = useState(new Set())
  const [onlyIssues, setOnlyIssues] = useState(false)

  // Units with a missing/invalid refill or HPT date — a data-quality problem to fix.
  const issueCount = useMemo(() => extinguishers.filter(hasDateIssue).length, [extinguishers])

  const [selected, setSelected] = useState(new Set())
  const [reportFor, setReportFor] = useState(null)
  const [quoteFor, setQuoteFor] = useState(null)
  const [hptFor, setHptFor] = useState(null)
  const [editFor, setEditFor] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linking, setLinking] = useState(false)
  const [linkTab, setLinkTab] = useState('linked')
  const [linkState, setLinkState] = useState(null)

  // Equipment came from a system with free-text site names; linking attaches
  // each asset to the site registry and takes its entity from there. Declared
  // here because the row filter below narrows by link state.
  const orgSites = useAccessibleSites()

  // Attribute filters + search (shared bar) then condition-chip narrowing.
  const visible = useMemo(() => {
    let list = applyListFilters(extinguishers, filters)
    if (activeCats.size) {
      list = list.filter((e) => {
        const cats = new Set(deriveStatus(e, today).categories)
        for (const c of activeCats) if (!cats.has(c)) return false
        return true
      })
    }
    if (onlyIssues) list = list.filter(hasDateIssue)
    list = filterByLinkState(list, orgSites, linkState)
    return list
  }, [extinguishers, filters, activeCats, onlyIssues, today, orgSites, linkState])

  // Paging is ExtinguisherTable's job now, and handing it the FULL filtered set
  // rather than a pre-cut page is what makes select-all correct.
  //
  // This page used to slice its own 20 rows and pass only those. The table's
  // header checkbox reports back the ids of whatever it was given, and
  // toggleAll below replaces the selection with them — so "select all" quietly
  // meant "select these twenty", and Delete / Export / Print QR then covered
  // twenty of however many were filtered. It also wiped any selection built up
  // across pages. Nothing said so; the count beside the toolbar just read 20.

  // ── Inline workflow actions (the realtime fleet listener refreshes rows) ──
  const sendToVendor = async (ext) => {
    setBusyId(ext.id)
    try {
      await markReceivedByVendor(orgId, orgName, ext.id, profile?.name)
      toast.success('Marked received by vendor — now In Process')
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusyId(null)
    }
  }
  const resolvePhysical = async (ext) => {
    setBusyId(ext.id)
    try {
      const remaining = (ext.physicalDefects || []).filter((k) => !PHYSICAL_DEFECT_KEYS.includes(k))
      await resolveDefects(orgId, orgName, ext.id, remaining, profile?.name)
      toast.success('Physical defects resolved')
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusyId(null)
    }
  }

  const toggleCat = (key) => setActiveCats((prev) => {
    const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next
  })
  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
  })
  const toggleAll = (ids) => setSelected((prev) => {
    const allOn = ids.every((id) => prev.has(id)); return allOn ? new Set() : new Set(ids)
  })

  const selectedItems = visible.filter((e) => selected.has(e.id))

  const doExport = () => {
    const list = selected.size ? selectedItems : visible
    if (!list.length) return toast.error('Nothing to export')
    exportExtinguishers(list, `extinguishers-${Date.now()}.xlsx`, today)
    toast.success(`Exported ${list.length} rows`)
  }
  // Assets imported before the QR system carry no token, so they cannot be
  // printed or scanned until one is minted.
  const missingQr = extinguishers.filter((e) => !e.qrToken && !e.deletedAt).length

  const linkPlan = useMemo(
    () => (orgSites.length ? planSiteLinks(extinguishers, orgSites) : null),
    [extinguishers, orgSites]
  )

  // The units already attached to a site — the other half of the question the
  // link button answers, and the only half left once the linking has run.
  const linkedRows = useMemo(() => listLinkedAssets(extinguishers, orgSites), [extinguishers, orgSites])

  // Counts for the link-state chips, over the whole register rather than the
  // filtered view — a chip that renumbered itself as you filtered would be
  // reporting the filter back to you.
  const linkCounts = useMemo(() => {
    const ids = siteIdSet(orgSites)
    let linked = 0
    for (const e of extinguishers) if (isLinkedToSite(e, ids)) linked += 1
    return { linked, unlinked: extinguishers.length - linked }
  }, [extinguishers, orgSites])

  const doLinkSites = async () => {
    if (!linkPlan?.linked.length) return
    setLinking(true)
    try {
      const r = await linkExtinguishersToSites(orgId, orgName, linkPlan, { uid: profile?.uid, name: profile?.name })
      toast.success(`${r.linked} linked to sites · ${r.entityChanges} entity value(s) corrected`)
      setLinkOpen(false)
    } catch (err) {
      toast.error(err?.message || 'Could not link to sites')
    } finally {
      setLinking(false)
    }
  }

  const doGenerateQr = async () => {
    try {
      const n = await backfillExtinguisherQr(orgId, orgName, extinguishers, { uid: profile?.uid, name: profile?.name })
      toast.success(n ? `QR codes generated for ${n} extinguisher(s)` : 'Every extinguisher already has a QR code')
    } catch (err) {
      toast.error(err?.message || 'Could not generate QR codes')
    }
  }

  const doPrint = () => {
    const ids = selected.size ? Array.from(selected) : visible.map((e) => e.id)
    navigate('/equipment/qr-print', { state: { ids } })
  }
  const doDelete = async () => {
    setDeleting(true)
    try {
      const items = selectedItems.map((e) => ({ id: e.id, qrToken: e.qrToken }))
      await bulkDeleteExtinguishers(orgId, items, { uid: profile?.uid, name: profile?.name })
      toast.success(`Deleted ${items.length} extinguishers`)
      setSelected(new Set())
      setConfirmDelete(false)
    } catch (e) {
      toast.error(e.message)
    } finally {
      setDeleting(false)
    }
  }

  const filtersActive = hasActiveFilters(filters) || activeCats.size > 0 || onlyIssues

  const countLabel = loading
    ? 'Loading…'
    : `${visible.length}${filtersActive ? ` of ${extinguishers.length}` : ''} extinguisher${visible.length === 1 ? '' : 's'}${capped ? ` · showing most recent ${loadCap}` : ''}`

  return (
    <div>
      <PageHeader title="Repository" subtitle={countLabel} icon={Boxes}>
        <Link to="/equipment/add" className="btn-primary"><Plus size={16} /> Add extinguisher</Link>
        <Link to="/equipment/bulk-upload" className="btn-soft"><Upload size={16} /> Bulk upload</Link>
        <button className="btn-ghost" onClick={doExport}><Download size={16} /> Export</button>
        <button className="btn-ghost" onClick={doPrint}><QrCode size={16} /> Print QR</button>
        <button
          className={linkPlan?.linked.length ? 'btn-soft !bg-brand-100 !text-brand-800' : 'btn-ghost'}
          onClick={() => { setLinkTab(linkPlan?.linked.length ? 'pending' : 'linked'); setLinkOpen(true) }}
          title="Which units are attached to a site, and which can still be matched to one"
        >
          <Boxes size={16} />
          {linkPlan?.linked.length ? `Link ${linkPlan.linked.length} to sites` : `Site links (${linkedRows.length})`}
        </button>
        {missingQr > 0 && (
          <button className="btn-soft !bg-amber-100 !text-amber-900" onClick={doGenerateQr}
            title="These assets have no QR code, so they cannot be printed or scanned">
            <QrCode size={16} /> Generate {missingQr} missing QR
          </button>
        )}
      </PageHeader>

      {/* Filters (client-side; all matching rows shown at once) */}
      <ListFilters
        filters={filters}
        onChange={setFilters}
        showStatus
        searchPlaceholder="Search serial, center or type…"
      >
        <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 pt-3">
          <span className="flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-ink-400">
            <Filter size={13} /> Condition
          </span>
          {CATEGORY_LIST.map((c) => {
            const on = activeCats.has(c.key)
            return (
              <button
                key={c.key}
                onClick={() => toggleCat(c.key)}
                className="chip transition"
                style={on ? { backgroundColor: solidBackground(c.color), color: '#fff' } : { backgroundColor: `${c.color}1a`, color: readableOnTint(c.color) }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: on ? '#fff' : c.color }} />
                {c.label}
              </button>
            )
          })}
          <LinkStateChips
            value={linkState}
            onChange={setLinkState}
            linkedCount={linkCounts.linked}
            unlinkedCount={linkCounts.unlinked}
          />
          {issueCount > 0 && (
            <button
              onClick={() => setOnlyIssues((v) => !v)}
              className={`chip transition ${onlyIssues ? 'bg-amber-700 text-white' : 'bg-amber-100 text-amber-700 hover:bg-amber-200'}`}
              title="Units with a missing or invalid refill/HPT date"
            >
              <CalendarX size={13} /> Date issues ({issueCount})
            </button>
          )}
        </div>
      </ListFilters>

      {/* Bulk action bar */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl bg-ink-950 px-4 py-3 text-white"
          >
            <span className="font-bold">{selected.size} selected</span>
            <div className="ml-auto flex flex-wrap gap-2">
              <button className="btn bg-white/10 text-white hover:bg-white/20" onClick={doExport}><Download size={15} /> Export</button>
              <button className="btn bg-white/10 text-white hover:bg-white/20" onClick={doPrint}><QrCode size={15} /> Print QR</button>
              <button className="btn-danger" onClick={() => setConfirmDelete(true)}><Trash2 size={15} /> Delete</button>
              <button className="btn bg-white/10 text-white hover:bg-white/20" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <TableSkeleton rows={8} cols={8} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title={extinguishers.length ? 'No matches' : 'No extinguishers yet'}
          hint={extinguishers.length ? 'Try adjusting the filters above.' : 'Add one or bulk upload to get started.'}
          action={filtersActive ? (
            <button className="btn-ghost" onClick={() => { setFilters(emptyFilters()); setActiveCats(new Set()); setOnlyIssues(false) }}>Clear filters</button>
          ) : undefined}
        />
      ) : (
        <>
        <ExtinguisherTable
          items={visible}
          today={today}
          selectable
          selectedIds={selected}
          onToggle={toggle}
          onToggleAll={toggleAll}
          showActionBy
            renderActions={(ext) => {
              const d = deriveStatus(ext, today)
              const canResolve = d.hasPhysicalDefect && !d.isClosed
              const canSendToVendor = isToBeRefilled(ext, today) && !d.inProcess && !d.isClosed
              const quoted = hasQuotation(ext)
              // A unit whose hydrostatic test is due is asked for the TEST, not
              // for a quotation — the same branch RefillDue and PhysicalDefects
              // make. An HPT can condemn the cylinder, so it settles whether
              // there is anything worth quoting for; and it outranks BOTH the
              // paths here, because a cylinder that has not passed can neither
              // be refilled nor returned to service with its defect repaired.
              const step = requiredStep(ext, today)
              const hptDue = step === WORKFLOW_STEP.HPT
              const needsQuote = (canResolve || canSendToVendor) && !quoted && !hptDue
              return (
                <>
                  {(canResolve || canSendToVendor) && hptDue && (
                    <button
                      className="btn bg-violet-600 px-2.5 py-1.5 text-xs text-white hover:bg-violet-700"
                      onClick={() => setHptFor(ext)}
                      title={`Hydrostatic test due ${ext.dateOfNextHPT || ''} — record the test and its certificate before this can move forward`}
                    >
                      <Gauge size={14} /> Submit HPT
                    </button>
                  )}
                  {needsQuote && (
                    <button className="btn bg-cyan-700 px-2.5 py-1.5 text-xs text-white hover:bg-cyan-800" onClick={() => setQuoteFor(ext)} title="Submit a vendor quotation before this can move forward">
                      <FileText size={14} /> Submit quotation
                    </button>
                  )}
                  {canResolve && quoted && (
                    <button className="btn bg-green-600 px-2.5 py-1.5 text-xs text-white hover:bg-green-700" disabled={busyId === ext.id} onClick={() => resolvePhysical(ext)} title="Resolve physical defects">
                      <CheckCircle2 size={14} /> Resolve
                    </button>
                  )}
                  {canSendToVendor && quoted && (
                    <button className="btn-soft px-2.5 py-1.5 text-xs" disabled={busyId === ext.id} onClick={() => sendToVendor(ext)} title="Mark received by vendor (In Process)">
                      <Truck size={14} /> Send to vendor
                    </button>
                  )}
                  {/* No longer gated on (canResolve || canSendToVendor). A
                      document already filed against a cylinder is worth seeing on
                      every row, not only while the unit is mid-workflow — the
                      gate is what a reviewer is looking for AFTER the work is
                      closed, which is exactly when the old condition hid it. */}
                  <AttachmentChips ext={ext} />
                  <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => setEditFor(ext)} title="Edit details">
                    <Pencil size={14} />
                  </button>
                  <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => setReportFor(ext)} title="Report defect">
                    <AlertTriangle size={14} />
                  </button>
                  <a className="btn-ghost px-2.5 py-1.5 text-xs" href={`/qr/${ext.qrToken}`} target="_blank" rel="noreferrer" title="Open public QR page">
                    <QrCode size={14} />
                  </a>
                </>
              )
            }}
        />
        </>
      )}

      <LinkSitesModal
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        plan={linkPlan}
        linkedRows={linkedRows}
        initialTab={linkTab}
        onConfirm={doLinkSites}
        busy={linking}
      />

      <ReportDefectModal
        open={!!reportFor}
        onClose={() => setReportFor(null)}
        ext={reportFor}
        orgId={orgId}
        reporter={{ uid: profile?.uid, name: profile?.name }}
        source="portal"
      />

      <EditExtinguisherModal
        open={!!editFor}
        onClose={() => setEditFor(null)}
        ext={editFor}
        orgId={orgId}
        orgName={org?.name || orgName}
        actor={{ uid: profile?.uid, name: profile?.name }}
      />

      <SubmitQuotationModal
        open={!!quoteFor}
        onClose={() => setQuoteFor(null)}
        ext={quoteFor}
        orgId={orgId}
        orgName={org?.name || orgName}
        actor={{ uid: profile?.uid, name: profile?.name }}
      />

      <SubmitHptModal
        open={!!hptFor}
        onClose={() => setHptFor(null)}
        ext={hptFor}
        orgId={orgId}
        orgName={org?.name || orgName}
        actor={{ uid: profile?.uid, name: profile?.name }}
      />

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete extinguishers?">
        <p className="text-sm text-ink-600">
          This moves <strong>{selected.size}</strong> extinguisher(s) to the Recycle Bin (restorable for
          30 days) and removes their QR codes.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setConfirmDelete(false)}>Cancel</button>
          <button className="btn-danger" onClick={doDelete} disabled={deleting}>
            {deleting ? <Spinner size={18} /> : (<><Trash2 size={16} /> Delete {selected.size}</>)}
          </button>
        </div>
      </Modal>
    </div>
  )
}

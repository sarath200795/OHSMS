import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { format } from 'date-fns'
import { Trash2, RotateCcw, AlertTriangle, Download, Database } from 'lucide-react'
import toast from 'react-hot-toast'
import { PageHeader, EmptyState, Modal, Spinner, Badge } from '../components/ui'
import { useFleet } from '../context/FleetContext'
import { useAuth } from '../context/AuthContext'
import { restoreExtinguisher, purgeExtinguisher } from '../lib/firestore'
import { downloadJsonBackup } from '../lib/exporter'
import { toDate } from '../lib/extinguisherLogic'

const PURGE_AFTER_DAYS = 30

export default function RecycleBin() {
  const { deletedExtinguishers, extinguishers, reports, users, org } = useFleet()
  const { orgId, orgName, profile } = useAuth()
  const actor = { uid: profile?.uid, name: profile?.name }
  const [busyId, setBusyId] = useState(null)
  const [purgeFor, setPurgeFor] = useState(null)
  const [busy, setBusy] = useState(false)

  const fmt = (v) => {
    const d = toDate(v)
    return d ? format(d, 'dd MMM yyyy, HH:mm') : '—'
  }
  const daysLeft = (v) => {
    const d = toDate(v)
    if (!d) return PURGE_AFTER_DAYS
    const elapsed = Math.floor((Date.now() - d.getTime()) / 86400000)
    return Math.max(0, PURGE_AFTER_DAYS - elapsed)
  }

  const rows = useMemo(
    () => [...deletedExtinguishers].sort((a, b) => (toDate(b.deletedAt) || 0) - (toDate(a.deletedAt) || 0)),
    [deletedExtinguishers]
  )

  const restore = async (ext) => {
    setBusyId(ext.id)
    try {
      await restoreExtinguisher(orgId, org?.name || orgName, ext.id, actor)
      toast.success('Extinguisher restored')
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusyId(null)
    }
  }

  const confirmPurge = async () => {
    setBusy(true)
    try {
      await purgeExtinguisher(orgId, purgeFor.id, purgeFor.qrToken, actor, purgeFor.serialNo || purgeFor.type)
      toast.success('Permanently deleted')
      setPurgeFor(null)
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  const downloadBackup = () => {
    const snapshot = {
      exportedAt: new Date().toISOString(),
      org: org || null,
      extinguishers: [...extinguishers, ...deletedExtinguishers],
      reports,
      users,
    }
    downloadJsonBackup(snapshot, `fire-marshal-backup-${new Date().toISOString().slice(0, 10)}.json`)
    toast.success('Backup downloaded')
  }

  return (
    <div>
      <PageHeader
        title="Recycle Bin"
        subtitle={`Soft-deleted extinguishers — restore, or purge permanently. Auto-purged after ${PURGE_AFTER_DAYS} days.`}
        icon={Trash2}
      >
        <button className="btn-ghost" onClick={downloadBackup} title="Download a full JSON backup">
          <Database size={16} /> Download backup
        </button>
      </PageHeader>

      {rows.length === 0 ? (
        <EmptyState icon={Trash2} title="Recycle bin is empty" hint="Deleted extinguishers can be restored here before they're purged." />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-3">Serial / Type</th>
                  <th className="px-4 py-3">Center</th>
                  <th className="px-4 py-3">Deleted by</th>
                  <th className="px-4 py-3">Deleted</th>
                  <th className="px-4 py-3">Auto-purge</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-clay-200/60">
                {rows.map((ext) => {
                  const left = daysLeft(ext.deletedAt)
                  return (
                    <tr key={ext.id} className="hover:bg-clay-100/50" style={{ boxShadow: 'inset 4px 0 0 #dc2626' }}>
                      <td className="px-4 py-3">
                        <div className="font-bold text-ink-900">{ext.serialNo || '—'}</div>
                        <div className="text-xs text-ink-500">{ext.type} · {ext.capacity}</div>
                      </td>
                      <td className="px-4 py-3 text-ink-700">{ext.centerName}</td>
                      <td className="px-4 py-3 text-ink-700">{ext.deletedBy || '—'}</td>
                      <td className="px-4 py-3 text-ink-600">{fmt(ext.deletedAt)}</td>
                      <td className="px-4 py-3">
                        <Badge color={left <= 5 ? '#dc2626' : '#f59e0b'}>{left}d left</Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button className="btn bg-green-600 px-2.5 py-1.5 text-xs text-white hover:bg-green-700" disabled={busyId === ext.id} onClick={() => restore(ext)}>
                            {busyId === ext.id ? <Spinner size={14} /> : (<><RotateCcw size={14} /> Restore</>)}
                          </button>
                          <button className="btn-danger px-2.5 py-1.5 text-xs" onClick={() => setPurgeFor(ext)}>
                            <Trash2 size={14} /> Purge
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={!!purgeFor} onClose={() => setPurgeFor(null)} title="Permanently delete?">
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700">
          <AlertTriangle size={16} />
          <span>This permanently deletes <strong>{purgeFor?.serialNo || purgeFor?.type}</strong> and its QR code. This cannot be undone.</span>
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setPurgeFor(null)}>Cancel</button>
          <button className="btn-danger" onClick={confirmPurge} disabled={busy}>
            {busy ? <Spinner size={18} /> : (<><Trash2 size={16} /> Purge permanently</>)}
          </button>
        </div>
      </Modal>
    </div>
  )
}

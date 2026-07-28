import { useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, Send } from 'lucide-react'
import toast from 'react-hot-toast'
import { Modal, Spinner } from './ui'
import { DEFECTS, REPORTER_ROLES } from '../lib/constants'
import { createReport } from '../lib/firestore'

/**
 * Report a defect against an extinguisher. Submits a PENDING report into the
 * org's approval queue (works for both portal users and public QR visitors).
 *
 * Props: open, onClose, ext (with at least {extId/id, serialNo, type}),
 *        orgId, reporter {uid?, name}, source ('portal' | 'qr')
 */
export default function ReportDefectModal({ open, onClose, ext, orgId, reporter, source = 'portal' }) {
  const [selected, setSelected] = useState(null)
  const [note, setNote] = useState('')
  const [role, setRole] = useState('')
  const [busy, setBusy] = useState(false)

  const isQr = source === 'qr'

  if (!ext) return null
  const extId = ext.extId || ext.id
  const label = ext.serialNo ? `${ext.serialNo} · ${ext.type}` : `${ext.type} · ${ext.capacity}`

  const submit = async () => {
    if (!selected) return toast.error('Select a defect type')
    if (isQr && !role) return toast.error('Select who is reporting')
    setBusy(true)
    try {
      await createReport(orgId, {
        extId,
        extLabel: label,
        kind: 'defect',
        defectType: selected.key,
        note,
        reportedBy: reporter?.uid || 'public',
        reportedByName: reporter?.name || 'QR Scan (Public)',
        reporterRole: isQr ? role : null,
        source,
      })
      toast.success('Defect reported — pending approval')
      setSelected(null)
      setNote('')
      setRole('')
      onClose?.()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Report a defect">
      <div className="mb-4 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
        <AlertTriangle size={16} />
        <span>Reporting for <strong>{label}</strong>. This will await portal approval.</span>
      </div>

      <p className="label">Defect type</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {DEFECTS.map((d) => {
          const active = selected?.key === d.key
          return (
            <motion.button
              key={d.key}
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={() => setSelected(d)}
              className={`rounded-xl border-2 px-3 py-3 text-left text-sm font-semibold transition ${
                active ? 'border-transparent text-white shadow-card' : 'border-ink-200 text-ink-700 hover:border-ink-300'
              }`}
              style={active ? { backgroundColor: d.color } : {}}
            >
              {d.label}
              {d.triggersRefill && (
                <span className={`mt-0.5 block text-[10px] font-medium ${active ? 'text-white/80' : 'text-ink-400'}`}>
                  → sends to refill
                </span>
              )}
            </motion.button>
          )
        })}
      </div>

      {isQr && (
        <div className="mt-4">
          <label className="label">Reported by *</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value)} required>
            <option value="" disabled>Select who is reporting…</option>
            {REPORTER_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      )}

      <div className="mt-4">
        <label className="label">Note (optional)</label>
        <textarea
          className="input min-h-[72px]"
          placeholder="Describe what you observed…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={submit} disabled={busy}>
          {busy ? <Spinner size={18} /> : (<><Send size={16} /> Submit report</>)}
        </button>
      </div>
    </Modal>
  )
}

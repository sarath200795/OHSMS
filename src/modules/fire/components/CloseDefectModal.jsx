import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Paperclip, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { toastCaught } from '../../../shared/lib/toastCaught'
import { Modal, Spinner, Field } from './ui'
import { closeDefect } from '../lib/firestore'
import { descriptorOf, validateClosure } from '../lib/defectClosure'
import { todayISO } from '../../../shared/lib/dates'
import { readFileAsDataUrl, MAX_ATTACHMENT_BYTES } from '../../../shared/lib/files'
import { formatSize } from '../../../shared/storage'
import { safeHref } from '../../../shared/safeUrl'

/**
 * Close one open defect: remarks, the day it was closed, who closed it (the
 * signed-in user), and an optional photograph of the repair.
 */
export default function CloseDefectModal({ open, onClose, row, orgId, orgName, actor }) {
  const [remarks, setRemarks] = useState('')
  const [closedOn, setClosedOn] = useState('')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setRemarks('')
    setClosedOn(todayISO())
    setFile(null)
    setBusy(false)
  }, [open, row])

  if (!row) return null

  const pickFile = async (f) => {
    if (!f) return
    try {
      const data = await readFileAsDataUrl(f)
      setFile({ name: f.name, type: f.type, data })
    } catch (e) {
      toastCaught(e)
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const confirm = async () => {
    const error = validateClosure({ remarks, closedOn })
    if (error) return toast.error(error)
    setBusy(true)
    try {
      await closeDefect(
        orgId,
        orgName,
        descriptorOf(row),
        {
          remarks,
          closedOn,
          file,
        },
        actor
      )
      toast.success('Defect closed')
      onClose?.()
    } catch (e) {
      toastCaught(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Close defect">
      <p className="mb-4 text-sm text-ink-600">
        Close <strong>{row.defect}</strong>
        {row.label ? (
          <>
            {' '}
            on <strong>{row.label}</strong>
          </>
        ) : null}
        . It leaves the open list and stays available under the Closed filter.
      </p>
      <Field label="Closure remarks">
        <textarea
          className="input min-h-[72px]"
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          placeholder="What was done, and anything the next reader needs"
        />
      </Field>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Closed date">
          <input
            type="date"
            className="input"
            value={closedOn}
            onChange={(e) => setClosedOn(e.target.value)}
          />
        </Field>
        <Field label="Closed by">
          <input className="input" value={actor?.name || ''} readOnly />
        </Field>
      </div>
      <div className="mt-4">
        <label htmlFor="defect-evidence" className="label">
          Evidence photo (optional)
        </label>
        <input
          id="defect-evidence"
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0])}
        />
        {file ? (
          <div className="ring-1 ring-ink-200 flex items-center gap-2 rounded-2xl bg-surface-50 px-3 py-2.5 text-sm">
            <Paperclip size={15} className="shrink-0 text-ink-400" />
            <a
              href={safeHref(file.data)}
              target="_blank"
              rel="noreferrer"
              className="flex-1 truncate font-medium text-brand-700 hover:underline"
            >
              {file.name}
            </a>
            <button
              type="button"
              className="rounded-lg p-1 text-ink-400 hover:bg-surface-100 hover:text-ink-700"
              onClick={() => setFile(null)}
              aria-label="Remove evidence"
            >
              <X size={15} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn-ghost w-full justify-center"
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip size={15} /> Attach photo or PDF
          </button>
        )}
        <p className="mt-1 text-xs text-ink-400">Up to {formatSize(MAX_ATTACHMENT_BYTES)}.</p>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn bg-green-600 text-white hover:brightness-110"
          onClick={confirm}
          disabled={busy}
        >
          {busy ? (
            <Spinner size={18} />
          ) : (
            <>
              <CheckCircle2 size={16} /> Close defect
            </>
          )}
        </button>
      </div>
    </Modal>
  )
}

import { useState } from 'react'
import { QrCode } from 'lucide-react'
import toast from 'react-hot-toast'
import { toastCaught } from '../../../shared/lib/toastCaught'
import { exportQrLabelPdf } from '../lib/qrLabelSheet'

/**
 * "Export QR codes" for a register (FAS panels / AEDs).
 *
 * `rows` is what to export — the caller passes the selected rows when there is a
 * selection, otherwise the filtered list. The button is only rendered on pages
 * the user can already see, and it reads nothing beyond `rows`.
 */
export default function ExportQrButton({ kind, rows, selectedCount = 0, className = 'btn-soft' }) {
  const [progress, setProgress] = useState(null) // { done, total } while running

  const run = async () => {
    if (progress) return
    if (!rows.length) return toast.error('Nothing to export')
    setProgress({ done: 0, total: rows.length })
    try {
      const { exported, skipped } = await exportQrLabelPdf(kind, rows, {
        onProgress: (done, total) => setProgress({ done, total }),
      })
      if (!exported) {
        toast.error('None of these have a QR code yet, so there is nothing to export')
      } else if (skipped) {
        toast.success(`Exported ${exported} QR code${exported === 1 ? '' : 's'}. ${skipped} without a QR code ${skipped === 1 ? 'was' : 'were'} left out.`)
      } else {
        toast.success(`Exported ${exported} QR code${exported === 1 ? '' : 's'} to PDF`)
      }
    } catch (e) {
      toastCaught(e, 'Could not export QR codes')
    } finally {
      setProgress(null)
    }
  }

  const label = progress
    ? `Exporting QR ${progress.done}/${progress.total}…`
    : selectedCount > 0
      ? `Export QR codes (${selectedCount} selected)`
      : 'Export QR codes'

  return (
    <button
      type="button"
      className={className}
      onClick={run}
      disabled={!!progress || !rows.length}
      aria-busy={!!progress}
      title={selectedCount > 0 ? 'Download a printable PDF of QR labels for the selected rows' : 'Download a printable PDF of QR labels for the rows currently listed'}
    >
      <QrCode size={16} /> {label}
    </button>
  )
}

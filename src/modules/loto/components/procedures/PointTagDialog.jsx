import { QRCodeSVG } from 'qrcode.react'
import { tagScanUrl } from '../../utils/codes'
import Button from '../ui/Button'
import Modal from '../ui/Modal'

/**
 * The tag hung on a locked isolation point.
 *
 * Printed when the lock goes on, so it carries the point it belongs to rather
 * than the whole procedure. Scanning it opens the LIVE operation — which is the
 * safety property, not a convenience. A tag can easily outlive the job it was
 * printed for, and one that still reads "isolated" after the lock came off is
 * worse than no tag at all. Because the code resolves to live state, a stale
 * tag tells the truth: the point it opens will show as unlocked.
 *
 * Deliberately sparse. This gets printed on a small label, taped to oily metal,
 * and read in bad light — everything on it has to survive that. The QR is large
 * relative to the card for the same reason.
 */
export default function PointTagDialog({ procedure, point, onClose }) {
  if (!point) return null

  const url = tagScanUrl(procedure.id, point.key)
  const tech = point.lockState?.techName

  return (
    <Modal open onClose={onClose} title={`Tag — ${point.pointId}`}>
      {/* print:* so the browser's own print dialog produces the label without a
          separate print stylesheet or a second window to keep in step. */}
      <div className="tag-print mx-auto max-w-xs rounded-2xl border-2 border-steel-800 bg-white p-4 text-center text-steel-900">
        <div
          className="mx-auto mb-2 grid h-9 w-20 place-items-center rounded-md text-sm font-extrabold"
          style={{ background: point.color, color: point.textColor }}
        >
          {point.pointId}
        </div>

        <p className="text-[13px] font-bold uppercase tracking-wide text-danger">Do not operate</p>
        <p className="mt-0.5 text-[11px] leading-snug text-steel-700">
          This point is locked out. Scan before touching it.
        </p>

        <div className="my-3 flex justify-center">
          <QRCodeSVG value={url} size={132} />
        </div>

        <p className="text-[11px] font-semibold text-steel-800">{procedure.title || 'Isolation procedure'}</p>
        {procedure.equipment && (
          <p className="text-[11px] text-steel-600">{procedure.equipment}</p>
        )}
        {tech && <p className="mt-1 text-[11px] text-steel-600">Locked by {tech}</p>}
        {/* No date. A printed date is the one thing on here that cannot stay
            true, and next to "Do not operate" a stale one reads as authority. */}
      </div>

      <div className="mt-4 flex justify-end gap-2 print:hidden">
        <Button variant="ghost" onClick={onClose}>Close</Button>
        <Button onClick={() => window.print()}>Print</Button>
      </div>
    </Modal>
  )
}

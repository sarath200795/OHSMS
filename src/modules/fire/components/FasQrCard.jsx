import { useRef, useState } from 'react'
import { useReactToPrint } from 'react-to-print'
import { QRCodeSVG } from 'qrcode.react'
import { Download, Printer, ExternalLink } from 'lucide-react'
import { toastCaught } from '../../../shared/lib/toastCaught'
import { publicQrUrl } from '../lib/qr'
import { exportQrLabelPdf } from '../lib/qrLabelSheet'
import { QR_FRAME_INK, QR_PRINT_CODE_RULE, qrCodeBorderStyle } from '../../../shared/print/qrFrame'

/**
 * The QR code for one fire-alarm control panel: the same URL the register's
 * "Export QR codes" sheet encodes, with a way to download that label or print
 * this card. Scanning it opens /qr/:token — this panel's public page.
 */
export default function FasQrCard({ panel }) {
  const printRef = useRef(null)
  const [downloading, setDownloading] = useState(false)
  const name = panel?.deviceId || panel?.deviceType || 'this control panel'
  const url = panel?.qrToken ? publicQrUrl(panel.qrToken) : ''

  const handlePrint = useReactToPrint({
    content: () => printRef.current,
    documentTitle: `FAS-${panel?.deviceId || 'panel'}-QR`,
    pageStyle: `
      @page { size: A4; margin: 16mm; }
      @media print {
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .qr-print-card { break-inside: avoid; page-break-inside: avoid; box-shadow: none !important; border: 0.4mm solid ${QR_FRAME_INK} !important; }
        .qr-print-code { width: 48mm !important; height: 48mm !important; ${QR_PRINT_CODE_RULE} }
      }
    `,
  })

  if (!panel?.qrToken) return null

  const download = async () => {
    if (downloading) return
    setDownloading(true)
    try {
      const { exported } = await exportQrLabelPdf('fas', [panel])
      if (!exported) throw new Error('This panel has no QR code to download')
    } catch (err) {
      toastCaught(err, 'Could not download the QR label')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <div
        ref={printRef}
        className="qr-print-card flex min-w-0 flex-col items-center rounded-2xl border border-ink-900 bg-white p-4 shadow-elev"
      >
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-600">Fire alarm</p>
        <div role="img" aria-label={`QR code for ${name}. Scanning opens this panel's page.`}>
          <QRCodeSVG
            className="qr-print-code"
            style={qrCodeBorderStyle()}
            value={url}
            size={200}
            level="H"
            includeMargin
            fgColor="#000000"
            bgColor="#ffffff"
          />
        </div>
        <p className="mt-2 text-sm font-bold text-ink-900">{name}</p>
        <p className="text-xs text-ink-500">{[panel.deviceType, panel.zone].filter(Boolean).join(' · ')}</p>
        <p className="text-xs text-ink-400">{[panel.centerName, panel.location].filter(Boolean).join(' · ')}</p>
      </div>
      <p className="break-all text-xs text-ink-400">{url}</p>
      <p className="max-w-sm text-xs text-ink-500">
        Scanning opens this panel&apos;s page, where anyone can see its status and report a defect. No sign-in needed.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" className="btn-primary" onClick={download} disabled={downloading}>
          <Download size={16} /> {downloading ? 'Downloading…' : `Download QR label for ${name}`}
        </button>
        <button type="button" className="btn-soft" onClick={handlePrint}>
          <Printer size={16} /> {`Print QR label for ${name}`}
        </button>
        <a className="btn-ghost" href={url} target="_blank" rel="noreferrer">
          <ExternalLink size={16} /> Open the page a scan opens
        </a>
      </div>
    </div>
  )
}

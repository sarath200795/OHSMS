import { Printer, X, Award } from 'lucide-react'
import { PrintIsolate } from '../../../shared/ui'
import { formatDate } from '../../../shared/lib/format'

/**
 * WEHS training certificate — on-screen preview + print/PDF ("Save as PDF" in
 * the browser print dialog). The injected print style isolates the certificate
 * so only it prints, in landscape.
 */
export default function CertificateModal({ record, orgName, onClose }) {
  if (!record) return null
  const certNo = `WEHS-TR-${(record.id || '').slice(0, 8).toUpperCase() || 'DRAFT'}`

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <PrintIsolate id="wehs-certificate" landscape />
      <div className="absolute inset-0 bg-ink-950/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 w-full max-w-4xl">
        <div className="mb-3 flex items-center justify-end gap-2">
          <button className="btn-primary" onClick={() => window.print()}>
            <Printer size={16} /> Print / Save as PDF
          </button>
          <button className="btn-ghost bg-white/90" onClick={onClose}>
            <X size={16} /> Close
          </button>
        </div>

        {/* ── The certificate ── */}
        <div
          id="wehs-certificate"
          className="relative overflow-hidden rounded-xl bg-[#f8f1e4] p-2 shadow-2xl"
          style={{ aspectRatio: '297/200' }}
        >
          {/* double border */}
          <div className="flex h-full flex-col rounded-lg border-4 border-[#c74a33] p-1.5">
            <div className="flex h-full flex-col items-center rounded-md border-2 border-[#b29470] px-10 py-6 text-center">
              {/* header */}
              <div className="flex items-center gap-3">
                <img src="/wehs.svg" alt="WEHS" className="h-14 w-14 rounded-xl" />
                <div className="text-left leading-tight">
                  <p className="text-lg font-black tracking-tight text-[#2c241d]">WEHS</p>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-[#8a7660]">
                    Workplace Environment, Health &amp; Safety
                  </p>
                </div>
              </div>

              <p className="mt-4 font-serif text-3xl font-bold tracking-wide text-[#c74a33]" style={{ fontFamily: 'Georgia, serif' }}>
                Certificate of Completion
              </p>
              <div className="mt-1 h-1 w-40 rounded-full bg-[#e8a33d]" />

              <p className="mt-4 text-sm text-[#57493a]">This is to certify that</p>
              <p className="mt-1 text-3xl font-bold text-[#2c241d]" style={{ fontFamily: 'Georgia, serif' }}>
                {record.employeeName}
              </p>
              <p className="mt-2 text-sm text-[#57493a]">has successfully completed the training</p>
              <p className="mt-1 text-xl font-extrabold text-[#a63c2a]">
                {record.courseName}
              </p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-widest text-[#8a7660]">
                {record.category || 'Training'}{record.trainerName ? ` · Trainer: ${record.trainerName}` : ''}
              </p>

              <div className="mt-4 flex items-center gap-10 text-sm text-[#40352b]">
                <span><b>Completed:</b> {formatDate(record.completedOn)}</span>
                {record.expiresOn && <span><b>Valid until:</b> {formatDate(record.expiresOn)}</span>}
              </div>

              {/* footer */}
              <div className="mt-auto flex w-full items-end justify-between pt-6">
                <div className="text-left">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#8a7660]">Certificate No.</p>
                  <p className="font-mono text-xs font-bold text-[#40352b]">{certNo}</p>
                  <p className="mt-1 text-[10px] text-[#8a7660]">Issued by {orgName || 'WEHS'} · {formatDate(new Date())}</p>
                </div>
                <Award size={40} className="text-[#e8a33d]" />
                <div className="text-right">
                  <div className="mb-1 h-px w-40 bg-[#57493a]" />
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#8a7660]">
                    HSE Manager — {orgName || 'Organization'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

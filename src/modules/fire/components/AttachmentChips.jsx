import { CheckCircle2, Gauge, AlertTriangle } from 'lucide-react'
import { safeHref } from '../../../shared/safeUrl'
import { hasQuotation } from '../lib/extinguisherLogic'
import { hasHpt } from '../lib/hpt'

// ─────────────────────────────────────────────────────────────────────────────
// What has been filed against this unit, and a way to open it.
//
// The HPT certificate was STORED AND NEVER SHOWN. submitHpt writes fileName,
// fileType and either fileData or a fileUrl, exactly as the quotation does —
// but while the quotation had a "Quoted · View" chip on three lists, the
// certificate had no chip anywhere. Once the modal closed, the only way to see
// the document you had just attached was to reopen the modal that filed it.
//
// That is worse for the HPT than it would be for a quotation. The certificate
// IS the compliance record for a pressure vessel; "we tested it" without the
// document is the state an auditor asks about.
//
// One component rather than four more copies. The quotation chip was already
// duplicated across RefillDue, PhysicalDefects and Repository, and adding the
// certificate beside each would have made six near-identical blocks — which is
// how the two drift into looking like different features.
// ─────────────────────────────────────────────────────────────────────────────

/** A chip that links to the document when there is one, and states it when not. */
function DocChip({ href, title, tone, icon: Icon, label }) {
  const cls = `chip ${tone}`
  return href ? (
    <a href={safeHref(href)} target="_blank" rel="noreferrer" className={`${cls} hover:underline`} title={`${title} — view document`}>
      <Icon size={12} /> {label} · View
    </a>
  ) : (
    <span className={cls} title={title}>
      <Icon size={12} /> {label}
    </span>
  )
}

export default function AttachmentChips({ ext }) {
  const q = ext?.quotation
  const h = ext?.hpt
  // fileData OR fileUrl: a certificate under about a megabyte is inlined, and
  // anything larger goes to Storage and comes back as a URL with fileData null.
  // Reading only one of the two is the bug that hid every uploaded document.
  const hptHref = h?.fileData || h?.fileUrl
  const failed = h?.result === 'fail'

  return (
    <>
      {hasQuotation(ext) && (
        <DocChip
          href={q?.fileData || q?.fileUrl}
          tone="bg-cyan-50 text-cyan-700"
          icon={CheckCircle2}
          label="Quoted"
          title={`Quoted ${q?.amount ?? ''} · ${q?.vendor || ''}`}
        />
      )}

      {/* A failure keeps its own red chip: it is the one outcome that leaves the
          cylinder condemned, and it must not read as a completed step. */}
      {hasHpt(ext) && (
        <DocChip
          href={hptHref}
          tone={failed ? 'bg-red-50 text-red-700' : 'bg-violet-50 text-violet-700'}
          icon={failed ? AlertTriangle : Gauge}
          label={failed ? 'HPT failed' : 'HPT'}
          title={`HPT ${failed ? 'FAILED' : 'passed'} on ${h?.testedOn || 'unknown date'}${h?.vendor ? ` · ${h.vendor}` : ''}`}
        />
      )}
    </>
  )
}

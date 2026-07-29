// ─────────────────────────────────────────────────────────────────────────────
// The page a fire-extinguisher QR code opens.
//
// This is the public end of the QR system: the app has always minted a qrToken
// per extinguisher, written a public mirror document for it and exported
// "<origin>/qr/<token>" into the asset spreadsheet — but the route itself was
// never built, so every label printed from this app led to a 404.
//
// Deliberately usable without signing in. Whoever notices a discharged
// extinguisher on a shop floor is rarely a portal user, and making them create
// an account first is how defects go unreported. The report lands in the org's
// existing approval queue exactly like a portal one, flagged source: 'qr'.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { AlertTriangle, ShieldCheck, MapPin, Calendar, QrCode, Loader2 } from 'lucide-react'
import { db } from '../../../shared/firebase'
import ReportDefectModal from '../components/ReportDefectModal'
import { STATUS_LABEL } from '../lib/constants'

const Row = ({ icon: Icon, label, value }) => (
  <div className="flex items-start gap-3 border-b border-clay-200/70 py-2.5 last:border-0">
    <Icon size={16} className="mt-0.5 shrink-0 text-ink-400" />
    <span className="w-32 shrink-0 text-sm text-ink-500">{label}</span>
    <span className="min-w-0 flex-1 text-sm font-semibold text-ink-900">{value || '—'}</span>
  </div>
)

export default function QrLanding() {
  const { token } = useParams()
  const [asset, setAsset] = useState(undefined) // undefined = loading, null = not found
  const [reporting, setReporting] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const snap = await getDoc(doc(db, 'qr', token))
        if (alive) setAsset(snap.exists() ? { id: snap.id, ...snap.data() } : null)
      } catch {
        if (alive) setAsset(null)
      }
    })()
    return () => { alive = false }
  }, [token])

  if (asset === undefined) {
    return (
      <div className="grid min-h-screen place-items-center bg-clay-bg">
        <Loader2 size={28} className="animate-spin text-brand-600" />
      </div>
    )
  }

  if (asset === null) {
    return (
      <div className="grid min-h-screen place-items-center bg-clay-bg p-6">
        <div className="card max-w-sm p-8 text-center">
          <QrCode size={32} className="mx-auto text-ink-300" />
          <h1 className="mt-3 text-lg font-bold text-ink-900">Code not recognised</h1>
          <p className="mt-1 text-sm text-ink-500">
            This QR code does not match any equipment on record. It may belong to another system, or the
            asset may have been removed. Please report it to your safety team.
          </p>
        </div>
      </div>
    )
  }

  const defects = asset.physicalDefects || []
  const hasDefects = defects.length > 0
  const statusLabel = STATUS_LABEL[asset.status] || asset.status || 'Unknown'

  return (
    <div className="min-h-screen bg-clay-bg p-4 sm:p-8">
      <div className="mx-auto max-w-md">
        <div className="card overflow-hidden !p-0">
          <div className={`p-5 text-white ${hasDefects ? 'bg-red-600' : 'bg-green-700'}`}>
            <p className="text-xs font-bold uppercase tracking-widest opacity-80">
              {asset.orgName || 'Fire extinguisher'}
            </p>
            <h1 className="mt-1 text-xl font-bold">
              {asset.type} {asset.capacity}
            </h1>
            <p className="mt-0.5 text-sm opacity-90">
              {asset.serialNo ? `Serial ${asset.serialNo}` : 'No serial recorded'}
            </p>
            <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-bold">
              {hasDefects ? <AlertTriangle size={13} /> : <ShieldCheck size={13} />}
              {hasDefects ? `${defects.length} open defect(s)` : statusLabel}
            </span>
          </div>

          <div className="px-5 py-3">
            <Row icon={MapPin} label="Location" value={[asset.centerName, asset.region, asset.entity].filter(Boolean).join(' · ')} />
            <Row icon={Calendar} label="Deployed" value={asset.dateOfDeployment} />
            <Row icon={Calendar} label="Next refill" value={asset.dateOfNextRefill} />
            <Row icon={Calendar} label="Next HPT" value={asset.dateOfNextHPT} />
          </div>

          {hasDefects && (
            <div className="mx-5 mb-4 rounded-2xl bg-red-50 p-3 text-sm text-red-900">
              <p className="font-semibold">Already reported</p>
              <p className="mt-0.5">{defects.join(', ')}</p>
            </div>
          )}

          <div className="border-t border-clay-200/70 p-5">
            <button className="btn-primary w-full justify-center" onClick={() => setReporting(true)}>
              <AlertTriangle size={16} /> Report a defect
            </button>
            <p className="mt-2 text-center text-xs text-ink-400">
              No sign-in needed — your report goes to the safety team for review.
            </p>
          </div>
        </div>
      </div>

      <ReportDefectModal
        open={reporting}
        onClose={() => setReporting(false)}
        ext={asset}
        orgId={asset.orgId}
        reporter={null}
        source="qr"
      />
    </div>
  )
}

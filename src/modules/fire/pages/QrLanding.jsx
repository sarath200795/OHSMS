// ─────────────────────────────────────────────────────────────────────────────
// The page an equipment QR code opens.
//
// This is the public end of the QR system: the app has always minted a qrToken
// per asset, written a public mirror document for it and exported
// "<origin>/qr/<token>" into the asset spreadsheet — but the route itself was
// never built, so every label printed from this app led to a 404.
//
// Deliberately usable without signing in. Whoever notices a discharged
// extinguisher on a shop floor is rarely a portal user, and making them create
// an account first is how defects go unreported. The report lands in the org's
// existing approval queue exactly like a portal one, flagged source: 'qr'.
//
// One route serves three kinds of asset. Extinguisher mirrors predate the
// others and carry no assetKind, so their absence is what identifies them; AED
// and FAS mirrors set it explicitly. The kind decides the whole card — an AED
// has no refill date and a fire-alarm panel has no capacity, and until this
// branched, both were being described in extinguisher terms and offered the
// extinguisher defect sheet.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { AlertTriangle, ShieldCheck, MapPin, Calendar, QrCode, Loader2, Wrench, HeartPulse, BellRing, Flame } from 'lucide-react'
import { db } from '../../../shared/firebase'
import ReportDefectModal from '../components/ReportDefectModal'
import ReportAssetDefectModal from '../components/ReportAssetDefectModal'
import { STATUS_LABEL, AED_STATUS, AED_STATUS_LABEL, FAS_STATUS, FAS_STATUS_LABEL } from '../lib/constants'

const Row = ({ icon: Icon, label, value }) => (
  <div className="flex items-start gap-3 border-b border-clay-200/70 py-2.5 last:border-0">
    <Icon size={16} className="mt-0.5 shrink-0 text-ink-400" />
    <span className="w-32 shrink-0 text-sm text-ink-500">{label}</span>
    <span className="min-w-0 flex-1 text-sm font-semibold text-ink-900">{value || '—'}</span>
  </div>
)

const join = (...parts) => parts.filter(Boolean).join(' · ')

// Everything that differs between the three kinds, in one place. `alert` is the
// state that makes the header red: an open defect for an extinguisher, and the
// out-of-service state for the assets whose defects are approved rather than
// accumulated.
function describe(asset) {
  const kind = asset.assetKind || 'extinguisher'
  const where = join(asset.centerName, asset.location, asset.region, asset.entity)

  if (kind === 'aed') {
    return {
      kind,
      icon: HeartPulse,
      eyebrow: 'AED',
      title: join(asset.brand, asset.model) || asset.label || 'AED',
      subtitle: asset.label ? `Asset ${asset.label}` : 'No asset ID recorded',
      statusLabel: AED_STATUS_LABEL[asset.status] || asset.status || 'Unknown',
      alert: asset.status === AED_STATUS.OUT_OF_SERVICE,
      warn: asset.status === AED_STATUS.SERVICE_DUE,
      rows: [
        { icon: MapPin, label: 'Location', value: where },
        { icon: Calendar, label: 'Battery expiry', value: asset.batteryExpiry },
        { icon: Calendar, label: 'Pad expiry', value: asset.padExpiry },
        { icon: Calendar, label: 'Next inspection', value: asset.nextInspection },
      ],
    }
  }

  if (kind === 'fas') {
    return {
      kind,
      icon: BellRing,
      eyebrow: 'Fire alarm system',
      title: asset.deviceType || asset.label || 'FAS device',
      subtitle: join(asset.label && `Device ${asset.label}`, asset.zone && `Zone ${asset.zone}`) || 'No device ID recorded',
      statusLabel: FAS_STATUS_LABEL[asset.status] || asset.status || 'Unknown',
      alert: asset.status === FAS_STATUS.FAULTY,
      warn: asset.status === FAS_STATUS.SERVICE_DUE,
      rows: [
        { icon: MapPin, label: 'Location', value: where },
        { icon: Calendar, label: 'Last service', value: asset.lastService },
        { icon: Calendar, label: 'Next service', value: asset.nextService },
        { icon: Wrench, label: 'AMC vendor', value: asset.amcVendor },
      ],
    }
  }

  const defects = asset.physicalDefects || []
  return {
    kind,
    icon: Flame,
    eyebrow: 'Fire extinguisher',
    title: join(asset.type, asset.capacity) || 'Fire extinguisher',
    subtitle: asset.serialNo ? `Serial ${asset.serialNo}` : 'No serial recorded',
    statusLabel: STATUS_LABEL[asset.status] || asset.status || 'Unknown',
    alert: defects.length > 0,
    warn: false,
    openDefects: defects,
    rows: [
      { icon: MapPin, label: 'Location', value: where },
      { icon: Calendar, label: 'Deployed', value: asset.dateOfDeployment },
      { icon: Calendar, label: 'Next refill', value: asset.dateOfNextRefill },
      { icon: Calendar, label: 'Next HPT', value: asset.dateOfNextHPT },
    ],
  }
}

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

  const d = describe(asset)
  const openDefects = d.openDefects || []
  const headerBg = d.alert ? 'bg-red-600' : d.warn ? 'bg-amber-600' : 'bg-green-700'

  return (
    <div className="min-h-screen bg-clay-bg p-4 sm:p-8">
      <div className="mx-auto max-w-md">
        <div className="card overflow-hidden !p-0">
          <div className={`p-5 text-white ${headerBg}`}>
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest opacity-80">
              <d.icon size={13} /> {d.eyebrow}
            </p>
            <h1 className="mt-1 text-xl font-bold">{d.title}</h1>
            <p className="mt-0.5 text-sm opacity-90">{d.subtitle}</p>
            <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-bold">
              {d.alert ? <AlertTriangle size={13} /> : <ShieldCheck size={13} />}
              {openDefects.length ? `${openDefects.length} open defect(s)` : d.statusLabel}
            </span>
            {asset.orgName && <p className="mt-2 text-xs opacity-75">{asset.orgName}</p>}
          </div>

          <div className="px-5 py-3">
            {d.rows.map((r) => <Row key={r.label} icon={r.icon} label={r.label} value={r.value} />)}
          </div>

          {openDefects.length > 0 && (
            <div className="mx-5 mb-4 rounded-2xl bg-red-50 p-3 text-sm text-red-900">
              <p className="font-semibold">Already reported</p>
              <p className="mt-0.5">{openDefects.join(', ')}</p>
            </div>
          )}

          {/* AED and FAS carry no defect list — an approved report moves the asset
              itself out of service, so that status is the "already reported" signal. */}
          {d.kind !== 'extinguisher' && d.alert && (
            <div className="mx-5 mb-4 rounded-2xl bg-red-50 p-3 text-sm text-red-900">
              <p className="font-semibold">Already reported</p>
              <p className="mt-0.5">
                This unit is marked {d.statusLabel.toLowerCase()} and the safety team has been notified. You can still
                report anything else you notice.
              </p>
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

      {d.kind === 'extinguisher' ? (
        <ReportDefectModal
          open={reporting}
          onClose={() => setReporting(false)}
          ext={asset}
          orgId={asset.orgId}
          reporter={null}
          source="qr"
        />
      ) : (
        <ReportAssetDefectModal
          open={reporting}
          onClose={() => setReporting(false)}
          asset={asset}
          kind={d.kind}
        />
      )}
    </div>
  )
}

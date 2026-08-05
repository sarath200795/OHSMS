// ─────────────────────────────────────────────────────────────────────────────
// The page a work-permit QR code opens.
//
// Every permit printed by this app carries a QR pointing at /permit/<token>,
// and until now that route did not exist — scanning a permit taped to a
// scaffold produced "Page not found". The whole data layer was already here
// (token, public mirror, subscription); the page and its route were not.
//
// It answers one question, for someone standing in front of the work with no
// account and probably no signal to spare: is this permit valid right now. So
// the verdict is the first thing on the screen, in words, before any detail.
//
// It reads the public mirror, which is a copy carrying no approvals, no
// decisions and no attached documents. Nothing here can write back.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  QrCode, Loader2, ShieldCheck, ShieldAlert, Clock, MapPin, User, HardHat,
  AlertTriangle, Building2,
} from 'lucide-react'
import { subscribePermitByToken } from '../lib/firestore'
import { derivePermitStatus, statusMeta, effectiveValidTo, STATUS } from '../lib/permitStatus'

/** Statuses under which work may actually proceed. */
const WORKABLE = new Set([STATUS.APPROVED, STATUS.IN_PROGRESS, STATUS.EXTENDED, STATUS.EXTENDED_IN_PROGRESS])

function countdown(toIso, now) {
  const t = Date.parse(toIso || '')
  if (!Number.isFinite(t)) return null
  const left = t - now
  if (left <= 0) return { expired: true, text: 'Expired' }
  const mins = Math.floor(left / 60000)
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return { expired: false, text: h > 0 ? `${h}h ${m}m remaining` : `${m}m remaining` }
}

export default function PublicPermit() {
  const { token } = useParams()
  const [permit, setPermit] = useState(undefined) // undefined = loading, null = unknown code
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => subscribePermitByToken(token, setPermit, () => setPermit(null)), [token])

  // The verdict is time-sensitive: a permit that expires while someone is
  // looking at it must stop saying it is valid.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const view = useMemo(() => {
    if (!permit) return null
    const status = derivePermitStatus(permit, now)
    const meta = statusMeta(status)
    const validTo = effectiveValidTo(permit)
    return { status, meta, validTo, remaining: countdown(validTo, now), workable: WORKABLE.has(status) }
  }, [permit, now])

  if (permit === undefined) {
    return (
      <div className="grid min-h-screen place-items-center bg-clay-bg">
        <Loader2 size={28} className="animate-spin text-brand-600" />
      </div>
    )
  }

  if (permit === null) {
    return (
      <div className="grid min-h-screen place-items-center bg-clay-bg p-6">
        <div className="card max-w-sm p-8 text-center">
          <QrCode size={32} className="mx-auto text-ink-300" />
          <h1 className="mt-3 text-lg font-bold text-ink-900">Code not recognised</h1>
          <p className="mt-1 text-sm text-ink-500">
            This QR code does not match any work permit on record. It may belong to another system,
            or the permit may have been removed. Do not treat it as authorisation to work — check
            with the issuing department.
          </p>
        </div>
      </div>
    )
  }

  const { meta, validTo, remaining, workable } = view
  const ok = workable && !remaining?.expired

  return (
    <div className="min-h-screen bg-clay-bg px-4 py-6">
      <div className="mx-auto max-w-md space-y-4">
        {/* The verdict, before anything else. */}
        <div className={`rounded-3xl p-5 text-center shadow-clay ${ok ? 'bg-emerald-600' : 'bg-red-700'}`}>
          {ok ? <ShieldCheck size={34} className="mx-auto text-white" /> : <ShieldAlert size={34} className="mx-auto text-white" />}
          <p className="mt-2 text-lg font-black tracking-tight text-white">
            {ok ? 'Valid — work may proceed' : 'Not valid for work'}
          </p>
          <p className="mt-0.5 text-sm font-semibold text-white/80">{meta.label}</p>
          {remaining && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-black/20 px-3 py-1 text-xs font-bold text-white">
              <Clock size={12} /> {remaining.text}
            </p>
          )}
        </div>

        {!ok && (
          <p className="rounded-2xl bg-red-50 px-4 py-3 text-center text-[13px] font-semibold leading-snug text-red-800">
            Stop. This permit does not authorise work right now. Contact the issuing department
            before anything starts.
          </p>
        )}

        <div className="card space-y-3 p-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-ink-400">Permit</p>
            <p className="text-lg font-black tracking-tight text-ink-900">{permit.permitNo || '—'}</p>
            {permit.docId && <p className="font-mono text-[11px] text-ink-400">{permit.docId}</p>}
          </div>

          <Row icon={HardHat} label="Type of work" value={permit.typeOfWork} />
          <Row icon={Building2} label="Site" value={permit.site} />
          <Row icon={MapPin} label="Location" value={permit.jobLocation} />
          <Row icon={User} label="Issued to" value={permit.issuedToName} />
          <Row icon={Clock} label="Valid until" value={validTo ? new Date(validTo).toLocaleString() : ''} />

          {permit.jobDescription && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-ink-400">Work</p>
              <p className="text-sm leading-snug text-ink-700">{permit.jobDescription}</p>
            </div>
          )}
        </div>

        {(permit.hazards?.length > 0 || permit.ppe?.length > 0) && (
          <div className="card space-y-3 p-5">
            <Chips label="Hazards" items={permit.hazards} tone="bg-red-100 text-red-800" icon={AlertTriangle} />
            <Chips label="PPE required" items={permit.ppe} tone="bg-sky-100 text-sky-800" />
            <Chips label="Precautions" items={permit.precautions} tone="bg-amber-100 text-amber-800" />
          </div>
        )}

        {permit.participants?.length > 0 && (
          <div className="card p-5">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-ink-400">
              People on this permit ({permit.participants.length})
            </p>
            <ul className="space-y-1">
              {permit.participants.map((p, i) => (
                <li key={i} className="text-sm text-ink-700">
                  {p.name}
                  {p.company ? <span className="text-ink-400"> · {p.company}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="pb-6 text-center text-[11px] leading-snug text-ink-400">
          {permit.orgName || 'Workplace'} · live permit status.
          <br />
          If the work does not match this permit, stop it and tell the issuing department.
        </p>
      </div>
    </div>
  )
}

function Row({ icon: Icon, label, value }) {
  if (!value) return null
  return (
    <div className="flex items-start gap-2.5">
      <Icon size={15} className="mt-0.5 flex-none text-ink-400" />
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-widest text-ink-400">{label}</p>
        <p className="text-sm font-semibold leading-snug text-ink-800">{value}</p>
      </div>
    </div>
  )
}

function Chips({ label, items, tone, icon: Icon }) {
  if (!items?.length) return null
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-ink-400">
        {Icon && <Icon size={11} />} {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((h, i) => (
          <span key={i} className={`rounded-lg px-2 py-1 text-[11px] font-semibold ${tone}`}>{h}</span>
        ))}
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { numberIsolationPoints, procedureScanUrl } from '../../utils/codes'
import { qrDataUrl } from '../../utils/qr'
import { pointDevicesLabel } from '../../constants/energySources'
import {
  LOCK_STATUS,
  LOCK_STATUS_META,
  PROCEDURE_STATUS_META,
  computeLockSummary,
} from '../../constants/procedures'
import Badge from '../ui/Badge'
import { safeHref, safeSrc } from '../../../../shared/safeUrl'

function useQr(text) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let active = true
    qrDataUrl(text, { scale: 6 }).then((u) => active && setUrl(u))
    return () => {
      active = false
    }
  }, [text])
  return url
}

// Read-only lock indicator (the actual lock/unlock controls live in PerformPanel).
function LockBadge({ point }) {
  const ls = point.lockState
  if (ls?.locked) {
    return (
      <Badge className="border-danger/40 bg-danger/15 text-danger">
        🔒 {ls.techName || ls.lockedByName}
        {ls.lockType ? ` · ${ls.lockType === 'department' ? 'Dept' : 'Personal'}` : ''}
        {ls.techLockNo ? ` #${ls.techLockNo}` : ''}
      </Badge>
    )
  }
  return <Badge className="border-steel-600 bg-steel-800 text-steel-400">Unlocked</Badge>
}

export default function ProcedureView({ procedure, photos = {}, headerActions }) {
  const points = numberIsolationPoints(procedure.isolationPoints || [])
  const qr = useQr(procedureScanUrl(procedure.id))
  const summary = procedure.lockSummary || computeLockSummary(points)
  const lockMeta = LOCK_STATUS_META[summary.status]
  const statusMeta = PROCEDURE_STATUS_META[procedure.status]

  return (
    <div className="space-y-6">
      {/* Header card */}
      <div className="overflow-hidden rounded-2xl bg-claySurface shadow-clay">
        <div className="hazard-stripes h-1.5" />
        <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {statusMeta && <Badge className={statusMeta.accent}>{statusMeta.label}</Badge>}
              <Badge className={lockMeta.accent}>
                {summary.status === LOCK_STATUS.LOCKED && '🔒 '}
                {lockMeta.label}
              </Badge>
              <span className="text-xs text-steel-400">Rev R{procedure.revision ?? 0}</span>
            </div>
            <h1 className="mt-2 truncate text-2xl font-extrabold tracking-tight text-steel-50">
              {procedure.equipment}
            </h1>
            <div className="mt-1 text-sm text-steel-400">
              {procedure.orgName} · {procedure.site}
            </div>
            <div className="mt-2 font-mono text-sm font-bold text-amber-600">
              {procedure.procedureCode}
            </div>
            {procedure.equipmentDetails && (
              <p className="mt-2 max-w-lg text-sm text-steel-300">{procedure.equipmentDetails}</p>
            )}
            <div className="mt-3 text-xs text-steel-500">
              {summary.lockedCount} / {summary.total} points locked
              {procedure.primaryTech ? ` · Primary: ${procedure.primaryTech.name}` : ''}
            </div>
          </div>

          <div className="flex flex-col items-center gap-2">
            {qr && (
              <img
                src={qr}
                alt="Procedure QR"
                className="h-28 w-28 rounded-lg border border-steel-700 bg-white p-1"
              />
            )}
            <span className="text-[10px] uppercase tracking-widest text-steel-500">Scan to view</span>
          </div>
        </div>

        {headerActions && (
          <div className="flex flex-wrap gap-2 border-t border-steel-700 px-6 py-3">{headerActions}</div>
        )}
      </div>

      {/* Isolation points */}
      <div className="space-y-3">
        {points.map((p, i) => (
          <motion.div
            key={p.key || i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            className="overflow-hidden rounded-2xl bg-claySurface shadow-clay"
          >
            <div className="flex items-stretch">
              <div
                className="flex w-20 flex-col items-center justify-center gap-1 p-3 text-center"
                style={{ background: p.color, color: p.textColor }}
              >
                <span className="text-lg font-extrabold">{p.pointId}</span>
                <span className="text-[10px] font-semibold leading-tight">
                  {p.energyLabel.replace(' Energy', '')}
                </span>
              </div>

              <div className="flex-1 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="text-sm font-semibold text-steel-100">
                    {pointDevicesLabel(p)}
                    {p.rating ? (
                      <span className="ml-2 rounded bg-steel-800 px-2 py-0.5 text-xs font-medium text-steel-300">
                        {p.rating}
                      </span>
                    ) : null}
                  </div>
                  <LockBadge point={p} />
                </div>

                <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Detail label="Isolation details" value={p.isolationDetails} />
                  <Detail label="Hazard" value={p.hazard} danger />
                  <Detail label="Verification" value={p.verification} />
                  {photos[p.key] && (
                    <div>
                      <dt className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-steel-400">
                        Isolation point
                      </dt>
                      <a href={safeHref(photos[p.key])} target="_blank" rel="noreferrer">
                        <img
                          src={safeSrc(photos[p.key])}
                          alt={`${p.pointId} isolation`}
                          className="h-28 w-full max-w-[180px] rounded-lg border border-steel-700 object-cover"
                        />
                      </a>
                    </div>
                  )}
                </dl>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

function Detail({ label, value, danger }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-steel-400">{label}</dt>
      <dd className={`mt-0.5 text-sm ${danger ? 'text-danger/90' : 'text-steel-200'}`}>
        {value || '—'}
      </dd>
    </div>
  )
}

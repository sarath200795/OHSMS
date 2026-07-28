import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { format } from 'date-fns'
import { Wrench, CheckCircle2, X, Flame, HeartPulse, BellRing } from 'lucide-react'
import toast from 'react-hot-toast'
import { PageHeader, EmptyState, Badge } from './components/ui'
import { useFleet } from './context/FleetContext'
import { useAuth } from './context/AuthContext'
import { resolveDefects, decideAssetReport } from './lib/firestore'
import { toDate } from './lib/extinguisherLogic'
import { DEFECT_BY_KEY, REGION_COLORS } from './lib/constants'

// One place for every reported equipment defect — fire extinguishers (open
// physical defects) plus AED / fire-alarm QR-scan reports — with the action to
// close each from here.
export default function DefectRepository() {
  const { physicalOpen, pendingReports, extinguishers } = useFleet()
  const { orgId, orgName, profile, isManager } = useAuth()
  const [busyId, setBusyId] = useState(null)

  const fmt = (v) => { const d = toDate(v); return d ? format(d, 'dd MMM yyyy') : '—' }

  const rows = useMemo(() => {
    const ext = (physicalOpen || []).map((r) => ({
      key: `ext:${r.id}`,
      kind: 'Extinguisher',
      icon: Flame,
      color: '#dc2626',
      label: r.serialNo || '—',
      sub: [r.type, r.capacity].filter(Boolean).join(' · '),
      site: r.centerName || '',
      region: r.region || '',
      defect: r.defectLabel,
      defectColor: DEFECT_BY_KEY[r.defectType]?.color || '#64748b',
      reportedAt: r.reportedAt,
      source: 'ext',
      raw: r,
    }))
    const asset = (pendingReports || [])
      .filter((r) => r.kind === 'asset_defect')
      .map((r) => ({
        key: `asset:${r.id}`,
        kind: r.assetKind === 'fas' ? 'Fire Alarm' : 'AED',
        icon: r.assetKind === 'fas' ? BellRing : HeartPulse,
        color: r.assetKind === 'fas' ? '#f59e0b' : '#0ea5e9',
        label: r.assetLabel || '—',
        sub: 'Reported via QR scan',
        site: '',
        region: '',
        defect: r.defect,
        defectColor: '#dc2626',
        reportedAt: r.reportedAt,
        source: 'asset',
        raw: r,
      }))
    return [...ext, ...asset].sort(
      (a, b) => (toDate(b.reportedAt)?.getTime() || 0) - (toDate(a.reportedAt)?.getTime() || 0),
    )
  }, [physicalOpen, pendingReports])

  const resolveExt = async (row) => {
    const e = extinguishers.find((x) => x.id === row.raw.extId)
    if (!e) return toast.error('Unit not found')
    setBusyId(row.key)
    try {
      const remaining = (e.physicalDefects || []).filter((d) => d !== row.raw.defectType)
      await resolveDefects(orgId, orgName, row.raw.extId, remaining, profile?.name)
      toast.success(`Resolved: ${row.defect}`)
    } catch (err) {
      toast.error(err.message || 'Could not resolve the defect')
    } finally {
      setBusyId(null)
    }
  }

  const decideAsset = async (row, approve) => {
    setBusyId(row.key)
    try {
      await decideAssetReport(orgId, row.raw, approve, profile?.name, { uid: profile?.uid, name: profile?.name })
      toast.success(approve ? 'Defect confirmed — asset flagged & report closed' : 'Defect report dismissed')
    } catch (err) {
      toast.error(err.message || 'Could not update the report')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <PageHeader
        title="Defect Repository"
        subtitle="Every reported equipment defect — extinguishers, AED and fire-alarm — in one place, ready to close."
        icon={Wrench}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="No open defects"
          hint="Reported defects across all emergency equipment appear here for closure. 🛠️"
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[840px] text-sm">
              <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-3">Equipment</th>
                  <th className="px-4 py-3">Identifier</th>
                  <th className="px-4 py-3">Site</th>
                  <th className="px-4 py-3">Defect</th>
                  <th className="px-4 py-3">Reported</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-clay-200/60">
                {rows.map((row, i) => {
                  const Icon = row.icon
                  return (
                    <motion.tr
                      key={row.key}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: Math.min(i * 0.02, 0.4) }}
                      className="hover:bg-clay-100/50"
                      style={{ boxShadow: `inset 4px 0 0 ${row.color}` }}
                    >
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-2 font-semibold text-ink-800">
                          <Icon size={15} style={{ color: row.color }} /> {row.kind}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-bold text-ink-900">{row.label}</div>
                        {row.sub && <div className="text-xs text-ink-500">{row.sub}</div>}
                      </td>
                      <td className="px-4 py-3 text-ink-700">
                        {row.site || <span className="text-ink-300">—</span>}
                        {row.region && (
                          <Badge className="ml-1.5" color={REGION_COLORS[row.region] || '#64748b'}>{row.region}</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3"><Badge color={row.defectColor}>{row.defect}</Badge></td>
                      <td className="px-4 py-3 text-ink-600">{fmt(row.reportedAt)}</td>
                      <td className="px-4 py-3 text-right">
                        {!isManager ? (
                          <span className="text-xs text-ink-400">Manager only</span>
                        ) : row.source === 'ext' ? (
                          <button
                            className="btn-ghost px-2.5 py-1.5 text-xs font-semibold text-green-600 hover:bg-green-50"
                            disabled={busyId === row.key}
                            onClick={() => resolveExt(row)}
                            title="Mark this defect as resolved"
                          >
                            <CheckCircle2 size={14} /> Resolve
                          </button>
                        ) : (
                          <div className="inline-flex gap-1.5">
                            <button
                              className="btn-ghost px-2.5 py-1.5 text-xs font-semibold text-green-600 hover:bg-green-50"
                              disabled={busyId === row.key}
                              onClick={() => decideAsset(row, true)}
                              title="Confirm the defect — flag the asset and close the report"
                            >
                              <CheckCircle2 size={14} /> Confirm
                            </button>
                            <button
                              className="btn-ghost px-2.5 py-1.5 text-xs font-semibold text-ink-500 hover:bg-ink-100"
                              disabled={busyId === row.key}
                              onClick={() => decideAsset(row, false)}
                              title="Dismiss — false report"
                            >
                              <X size={14} /> Dismiss
                            </button>
                          </div>
                        )}
                      </td>
                    </motion.tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

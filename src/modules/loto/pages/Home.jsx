import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { useOrgProcedures } from '../hooks/useOrgProcedures'
import { PERMISSIONS } from '../constants/roles'
import { ENERGY_SOURCES, LOTO_DEVICES, deviceLabel, pointDeviceKeys } from '../constants/energySources'
import { lockoutDeviceTally } from '../utils/lockout'
import {
  LOCK_STATUS,
  LOCK_STATUS_META,
  PROCEDURE_STATUS,
  PROCEDURE_STATUS_META,
} from '../constants/procedures'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Spinner from '../components/ui/Spinner'
import EmptyState from '../components/EmptyState'
import PageHeader, { HdrIcon } from '../components/PageHeader'
import Donut from '../components/charts/Donut'
import BarList from '../components/charts/BarList'

const STATUS_ORDER = [
  PROCEDURE_STATUS.DRAFT,
  PROCEDURE_STATUS.PENDING_APPROVAL,
  PROCEDURE_STATUS.APPROVED,
  PROCEDURE_STATUS.REJECTED,
]
const STATUS_COLORS = {
  [PROCEDURE_STATUS.DRAFT]: '#a39d91',
  [PROCEDURE_STATUS.PENDING_APPROVAL]: '#f5b400',
  [PROCEDURE_STATUS.APPROVED]: '#2e9e5b',
  [PROCEDURE_STATUS.REJECTED]: '#e5484d',
}
const DEVICE_COLORS = {
  safety_padlock: '#e0ad00',
  hasp: '#2f7fe2',
  pin_inout: '#9b51e0',
  ball_valve_lock: '#2faa57',
  gate_valve_lock: '#17a2b8',
  plug_cover: '#ff7a00',
  cable_lockout: '#e5484d',
  flange_blind: '#b5179e',
  group_loto_box: '#7048e8',
}
const LOCK_COLORS = { unlocked: '#a39d91', partial: '#f5b400', locked: '#e5484d' }

function ChartCard({ title, subtitle, children }) {
  return (
    <Card animate={false} className="p-5">
      <h3 className="font-bold text-steel-50">{title}</h3>
      {subtitle && <p className="mb-3 text-xs text-steel-400">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </Card>
  )
}

function StatCard({ value, label, tile, icon }) {
  return (
    <Card animate={false} className="p-4">
      <span className={`grid h-9 w-9 place-items-center rounded-xl ${tile}`}>{icon}</span>
      <div className="mt-3 text-3xl font-extrabold tracking-tight text-steel-50">{value}</div>
      <div className="text-xs font-medium text-steel-400">{label}</div>
    </Card>
  )
}

export default function Home() {
  const { profile, org, can } = useAuth()
  const navigate = useNavigate()
  const { procedures, loading } = useOrgProcedures()
  const [siteFilter, setSiteFilter] = useState('')

  // Distinct sites present in the data, for the dashboard filter.
  const siteList = useMemo(() => {
    const set = new Set()
    procedures.forEach((p) => p.site && set.add(p.site))
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [procedures])

  // Procedures scoped to the selected site (all sites when none selected).
  const filtered = useMemo(
    () => (siteFilter ? procedures.filter((p) => p.site === siteFilter) : procedures),
    [procedures, siteFilter],
  )

  const m = useMemo(() => {
    const energy = Object.fromEntries(ENERGY_SOURCES.map((e) => [e.key, 0]))
    const device = Object.fromEntries(LOTO_DEVICES.map((d) => [d.key, 0]))
    const deviceInUse = {} // includes group-lock hardware (padlocks/hasp/box)
    const status = { draft: 0, pending_approval: 0, approved: 0, rejected: 0 }
    const lock = { unlocked: 0, partial: 0, locked: 0 }
    let points = 0
    let lockedPoints = 0
    filtered.forEach((p) => {
      if (status[p.status] != null) status[p.status] += 1
      const ls = p.lockSummary?.status || 'unlocked'
      lock[ls] = (lock[ls] || 0) + 1
      ;(p.isolationPoints || []).forEach((pt) => {
        points += 1
        if (energy[pt.energySource] != null) energy[pt.energySource] += 1
        pointDeviceKeys(pt).forEach((key) => {
          if (device[key] != null) device[key] += 1
        })
        if (pt.lockState?.locked) lockedPoints += 1
      })
      // Devices actually in use (locked-point isolation devices + group hardware)
      Object.entries(lockoutDeviceTally(p)).forEach(([k, v]) => {
        deviceInUse[k] = (deviceInUse[k] || 0) + v
      })
    })
    const devicesInUseTotal = Object.values(deviceInUse).reduce((s, v) => s + v, 0)
    return { energy, device, deviceInUse, status, lock, points, lockedPoints, devicesInUseTotal }
  }, [filtered])

  const energyData = ENERGY_SOURCES.map((e) => ({
    label: e.label.replace(' Energy', ''),
    value: m.energy[e.key],
    color: e.color,
  })).filter((d) => d.value > 0)

  const deviceData = LOTO_DEVICES.map((d) => ({
    label: d.label,
    value: m.device[d.key],
    color: DEVICE_COLORS[d.key] || '#8a857a',
  }))

  const deviceInUseData = Object.entries(m.deviceInUse)
    .map(([key, value]) => ({
      label: deviceLabel(key),
      value,
      color: DEVICE_COLORS[key] || '#8a857a',
    }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value)

  const statusData = STATUS_ORDER.map((s) => ({
    label: PROCEDURE_STATUS_META[s].label,
    value: m.status[s],
    color: STATUS_COLORS[s],
  })).filter((d) => d.value > 0)

  const lockData = [
    { label: 'Not Locked', value: m.lock.unlocked, color: LOCK_COLORS.unlocked },
    { label: 'Partially Locked', value: m.lock.partial, color: LOCK_COLORS.partial },
    { label: 'Fully Locked', value: m.lock.locked, color: LOCK_COLORS.locked },
  ].filter((d) => d.value > 0)

  // Equipment currently locked (fully or partially), fully-locked first.
  const rank = (p) => (p.lockSummary?.status === LOCK_STATUS.LOCKED ? 2 : 1)
  const lockedEquipment = filtered
    .filter((p) => (p.lockSummary?.status || 'unlocked') !== LOCK_STATUS.UNLOCKED)
    .sort((a, b) => rank(b) - rank(a) || (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0))

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <PageHeader
        icon={<HdrIcon d={<><rect x="3" y="3" width="8" height="8" rx="2" /><rect x="13" y="3" width="8" height="8" rx="2" /><rect x="3" y="13" width="8" height="8" rx="2" /><rect x="13" y="13" width="8" height="8" rx="2" /></>} />}
        title={`Welcome, ${profile?.displayName?.split(' ')[0] || ''}`}
        subtitle={`${org?.name || 'Organization'} · LOTO operations overview`}
        actions={
          can(PERMISSIONS.PROCEDURE_CREATE) ? (
            <button
              onClick={() => navigate('/loto/procedures/new')}
              className="rounded-2xl bg-hazard px-4 py-2 text-sm font-semibold text-ink shadow-clay hover:bg-hazard-dark"
            >
              + New procedure
            </button>
          ) : null
        }
      />

      {loading ? (
        <div className="py-20">
          <Spinner label="Loading dashboard…" />
        </div>
      ) : procedures.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No procedures yet"
            subtitle="Create your first LOTO procedure to populate the dashboard."
          />
        </div>
      ) : (
        <>
          {/* Site filter */}
          {siteList.length > 0 && (
            <div className="mt-6 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-steel-400">
                Site
              </span>
              <select
                value={siteFilter}
                onChange={(e) => setSiteFilter(e.target.value)}
                className="rounded-xl bg-clay px-3 py-1.5 text-sm text-steel-100 shadow-clay-inset outline-none ring-2 ring-transparent focus:ring-hazard/50"
              >
                <option value="">All sites</option>
                {siteList.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              {siteFilter && (
                <button
                  onClick={() => setSiteFilter('')}
                  className="text-xs font-medium text-amber-600 hover:underline"
                >
                  Clear
                </button>
              )}
            </div>
          )}

          {/* Stat cards */}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard
              value={filtered.length}
              label="Total Procedures"
              tile="bg-[#1f1c17] text-hazard"
              icon={<HdrIcon d={<><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>} />}
            />
            <StatCard
              value={m.points}
              label="Isolation Points"
              tile="bg-amber-100 text-amber-700"
              icon={<HdrIcon d={<><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>} />}
            />
            <StatCard
              value={m.status.approved}
              label="Approved"
              tile="bg-safe/15 text-safe"
              icon={<HdrIcon d={<path d="M20 6 9 17l-5-5" />} />}
            />
            <StatCard
              value={m.status.pending_approval}
              label="Pending Approval"
              tile="bg-amber-100 text-amber-700"
              icon={<HdrIcon d={<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>} />}
            />
            <StatCard
              value={m.lock.locked}
              label="Fully Locked"
              tile="bg-danger/15 text-danger"
              icon={<HdrIcon d={<><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>} />}
            />
            <StatCard
              value={m.lock.partial}
              label="Partially Locked"
              tile="bg-amber-100 text-amber-700"
              icon={<HdrIcon d={<><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 7-2.6" /></>} />}
            />
          </div>

          {/* Energy legend */}
          <Card animate={false} className="mt-4 p-4">
            <div className="mb-2 text-xs font-bold uppercase tracking-widest text-steel-400">
              Energy sources in use
            </div>
            <div className="flex flex-wrap gap-2">
              {ENERGY_SOURCES.map((e) => (
                <span
                  key={e.key}
                  className="inline-flex items-center gap-2 rounded-full bg-clay px-3 py-1 text-xs font-medium text-steel-200 shadow-clay-inset"
                >
                  <span className="grid h-5 w-5 place-items-center rounded text-[10px] font-bold" style={{ background: e.color, color: e.textColor }}>
                    {e.prefix}
                  </span>
                  {e.label.replace(' Energy', '')}
                  <span className="font-bold text-steel-50">{m.energy[e.key]}</span>
                </span>
              ))}
            </div>
          </Card>

          {/* Charts */}
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
              <ChartCard title="Energy Sources" subtitle="Isolation points by energy type">
                {energyData.length ? (
                  <Donut data={energyData} centerTop={m.points} centerSub="points" />
                ) : (
                  <p className="text-sm text-steel-400">No isolation points yet.</p>
                )}
              </ChartCard>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
              <ChartCard title="Lockout Devices" subtitle="Isolation points by LOTO device (defined)">
                <BarList data={deviceData} />
              </ChartCard>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
              <ChartCard
                title="Lockout Devices In Use"
                subtitle="Devices currently applied on locked points"
              >
                {deviceInUseData.length > 0 ? (
                  <>
                    <BarList data={deviceInUseData} />
                    <div className="mt-3 text-xs font-medium text-steel-400">
                      {m.devicesInUseTotal} device{m.devicesInUseTotal === 1 ? '' : 's'} in use
                      (incl. group-lock hardware)
                    </div>
                  </>
                ) : (
                  <p className="py-6 text-center text-sm text-steel-400">
                    No devices currently in use — nothing is locked.
                  </p>
                )}
              </ChartCard>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
              <ChartCard title="Approval Status" subtitle="Procedures by lifecycle status">
                {statusData.length ? (
                  <Donut data={statusData} centerTop={filtered.length} centerSub="procedures" />
                ) : (
                  <p className="text-sm text-steel-400">No procedures yet.</p>
                )}
              </ChartCard>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
              <ChartCard title="Lock Status" subtitle="Equipment by current lock state">
                {lockData.length ? (
                  <Donut data={lockData} centerTop={filtered.length} centerSub="equipment" />
                ) : (
                  <p className="text-sm text-steel-400">No data yet.</p>
                )}
              </ChartCard>
            </motion.div>
          </div>

          {/* Locked equipment list */}
          <Card animate={false} className="mt-4 p-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-steel-50">Locked Equipment</h3>
                <p className="text-xs text-steel-400">
                  Equipment with one or more points currently locked out
                </p>
              </div>
              {lockedEquipment.length > 0 && (
                <span className="rounded-full bg-danger/15 px-3 py-1 text-sm font-bold text-danger">
                  {lockedEquipment.length}
                </span>
              )}
            </div>

            {lockedEquipment.length === 0 ? (
              <p className="py-8 text-center text-sm text-steel-400">
                No equipment is currently locked.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-steel-700/60">
                {lockedEquipment.map((p) => {
                  const status = p.lockSummary?.status || LOCK_STATUS.UNLOCKED
                  const meta = LOCK_STATUS_META[status]
                  return (
                    <li key={p.id}>
                      <button
                        onClick={() => navigate(`/loto/procedures/${p.id}`)}
                        className="flex w-full items-center justify-between gap-3 py-2.5 text-left transition-colors hover:bg-steel-800/40"
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ background: LOCK_COLORS[status] }}
                          />
                          <span className="min-w-0">
                            <span className="block truncate font-semibold text-steel-100">
                              {p.equipment}
                            </span>
                            <span className="block truncate text-xs text-steel-400">
                              {p.site} · <span className="font-mono">{p.procedureCode}</span>
                            </span>
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-3">
                          <span className="text-xs text-steel-400">
                            {p.lockSummary?.lockedCount || 0}/{p.lockSummary?.total || 0} pts
                          </span>
                          <Badge className={meta.accent}>
                            {status === LOCK_STATUS.LOCKED ? '🔒 ' : ''}
                            {meta.label}
                          </Badge>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

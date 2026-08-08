import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, Download, Trash2, Pencil, Cctv, HardDrive, Router } from 'lucide-react'
import {
  PageHeader, Button, Modal, Field, Input, Select, Textarea, EmptyState, SkeletonTable,
} from '../../../shared/ui'
import { useAuth } from '../../../shared/auth/AuthContext'
import { useCctv } from '../context/CctvContext'
import {
  addCamera, updateCamera, deleteCamera,
  addDvr, updateDvr, deleteDvr,
  addMeraki, updateMeraki, deleteMeraki,
  setDefects, provisionSiteMerakis,
} from '../lib/firestore'
import { sitesMissingMeraki } from '../lib/provision'
import {
  siteMeta, filterByScope, narrowSites, reconcileScope, scopeFacets, isScoped, EMPTY_SCOPE,
} from '../lib/filters'
import { downloadInventory } from '../lib/exporter'
import {
  REPORTABLE_CAMERA_DEFECTS, REPORTABLE_DVR_DEFECTS, REPORTABLE_MERAKI_DEFECTS,
  CAMERA_DEFECT_BY_KEY, DVR_DEFECT_BY_KEY, MERAKI_DEFECT_BY_KEY,
} from '../lib/constants'
import { StatusChip, DefectChips } from '../components/ui'

const TABS = [
  { key: 'cameras', label: 'Cameras', icon: Cctv },
  { key: 'dvrs', label: 'DVR', icon: HardDrive },
  { key: 'merakis', label: 'Meraki', icon: Router },
]

const STATUS_OPTIONS = [
  { value: 'online', label: 'Online' },
  { value: 'offline', label: 'Offline' },
  { value: 'unknown', label: 'Not reported' },
]

const EMPTY = {
  cameras: { name: '', location: '', dvrId: '', siteId: '', siteName: '', status: 'online', make: '', model: '', channel: '', notes: '' },
  dvrs: { name: '', ipAddress: '', siteId: '', siteName: '', status: 'online', channels: '', make: '', model: '', location: '', notes: '' },
  merakis: { name: '', ipAddress: '', siteId: '', siteName: '', status: 'online', model: '', serial: '', notes: '' },
}

export default function Inventory() {
  const { orgId, orgName, actor, isManager } = useAuth()
  const { cameras, dvrs, merakis, sites, estate, loading, dvrOptions, siteOptions } = useCctv()
  const [tab, setTab] = useState('cameras')
  const [scope, setScopeRaw] = useState(EMPTY_SCOPE)
  const [form, setForm] = useState(null) // { kind, id?, data }
  const [defectFor, setDefectFor] = useState(null) // { kind, row }
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')

  // Health is keyed by id so a row can show its effective status without
  // recomputing the cascade per row.
  const health = useMemo(
    () => ({
      cameras: new Map(estate.cameras.map((c) => [c.id, c])),
      dvrs: new Map(estate.dvrs.map((d) => [d.id, d])),
      merakis: new Map(estate.merakis.map((m) => [m.id, m])),
    }),
    [estate]
  )

  const meta = useMemo(() => siteMeta(sites), [sites])
  const facets = useMemo(() => scopeFacets(sites), [sites])
  // Only the sites the chosen entity/region can actually contain, so nobody can
  // build a combination that is guaranteed to return nothing.
  const sitesInScope = useMemo(() => narrowSites(sites, scope), [sites, scope])

  // Resolved inside the memo: `{cameras, dvrs, merakis}[tab]` builds a fresh
  // object every render, so as a dependency it would defeat the memo entirely
  // and re-filter the whole estate on every keystroke.
  const filtered = useMemo(() => {
    const rows = { cameras, dvrs, merakis }[tab] || []
    // A camera can inherit its site from its DVR, so the id worth testing is
    // the one the health pass resolved rather than the raw field.
    const siteIdOf = (r) => health[tab].get(r.id)?.siteId || r.siteId
    const scoped = filterByScope(rows, scope, meta, siteIdOf)
    const needle = q.trim().toLowerCase()
    if (!needle) return scoped
    return scoped.filter((r) =>
      [r.name, r.location, r.ipAddress, r.siteName, r.model, r.serial]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle))
    )
  }, [cameras, dvrs, merakis, tab, q, scope, meta, health])

  // Every scope change is reconciled: choosing a region can strand a site
  // outside it, and an empty table with two filters set reads as "no cameras"
  // rather than "impossible combination".
  const setScope = (patch) => setScopeRaw((s) => reconcileScope({ ...s, ...patch }, sites))

  const open = (kind, row) => setForm({ kind, id: row?.id, data: { ...EMPTY[kind], ...(row || {}) } })
  const patch = (p) => setForm((f) => ({ ...f, data: { ...f.data, ...p } }))

  // Picking a site sets both id and name: the name is denormalised onto every
  // device so exports and the health roll-up read without a join.
  const pickSite = (siteId) => {
    const s = sites.find((x) => x.id === siteId)
    patch({ siteId, siteName: s?.name || s?.siteName || '' })
  }

  const save = async () => {
    const { kind, id, data } = form
    if (!data.name.trim()) return toast.error('Give it a name')
    if (kind === 'cameras' && !data.dvrId) {
      return toast.error('Pick the DVR this camera records to — health is calculated down that chain')
    }
    setBusy(true)
    try {
      // A camera with no site of its own inherits its DVR's, so the site
      // roll-up never loses it.
      const payload = { ...data }
      if (kind === 'cameras' && !payload.siteId) {
        const d = dvrs.find((x) => x.id === payload.dvrId)
        if (d) { payload.siteId = d.siteId; payload.siteName = d.siteName }
      }
      const fn = {
        cameras: id ? updateCamera : addCamera,
        dvrs: id ? updateDvr : addDvr,
        merakis: id ? updateMeraki : addMeraki,
      }[kind]
      await (id ? fn(orgId, id, payload, actor) : fn(orgId, payload, actor))
      toast.success(id ? 'Saved' : 'Added')
      setForm(null)
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (kind, row) => {
    const fn = { cameras: deleteCamera, dvrs: deleteDvr, merakis: deleteMeraki }[kind]
    const warn =
      kind === 'dvrs'
        ? `Delete ${row.name}? Cameras recording to it will lose their link and their health cannot be judged.`
        : kind === 'merakis'
        ? `Delete ${row.name}? Its site will no longer be marked dark when the network is down.`
        : `Delete ${row.name}?`
    // eslint-disable-next-line no-alert
    if (!window.confirm(warn)) return
    try {
      await fn(orgId, row.id, row.name, actor)
      toast.success('Removed')
    } catch (e) {
      toast.error(e.message)
    }
  }

  // Sites with no switch on record are the ones where health silently cannot
  // cascade, so the gap is surfaced wherever the Meraki list is being looked at.
  const uncovered = useMemo(() => sitesMissingMeraki(sites, merakis), [sites, merakis])

  const provision = async () => {
    setBusy(true)
    try {
      const n = await provisionSiteMerakis(orgId, sites, merakis, actor)
      toast.success(n ? `Created ${n} Meraki device${n === 1 ? '' : 's'}` : 'Every site already has one')
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  const saveDefects = async (keys) => {
    const { kind, row } = defectFor
    try {
      await setDefects(orgId, kind, row.id, keys, actor, row.name)
      toast.success('Defects updated')
      setDefectFor(null)
    } catch (e) {
      toast.error(e.message)
    }
  }

  const defectTable = { cameras: CAMERA_DEFECT_BY_KEY, dvrs: DVR_DEFECT_BY_KEY, merakis: MERAKI_DEFECT_BY_KEY }[tab]

  return (
    <>
      <PageHeader
        title="CCTV Inventory"
        subtitle={`${cameras.length} cameras · ${dvrs.length} DVR · ${merakis.length} Meraki`}
        actions={
          <div className="flex gap-2">
            <Button
              variant="ghost"
              icon={Download}
              onClick={() => downloadInventory({ cameras: estate.cameras, dvrs, merakis }, { orgName })}
            >
              Export
            </Button>
            {isManager && (
              <Button icon={Plus} onClick={() => open(tab)}>
                Add {tab === 'merakis' ? 'Meraki' : tab === 'dvrs' ? 'DVR' : 'camera'}
              </Button>
            )}
          </div>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold transition ${
              tab === t.key ? 'bg-ink-900 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
            }`}
          >
            <t.icon size={14} /> {t.label}
          </button>
        ))}
        <Input
          className="ml-auto max-w-xs"
          placeholder="Search name, location, IP…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {/* Entity and region live on the site record, not on the device, so both
          resolve through it — a site moved between entities must not leave its
          cameras claiming the old one. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select
          aria-label="Filter by entity"
          className="w-auto"
          value={scope.entity}
          onChange={(e) => setScope({ entity: e.target.value })}
        >
          <option value="">All entities</option>
          {facets.entities.map((x) => <option key={x} value={x}>{x}</option>)}
        </Select>
        <Select
          aria-label="Filter by region"
          className="w-auto"
          value={scope.region}
          onChange={(e) => setScope({ region: e.target.value })}
        >
          <option value="">All regions</option>
          {facets.regions.map((x) => <option key={x} value={x}>{x}</option>)}
        </Select>
        <Select
          aria-label="Filter by site"
          className="w-auto"
          value={scope.siteId}
          onChange={(e) => setScope({ siteId: e.target.value })}
        >
          <option value="">All sites</option>
          {sitesInScope.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>

        {isScoped(scope) && (
          <>
            <Button variant="ghost" className="px-2.5 py-1.5 text-xs" onClick={() => setScopeRaw(EMPTY_SCOPE)}>
              Clear filters
            </Button>
            {/* Says what is on screen against what exists, so a filtered count
                is never mistaken for the size of the estate. */}
            <span className="text-xs text-ink-500">
              {filtered.length} of {({ cameras, dvrs, merakis }[tab] || []).length}
            </span>
          </>
        )}
      </div>

      {/* Standard-issue provisioning. Shown on the Meraki tab because that is
          where the gap is being looked at, and only when there IS a gap. */}
      {tab === 'merakis' && isManager && uncovered.length > 0 && (
        <div className="card mb-3 flex flex-wrap items-center gap-3 p-4">
          <Router size={18} className="shrink-0 text-amber-600" />
          <div className="min-w-[16rem] flex-1 text-sm text-ink-700">
            <b>{uncovered.length}</b> site{uncovered.length === 1 ? ' has' : 's have'} no Meraki on record
            {uncovered.length <= 4 ? ` (${uncovered.map((s) => s.name || s.id).join(', ')})` : ''}. Until
            {uncovered.length === 1 ? ' it is' : ' they are'} added, a network outage there shows up as every
            camera failing separately rather than as one fault.
          </div>
          <Button loading={busy} onClick={provision}>
            Create standard Meraki for each site
          </Button>
        </div>
      )}

      {loading ? (
        <SkeletonTable rows={5} />
      ) : !filtered.length ? (
        <EmptyState
          icon={TABS.find((t) => t.key === tab)?.icon || Cctv}
          title={q ? 'Nothing matches that search' : `No ${TABS.find((t) => t.key === tab)?.label} yet`}
          hint={
            q
              ? 'Clear the search to see everything.'
              : tab === 'cameras'
              ? 'Add the DVRs first — a camera has to record to one for its health to mean anything.'
              : 'Add your first device to start tracking health.'
          }
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-ink-50/60 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-3 py-2">Name</th>
                {tab === 'cameras' ? <th className="px-3 py-2">Location</th> : <th className="px-3 py-2">IP address</th>}
                <th className="px-3 py-2">Site</th>
                {tab === 'cameras' && <th className="px-3 py-2">DVR</th>}
                {tab === 'dvrs' && <th className="px-3 py-2">Channels</th>}
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Defects</th>
                {isManager && <th className="px-3 py-2 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const h = health[tab].get(row.id)
                return (
                  <tr key={row.id} className="border-t border-ink-100">
                    <td className="px-3 py-2 font-medium text-ink-800">{row.name}</td>
                    {tab === 'cameras' ? (
                      <td className="px-3 py-2">{row.location || '—'}</td>
                    ) : (
                      <td className="px-3 py-2 font-mono text-xs">{row.ipAddress || '—'}</td>
                    )}
                    <td className="px-3 py-2">{row.siteName || h?.siteName || '—'}</td>
                    {tab === 'cameras' && <td className="px-3 py-2">{h?.dvrName || '—'}</td>}
                    {tab === 'dvrs' && <td className="px-3 py-2">{row.channels || '—'}</td>}
                    <td className="px-3 py-2"><StatusChip health={h} /></td>
                    <td className="px-3 py-2">
                      <DefectChips keys={(row.defects || []).filter(Boolean)} table={defectTable} />
                    </td>
                    {isManager && (
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setDefectFor({ kind: tab, row })}>
                            Defects
                          </Button>
                          <Button variant="ghost" className="px-2 py-1 text-xs" icon={Pencil} onClick={() => open(tab, row)} />
                          <Button variant="ghost" className="px-2 py-1 text-xs" icon={Trash2} onClick={() => remove(tab, row)} />
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Add / edit ── */}
      <Modal
        open={Boolean(form)}
        onClose={() => setForm(null)}
        title={`${form?.id ? 'Edit' : 'Add'} ${form?.kind === 'merakis' ? 'Meraki device' : form?.kind === 'dvrs' ? 'DVR' : 'camera'}`}
      >
        {form && (
          <div className="space-y-4 p-6">
            <Field label="Name *" htmlFor="cname">
              <Input id="cname" value={form.data.name} onChange={(e) => patch({ name: e.target.value })}
                placeholder={form.kind === 'cameras' ? 'CAM-01' : form.kind === 'dvrs' ? 'DVR-01' : 'MX-Gate'} />
            </Field>

            {form.kind === 'cameras' ? (
              <>
                <Field label="Location" htmlFor="cloc" hint="Where it points — the thing a guard would say">
                  <Input id="cloc" value={form.data.location} onChange={(e) => patch({ location: e.target.value })}
                    placeholder="Main gate, east approach" />
                </Field>
                <Field label="Records to DVR *" htmlFor="cdvr" hint="Health cascades down this link">
                  <Select id="cdvr" value={form.data.dvrId} onChange={(e) => patch({ dvrId: e.target.value })}>
                    <option value="">Select a DVR…</option>
                    {dvrOptions.map((o) => <option key={o.value} value={o.value}>{o.label}{o.siteName ? ` · ${o.siteName}` : ''}</option>)}
                  </Select>
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Channel" htmlFor="cch"><Input id="cch" value={form.data.channel} onChange={(e) => patch({ channel: e.target.value })} placeholder="CH-04" /></Field>
                  <Field label="Make / model" htmlFor="cmk"><Input id="cmk" value={form.data.model} onChange={(e) => patch({ model: e.target.value })} /></Field>
                </div>
              </>
            ) : (
              <>
                <Field label="IP address" htmlFor="cip">
                  <Input id="cip" value={form.data.ipAddress} onChange={(e) => patch({ ipAddress: e.target.value })} placeholder="10.0.0.10" />
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  {form.kind === 'dvrs' ? (
                    <Field label="Channels" htmlFor="cch"><Input id="cch" type="number" value={form.data.channels} onChange={(e) => patch({ channels: e.target.value })} /></Field>
                  ) : (
                    <Field label="Serial" htmlFor="cser"><Input id="cser" value={form.data.serial} onChange={(e) => patch({ serial: e.target.value })} /></Field>
                  )}
                  <Field label="Model" htmlFor="cmod"><Input id="cmod" value={form.data.model} onChange={(e) => patch({ model: e.target.value })} /></Field>
                </div>
              </>
            )}

            <div className="grid grid-cols-2 gap-4">
              <Field
                label="Site"
                htmlFor="csite"
                hint={form.kind === 'merakis' ? 'Its outage darkens every DVR here' : undefined}
              >
                <Select id="csite" value={form.data.siteId} onChange={(e) => pickSite(e.target.value)}>
                  <option value="">{form.kind === 'cameras' ? 'Inherit from DVR' : 'Select a site…'}</option>
                  {siteOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              </Field>
              <Field label="Reported status" htmlFor="cstat">
                <Select id="cstat" value={form.data.status} onChange={(e) => patch({ status: e.target.value })}>
                  {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              </Field>
            </div>

            <Field label="Notes" htmlFor="cnote">
              <Textarea id="cnote" rows={2} value={form.data.notes} onChange={(e) => patch({ notes: e.target.value })} />
            </Field>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button>
              <Button loading={busy} onClick={save}>{form.id ? 'Save' : 'Add'}</Button>
            </div>
          </div>
        )}
      </Modal>

      <DefectModal
        target={defectFor}
        onClose={() => setDefectFor(null)}
        onSave={saveDefects}
      />
    </>
  )
}

/**
 * Raise or clear defects on a device.
 *
 * "Offline" is deliberately not on the list. It is derived from the reported
 * status in health.js, so offering it as a tick box would let someone mark a
 * streaming camera offline and have the two disagree forever.
 */
function DefectModal({ target, onClose, onSave }) {
  const options = {
    cameras: REPORTABLE_CAMERA_DEFECTS,
    dvrs: REPORTABLE_DVR_DEFECTS,
    merakis: REPORTABLE_MERAKI_DEFECTS,
  }[target?.kind] || []
  const current = (target?.row?.defects || []).filter(Boolean)
  const [picked, setPicked] = useState(current)
  const [busy, setBusy] = useState(false)

  // Reset when a different device is opened.
  const key = target?.row?.id
  const [lastKey, setLastKey] = useState(key)
  if (key !== lastKey) {
    setLastKey(key)
    setPicked(current)
  }

  const toggle = (k) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))

  return (
    <Modal open={Boolean(target)} onClose={onClose} title={`Defects — ${target?.row?.name || ''}`}>
      <div className="space-y-4 p-6">
        <p className="text-xs text-ink-500">
          Connectivity is tracked separately from the reported status — “Offline” is worked out from that, not
          ticked here.
        </p>
        <div className="flex flex-wrap gap-2">
          {options.map((d) => (
            <button
              key={d.key}
              type="button"
              onClick={() => toggle(d.key)}
              className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition ${
                picked.includes(d.key) ? 'bg-ink-900 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            loading={busy}
            onClick={async () => { setBusy(true); await onSave(picked); setBusy(false) }}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  )
}

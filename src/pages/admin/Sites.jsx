import { useEffect, useMemo, useState, lazy, Suspense } from 'react'
import toast from 'react-hot-toast'
import {
  Building2, Plus, Trash2, MapPin, Map as MapIcon, List, Pencil, Upload, Download, Search, X,
  CheckCircle2, AlertCircle, FireExtinguisher, HeartPulse, BriefcaseMedical, AlertTriangle,
  ListChecks, Users2, CheckSquare, Square, BellRing,
} from 'lucide-react'
import { useAuth } from '../../shared/auth/AuthContext'
import {
  subscribeSites, createSite, updateSite, deleteSite, deleteSites, bulkCreateSites,
  subscribeOrgUsers, subscribeCollection, cleanAttributes,
} from '../../shared/org/orgData'
import { can, roleLabel } from '../../shared/auth/permissions'
import {
  PageHeader, Button, Modal, Field, Input, Select, SkeletonTable, EmptyState, Badge, StatCard,
} from '../../shared/ui'
import { initials } from '../../shared/lib/format'
import { regionsOf, entitiesOf } from '../../shared/auth/access'
import { normalizeScopeConfig } from '../../shared/org/scopeConfig'
import { siteStats, linkAssets } from './siteStats'
import { parseSitesCsv, sitesCsvTemplate } from './parseSitesCsv'

const SitesMap = lazy(() => import('./SitesMap'))

const EMPTY = { name: '', region: '', entity: '', address: '', lat: '', lng: '', firstAidBoxes: '', attributes: {} }

export default function Sites() {
  const { orgId, actor, role, org } = useAuth()
  const customFields = useMemo(() => normalizeScopeConfig(org?.scopeConfig).customFields, [org])
  const [sites, setSites] = useState(null)
  const [users, setUsers] = useState([])
  const [extinguishers, setExtinguishers] = useState([])
  const [aeds, setAeds] = useState([])
  const [fas, setFas] = useState([])
  const [incidents, setIncidents] = useState([])
  const [tab, setTab] = useState('list')
  const [editing, setEditing] = useState(null) // 'new' | site | null
  const [form, setForm] = useState(EMPTY)
  const [selected, setSelected] = useState(null) // site for summary
  const [busy, setBusy] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkResult, setBulkResult] = useState(null) // { rows, valid, invalid, headerOk, fileName }
  const [bulkBusy, setBulkBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [regionFilter, setRegionFilter] = useState('')
  const [entityFilter, setEntityFilter] = useState('')
  // Bulk delete
  const [selectMode, setSelectMode] = useState(false)
  const [picked, setPicked] = useState([]) // site ids
  const [confirmBulk, setConfirmBulk] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const canManage = can(role, 'site.manage')

  useEffect(() => {
    if (!orgId) return
    const unsubs = [
      subscribeSites(orgId, setSites),
      subscribeOrgUsers(orgId, setUsers),
      subscribeCollection(orgId, 'extinguishers', setExtinguishers),
      subscribeCollection(orgId, 'aeds', setAeds),
      subscribeCollection(orgId, 'fas', setFas),
      subscribeCollection(orgId, 'incidents', setIncidents),
    ]
    return () => unsubs.forEach((u) => u && u())
  }, [orgId])

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const setAttr = (k) => (e) => setForm((f) => ({ ...f, attributes: { ...f.attributes, [k]: e.target.value } }))

  const openNew = () => { setForm(EMPTY); setEditing('new') }
  const openEdit = (s) => {
    setForm({
      name: s.name || '', region: s.region || '', entity: s.entity || '', address: s.address || '',
      lat: s.lat ?? '', lng: s.lng ?? '', firstAidBoxes: s.firstAidBoxes ?? '',
      attributes: s.attributes || {},
    })
    setEditing(s)
    setSelected(null)
  }

  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      if (editing === 'new') {
        await createSite(orgId, form, actor)
        toast.success('Site added')
      } else {
        await updateSite(orgId, editing.id, {
          name: form.name, region: form.region, entity: form.entity, address: form.address,
          lat: form.lat === '' ? null : Number(form.lat),
          lng: form.lng === '' ? null : Number(form.lng),
          firstAidBoxes: Number(form.firstAidBoxes) || 0,
          attributes: cleanAttributes(form.attributes),
        }, actor)
        toast.success('Site updated')
      }
      setEditing(null)
    } catch (err) {
      toast.error(err?.message || 'Failed')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (s) => {
    if (!window.confirm(`Delete site "${s.name}"?`)) return
    try {
      await deleteSite(orgId, s.id, actor, s.name)
      toast.success('Site deleted')
      setSelected(null)
    } catch (err) {
      toast.error(err?.message || 'Failed')
    }
  }

  const openBulk = () => { setBulkResult(null); setBulkOpen(true) }

  const onBulkFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file
    if (!file) return
    try {
      const res = await parseSitesCsv(file, customFields)
      setBulkResult({ ...res, fileName: file.name })
    } catch {
      toast.error('Could not read that CSV file')
    }
  }

  const downloadTemplate = () => {
    const blob = new Blob([sitesCsvTemplate(customFields)], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'sites-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const importBulk = async () => {
    if (!bulkResult?.valid?.length) return
    setBulkBusy(true)
    try {
      const n = await bulkCreateSites(orgId, bulkResult.valid, actor)
      toast.success(`Imported ${n} site${n === 1 ? '' : 's'}`)
      setBulkOpen(false)
      setBulkResult(null)
    } catch (err) {
      toast.error(err?.message || 'Import failed')
    } finally {
      setBulkBusy(false)
    }
  }

  // Every asset resolved to a site once. Shared by the panel and the map so the
  // two can never disagree, and computed here because the per-site rollup below
  // walks every asset for every site.
  const links = useMemo(
    () => linkAssets([...extinguishers, ...aeds, ...fas], sites || []),
    [extinguishers, aeds, fas, sites]
  )

  const stats = useMemo(
    () => (selected ? siteStats(selected, { extinguishers, aeds, fas, incidents, users, links }) : null),
    [selected, extinguishers, aeds, fas, incidents, users, links]
  )

  // Pre-computed summary per site, for the map hover bubbles.
  const statsBySite = useMemo(() => {
    const m = {}
    ;(sites || []).forEach((s) => {
      m[s.id] = siteStats(s, { extinguishers, aeds, fas, incidents, users, links })
    })
    return m
  }, [sites, extinguishers, aeds, fas, incidents, users, links])

  const regionOptions = useMemo(() => regionsOf(sites || []), [sites])
  const entityOptions = useMemo(() => entitiesOf(sites || []), [sites])
  const activeFilters = Boolean(search.trim() || regionFilter || entityFilter)

  const filteredSites = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (sites || []).filter((s) => {
      if (regionFilter && s.region !== regionFilter) return false
      if (entityFilter && s.entity !== entityFilter) return false
      if (q && !`${s.name} ${s.address || ''} ${s.region || ''} ${s.entity || ''}`.toLowerCase().includes(q))
        return false
      return true
    })
  }, [sites, search, regionFilter, entityFilter])

  // ── Bulk delete ────────────────────────────────────────────────────────────
  const togglePick = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const exitSelect = () => { setSelectMode(false); setPicked([]) }
  const pickedSites = useMemo(
    () => (sites || []).filter((s) => picked.includes(s.id)),
    [sites, picked]
  )
  // Records already logged against the chosen sites — deleting a site does not
  // delete these, so the user should know what will be left referencing it.
  const pickedImpact = useMemo(() => {
    const sum = { extinguishers: 0, aeds: 0, fas: 0, incidents: 0, users: 0 }
    for (const s of pickedSites) {
      const st = statsBySite[s.id]
      if (!st) continue
      sum.extinguishers += st.extinguishers || 0
      sum.aeds += st.aeds || 0
      sum.fas += st.fas || 0
      sum.incidents += st.incidents || 0
      sum.users += st.users || 0
    }
    return sum
  }, [pickedSites, statsBySite])

  const runBulkDelete = async () => {
    if (confirmText.trim().toUpperCase() !== 'DELETE') return toast.error('Type DELETE to confirm')
    setBusy(true)
    try {
      const n = await deleteSites(orgId, pickedSites, actor)
      toast.success(`${n} site${n === 1 ? '' : 's'} deleted`)
      setConfirmBulk(false); setConfirmText(''); exitSelect(); setSelected(null)
    } catch (err) {
      toast.error(err?.message || 'Failed')
    } finally {
      setBusy(false)
    }
  }

  const clearFilters = () => {
    setSearch('')
    setRegionFilter('')
    setEntityFilter('')
  }

  return (
    <>
      <PageHeader
        title="Sites"
        subtitle="Locations & departments — mapped, with a live safety summary"
        icon={Building2}
        actions={
          canManage && (
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" icon={Upload} onClick={openBulk}>Bulk upload</Button>
              <Button icon={Plus} onClick={openNew}>Add site</Button>
            </div>
          )
        }
      />

      {/* Tabs */}
      <div className="mb-5 flex gap-1.5 border-b border-ink-100 pb-3">
        {[
          { key: 'list', label: 'Sites', icon: List },
          { key: 'map', label: 'Map', icon: MapIcon },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); if (t.key !== 'list') exitSelect() }}
            className={[
              'inline-flex items-center gap-2 rounded-2xl px-3.5 py-2 text-sm font-medium transition-all duration-200 ease-emil',
              tab === t.key
                ? 'bg-clay-surface text-ink-900 shadow-clay-pressed'
                : 'text-ink-500 hover:bg-clay-100 hover:text-ink-800 active:scale-[0.98]',
            ].join(' ')}
          >
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </div>

      {/* Bulk-select toolbar — appears above the filters while selecting */}
      {canManage && tab === 'list' && sites && sites.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {!selectMode ? (
            <Button variant="ghost" icon={CheckSquare} className="!py-2" onClick={() => setSelectMode(true)}>
              Select sites
            </Button>
          ) : (
            <>
              <Button variant="ghost" className="!py-2"
                onClick={() => setPicked(picked.length === filteredSites.length ? [] : filteredSites.map((s) => s.id))}>
                {picked.length === filteredSites.length ? 'Clear all' : `Select all${activeFilters ? ' shown' : ''} (${filteredSites.length})`}
              </Button>
              <span className="text-sm font-semibold text-ink-700">{picked.length} selected</span>
              <Button
                icon={Trash2}
                variant="danger"
                className="!py-2"
                disabled={picked.length === 0}
                onClick={() => { setConfirmText(''); setConfirmBulk(true) }}
              >
                Delete {picked.length || ''}
              </Button>
              <Button variant="ghost" icon={X} className="!py-2" onClick={exitSelect}>Cancel</Button>
            </>
          )}
        </div>
      )}

      {/* Search + Region / Entity filters (apply to list and map) */}
      {sites && sites.length > 0 && (
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative sm:max-w-xs sm:flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <Input
              className="!py-2 pl-9"
              placeholder="Search sites…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select className="!py-2 sm:!w-44" value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)}>
            <option value="">All regions</option>
            {regionOptions.map((r) => <option key={r} value={r}>{r}</option>)}
          </Select>
          <Select className="!py-2 sm:!w-52" value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)}>
            <option value="">All entities</option>
            {entityOptions.map((en) => <option key={en} value={en}>{en}</option>)}
          </Select>
          {activeFilters && (
            <button
              onClick={clearFilters}
              className="inline-flex items-center gap-1 rounded-xl px-2.5 py-2 text-sm font-medium text-ink-500 hover:bg-clay-100 active:scale-95"
            >
              <X size={15} /> Clear
            </button>
          )}
          <span className="text-xs text-ink-400 sm:ml-auto">
            {filteredSites.length} of {sites.length}
          </span>
        </div>
      )}

      {/* List / Map */}
      {sites === null ? (
        <SkeletonTable rows={4} cols={3} />
      ) : sites.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No sites yet"
          description="Add your workplaces so records can be organized and mapped by location."
          action={canManage && <Button icon={Plus} onClick={openNew}>Add site</Button>}
        />
      ) : tab === 'map' ? (
        <Suspense fallback={<SkeletonTable rows={4} cols={2} />}>
          <SitesMap
            sites={filteredSites}
            stats={statsBySite}
            onSelect={(s) => { setTab('list'); setSelected(s) }}
            onEdit={(s) => { setTab('list'); openEdit(s) }}
            onDelete={(s) => { setTab('list'); remove(s) }}
            canManage={canManage}
          />
        </Suspense>
      ) : filteredSites.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No matching sites"
          description="No sites match your search or filters."
          action={<Button variant="ghost" onClick={clearFilters}>Clear filters</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredSites.map((s) => (
            <button
              key={s.id}
              onClick={() => (selectMode ? togglePick(s.id) : setSelected(s))}
              aria-pressed={selectMode ? picked.includes(s.id) : undefined}
              className={[
                'card group flex flex-col gap-3 p-5 text-left transition-transform duration-200 ease-emil hover:-translate-y-0.5 active:scale-[0.99]',
                selectMode && picked.includes(s.id) ? 'ring-2 ring-red-500' : '',
              ].join(' ')}
            >
              <div className="flex items-start justify-between gap-3">
                {selectMode ? (
                  <span className={`grid h-11 w-11 place-items-center rounded-2xl shadow-clay-sm ${picked.includes(s.id) ? 'bg-red-50 text-red-600' : 'bg-clay-100 text-ink-400'}`}>
                    {picked.includes(s.id) ? <CheckSquare size={20} /> : <Square size={20} />}
                  </span>
                ) : (
                  <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-50 text-brand-700 shadow-clay-sm">
                    <Building2 size={20} />
                  </span>
                )}
                {(s.region || s.entity) && (
                  <Badge tone="gray">{[s.region, s.entity].filter(Boolean).join(' · ')}</Badge>
                )}
              </div>
              <div>
                <p className="font-semibold text-ink-900">{s.name}</p>
                {s.address && (
                  <p className="mt-0.5 flex items-center gap-1 text-sm text-ink-500">
                    <MapPin size={13} /> {s.address}
                  </p>
                )}
              </div>
              <span className="text-xs font-medium text-brand-700 opacity-0 transition group-hover:opacity-100">
                {selectMode ? (picked.includes(s.id) ? 'Selected — click to remove' : 'Click to select') : 'View summary →'}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Create / edit modal */}
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add site' : 'Edit site'}
        size="lg"
        footer={
          <>
            <Button variant="ghost" type="button" onClick={() => setEditing(null)}>Cancel</Button>
            <Button form="site-form" type="submit" loading={busy}>
              {editing === 'new' ? 'Add site' : 'Save changes'}
            </Button>
          </>
        }
      >
        <form id="site-form" onSubmit={save} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Site name *" htmlFor="name">
              <Input id="name" required value={form.name} onChange={set('name')} placeholder="e.g. North Plant" />
            </Field>
          </div>
          <Field label="Region" htmlFor="region">
            <Input id="region" value={form.region} onChange={set('region')} placeholder="e.g. North" />
          </Field>
          <Field label="Entity" htmlFor="entity">
            <Input id="entity" value={form.entity} onChange={set('entity')} placeholder="e.g. Acme Mfg Pvt Ltd" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Address" htmlFor="address">
              <Input id="address" value={form.address} onChange={set('address')} placeholder="Street, City, Country" />
            </Field>
          </div>
          <Field label="Latitude" htmlFor="lat" hint="Decimal, e.g. 53.8008">
            <Input id="lat" type="number" step="any" value={form.lat} onChange={set('lat')} placeholder="53.8008" />
          </Field>
          <Field label="Longitude" htmlFor="lng" hint="Decimal, e.g. -1.5491">
            <Input id="lng" type="number" step="any" value={form.lng} onChange={set('lng')} placeholder="-1.5491" />
          </Field>
          <Field label="First aid boxes" htmlFor="fab" hint="Count at this site">
            <Input id="fab" type="number" min="0" value={form.firstAidBoxes} onChange={set('firstAidBoxes')} placeholder="0" />
          </Field>
          {customFields.map((f) => (
            <Field key={f.key} label={f.label} htmlFor={`attr-${f.key}`} hint="Custom scope field">
              <Input id={`attr-${f.key}`} value={form.attributes?.[f.key] || ''} onChange={setAttr(f.key)} placeholder={`e.g. ${f.label}`} />
            </Field>
          ))}
        </form>
      </Modal>

      {/* Site summary */}
      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        size="xl"
        title={
          selected ? (
            <span className="flex flex-col">
              <span className="text-lg font-bold text-ink-900">{selected.name}</span>
              <span className="text-xs font-normal text-ink-500">
                {[selected.region && `Region: ${selected.region}`, selected.entity && `Entity: ${selected.entity}`]
                  .filter(Boolean)
                  .join('  ·  ') || '—'}
                {selected.address ? `  ·  ${selected.address}` : ''}
              </span>
            </span>
          ) : ''
        }
        footer={
          selected && canManage && (
            <div className="flex w-full items-center justify-between">
              <Button variant="danger" icon={Trash2} type="button" onClick={() => remove(selected)}>Delete</Button>
              <Button variant="ghost" icon={Pencil} type="button" onClick={() => openEdit(selected)}>Edit</Button>
            </div>
          )
        }
      >
        {selected && stats && (
          <div className="space-y-5">
            {/* Equipment + safety KPIs */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatCard label="Fire Extinguishers" value={stats.extinguishers} icon={FireExtinguisher} tone="red" />
              <StatCard label="AED units" value={stats.aeds} icon={HeartPulse} tone="brand" />
              <StatCard label="Fire alarm devices" value={stats.fas} icon={BellRing} tone="amber" />
              <StatCard label="First Aid Boxes" value={stats.firstAidBoxes} icon={BriefcaseMedical} tone="green" />
              <StatCard label="Incidents (total)" value={stats.incidentsTotal} icon={AlertTriangle} tone="amber" />
              <StatCard label="Open Actions" value={stats.openActions} icon={ListChecks} tone="violet" />
              <StatCard label="Employees mapped" value={stats.employees.length} icon={Users2} tone="blue" />
            </div>

            {/* Incident breakdown */}
            <div className="card p-4">
              <p className="mb-3 text-xs font-bold uppercase tracking-wide text-ink-400">Incidents by type</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ['Fire', stats.byType.fire, 'red'],
                  ['Property damage', stats.byType.property, 'amber'],
                  ['Near miss', stats.byType.nearMiss, 'blue'],
                  ['First aid', stats.byType.firstAid, 'green'],
                ].map(([label, val, tone]) => (
                  <div key={label} className="clay-inset rounded-2xl p-3 text-center">
                    <p className="text-2xl font-bold text-ink-900">{val}</p>
                    <Badge tone={tone}>{label}</Badge>
                  </div>
                ))}
              </div>
            </div>

            {/* Employees list */}
            <div className="card p-4">
              <p className="mb-3 text-xs font-bold uppercase tracking-wide text-ink-400">
                Employees mapped to this site ({stats.employees.length})
              </p>
              {stats.employees.length === 0 ? (
                <p className="text-sm text-ink-400">
                  No employees mapped yet. Assign people to this site from the <b>Users</b> page.
                </p>
              ) : (
                <ul className="divide-y divide-ink-100">
                  {stats.employees.map((u) => (
                    <li key={u.uid} className="flex items-center gap-3 py-2.5">
                      <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-xs font-bold text-white">
                        {initials(u.name) || 'U'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink-900">{u.name}</p>
                        <p className="truncate text-xs text-ink-400">{u.email}{u.dept ? ` · ${u.dept}` : ''}</p>
                      </div>
                      <Badge tone="gray">{roleLabel(u.role)}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Bulk upload */}
      <Modal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title="Bulk upload sites"
        size="xl"
        footer={
          <div className="flex w-full items-center justify-between">
            <Button variant="ghost" icon={Download} type="button" onClick={downloadTemplate}>
              Template
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" type="button" onClick={() => setBulkOpen(false)}>Cancel</Button>
              <Button
                type="button"
                loading={bulkBusy}
                disabled={!bulkResult?.valid?.length}
                onClick={importBulk}
              >
                Import {bulkResult?.valid?.length || 0} site{bulkResult?.valid?.length === 1 ? '' : 's'}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-ink-500">
            Upload a CSV with columns{' '}
            <b>Site Name, Region, Entity, Address, Latitude, Longitude, First Aid Boxes{customFields.map((f) => `, ${f.label}`).join('')}</b>. Rows without
            a valid <b>latitude and longitude</b> are rejected and will not be imported.
          </p>

          <label className="clay-inset flex cursor-pointer flex-col items-center gap-2 rounded-2xl p-6 text-center transition hover:bg-clay-100">
            <Upload size={22} className="text-brand-600" />
            <span className="text-sm font-medium text-ink-700">
              {bulkResult ? bulkResult.fileName : 'Choose a CSV file'}
            </span>
            <span className="text-xs text-ink-400">Click to browse — .csv</span>
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={onBulkFile} />
          </label>

          {bulkResult && !bulkResult.headerOk && (
            <div className="flex items-center gap-2 rounded-2xl bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle size={16} /> Couldn&apos;t find the required columns (Site Name, Latitude,
              Longitude). Check the header row or download the template.
            </div>
          )}

          {bulkResult && bulkResult.headerOk && (
            <>
              <div className="flex flex-wrap gap-2">
                <Badge tone="green">
                  <CheckCircle2 size={13} /> {bulkResult.valid.length} valid
                </Badge>
                {bulkResult.invalid.length > 0 && (
                  <Badge tone="red">
                    <AlertCircle size={13} /> {bulkResult.invalid.length} rejected (no coordinates)
                  </Badge>
                )}
              </div>
              <div className="table-crisp card max-h-72 overflow-auto p-0">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide text-ink-400">
                      <th className="px-4 py-2">Row</th>
                      <th className="px-4 py-2">Name</th>
                      <th className="px-4 py-2">Region / Entity</th>
                      <th className="px-4 py-2">Lat, Lng</th>
                      <th className="px-4 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkResult.rows.map((r) => (
                      <tr key={r.__row} className={r.__errors.length ? 'bg-red-50/40' : ''}>
                        <td className="px-4 py-2 text-ink-400">{r.__row}</td>
                        <td className="px-4 py-2 font-medium text-ink-800">{r.name || '—'}</td>
                        <td className="px-4 py-2 text-ink-500">
                          {[r.region, r.entity].filter(Boolean).join(' · ') || '—'}
                        </td>
                        <td className="px-4 py-2 text-ink-500">
                          {r.lat != null && r.lng != null ? `${r.lat}, ${r.lng}` : '—'}
                        </td>
                        <td className="px-4 py-2">
                          {r.__errors.length === 0 ? (
                            <span className="inline-flex items-center gap-1 text-emerald-600">
                              <CheckCircle2 size={14} /> OK
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-red-600">
                              <AlertCircle size={14} /> {r.__errors.join('; ')}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* Bulk delete confirmation */}
      <Modal
        open={confirmBulk}
        onClose={() => setConfirmBulk(false)}
        title={`Delete ${pickedSites.length} site${pickedSites.length === 1 ? '' : 's'}?`}
        size="lg"
        footer={
          <>
            <Button variant="ghost" type="button" onClick={() => setConfirmBulk(false)}>Cancel</Button>
            <Button
              variant="danger"
              icon={Trash2}
              loading={busy}
              disabled={confirmText.trim().toUpperCase() !== 'DELETE'}
              onClick={runBulkDelete}
            >
              Delete {pickedSites.length} site{pickedSites.length === 1 ? '' : 's'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-ink-600">
            This permanently removes the sites below from your organisation. It cannot be undone.
          </p>

          <div className="max-h-56 overflow-auto rounded-2xl border border-clay-200">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-clay-100">
                {pickedSites.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-2 font-medium text-ink-800">{s.name}</td>
                    <td className="px-4 py-2 text-ink-500">
                      {[s.region, s.entity].filter(Boolean).join(' · ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(pickedImpact.extinguishers + pickedImpact.aeds + pickedImpact.fas + pickedImpact.incidents + pickedImpact.users) > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="flex items-center gap-2 font-semibold">
                <AlertTriangle size={16} /> Records are linked to these sites
              </p>
              <p className="mt-1">
                {[
                  pickedImpact.users && `${pickedImpact.users} people`,
                  pickedImpact.incidents && `${pickedImpact.incidents} incidents`,
                  pickedImpact.extinguishers && `${pickedImpact.extinguishers} extinguishers`,
                  pickedImpact.aeds && `${pickedImpact.aeds} AEDs`,
                  pickedImpact.fas && `${pickedImpact.fas} fire-alarm devices`,
                ].filter(Boolean).join(', ')}{' '}
                stay in the system and keep their stored site name, so history and reports remain readable.
                Reassign anyone who still needs an active site.
              </p>
            </div>
          )}

          <Field label="Type DELETE to confirm">
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              autoComplete="off"
            />
          </Field>
        </div>
      </Modal>

    </>
  )
}

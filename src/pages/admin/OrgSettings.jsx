import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Settings, Save, Activity, Plus, X, Layers, ChevronUp, ChevronDown, Lock, Building2 } from 'lucide-react'
import { DEPARTMENTS } from '../../shared/auth/access'
import { useAuth } from '../../shared/auth/AuthContext'
import { subscribeOrg, updateOrgSettings, subscribeSites } from '../../shared/org/orgData'
import { ACTIVITY_TYPES } from '../../shared/org/orgConstants'
import { MODULES } from '../../shared/modules/registry'
import {
  BUILTIN_FIELDS, SITE_LEVEL, SITE_LEVEL_KEY, DEFAULT_LEVEL_KEYS,
  normalizeScopeConfig, moduleLevelKeys, distinctSiteValues, toFieldKey,
} from '../../shared/org/scopeConfig'
import { PageHeader, Card, Field, Input, Select, Button, MultiSelect, SkeletonCard } from '../../shared/ui'

const TABS = [
  { key: 'general', label: 'General', icon: Settings },
  { key: 'scope', label: 'Scope & Granularity', icon: Layers },
]

export default function OrgSettings() {
  const { orgId, actor } = useAuth()
  const [org, setOrg] = useState(null)
  const [tab, setTab] = useState('general')
  const [sites, setSites] = useState([])

  const [form, setForm] = useState({
    name: '', address: '', notificationEmail: '', activityTypes: [], departments: [],
  })
  const [customActivity, setCustomActivity] = useState('')
  const [newDept, setNewDept] = useState('')
  const [busy, setBusy] = useState(false)

  // Scope granularity state
  const [customFields, setCustomFields] = useState([]) // [{ key, label, options }]
  const [moduleLevels, setModuleLevels] = useState({}) // { [moduleKey]: [levelKey…] }
  const [newField, setNewField] = useState('')
  const [optionDraft, setOptionDraft] = useState({}) // { [fieldKey]: text }
  const [scopeModule, setScopeModule] = useState(MODULES[0].key)
  const [scopeBusy, setScopeBusy] = useState(false)

  useEffect(() => {
    if (!orgId) return
    return subscribeOrg(orgId, (o) => {
      setOrg(o)
      if (o) {
        setForm({
          name: o.name || '',
          address: o.address || '',
          notificationEmail: o.notificationEmail || '',
          activityTypes: o.activityTypes || [],
          departments: Array.isArray(o.departments) && o.departments.length ? o.departments : DEPARTMENTS,
        })
        const cfg = normalizeScopeConfig(o.scopeConfig)
        setCustomFields(cfg.customFields)
        setModuleLevels(cfg.modules)
      }
    })
  }, [orgId])

  useEffect(() => {
    if (!orgId) return
    return subscribeSites(orgId, setSites)
  }, [orgId])

  const activityOptions = useMemo(
    () => [...new Set([...ACTIVITY_TYPES, ...form.activityTypes])],
    [form.activityTypes]
  )

  const addCustomActivity = () => {
    const v = customActivity.trim()
    if (!v) return
    if (!form.activityTypes.includes(v)) setForm({ ...form, activityTypes: [...form.activityTypes, v] })
    setCustomActivity('')
  }

  const addDept = () => {
    const v = newDept.trim()
    if (!v) return
    if (form.departments.some((d) => d.toLowerCase() === v.toLowerCase())) return toast.error('That department already exists')
    setForm({ ...form, departments: [...form.departments, v] })
    setNewDept('')
  }
  const removeDept = (d) => setForm({ ...form, departments: form.departments.filter((x) => x !== d) })

  const saveGeneral = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await updateOrgSettings(orgId, {
        name: form.name,
        address: form.address,
        notificationEmail: form.notificationEmail,
        activityTypes: form.activityTypes,
        departments: form.departments,
      }, actor)
      toast.success('Settings saved')
    } catch (err) {
      toast.error(err?.message || 'Failed')
    } finally {
      setBusy(false)
    }
  }

  // ── Scope granularity helpers ──────────────────────────────────────────────
  const allFields = useMemo(() => [...BUILTIN_FIELDS, SITE_LEVEL, ...customFields], [customFields])
  const fieldLabel = (key) => allFields.find((f) => f.key === key)?.label || key

  // Ordered levels for the module being edited (Site is a normal, removable level).
  const levelsForModule = useMemo(
    () => moduleLevelKeys({ scopeConfig: { customFields, modules: moduleLevels } }, scopeModule),
    [customFields, moduleLevels, scopeModule]
  )
  const setLevelsFor = (keys) => setModuleLevels((m) => ({ ...m, [scopeModule]: keys }))

  const addLevel = (key) => { if (key && !levelsForModule.includes(key)) setLevelsFor([...levelsForModule, key]) }
  const removeLevel = (key) => setLevelsFor(levelsForModule.filter((k) => k !== key))
  const moveLevel = (i, dir) => {
    const j = i + dir
    if (j < 0 || j >= levelsForModule.length) return
    const next = levelsForModule.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    setLevelsFor(next)
  }

  const addCustomField = () => {
    const label = newField.trim()
    const key = toFieldKey(label)
    if (!label || !key) return
    if (allFields.some((f) => f.key === key)) { toast.error('That field already exists'); return }
    setCustomFields((f) => [...f, { key, label, options: [] }])
    setNewField('')
  }
  const addOption = (fieldKey) => {
    const val = (optionDraft[fieldKey] || '').trim()
    if (!val) return
    setCustomFields((fields) => fields.map((f) =>
      f.key === fieldKey ? { ...f, options: f.options.includes(val) ? f.options : [...f.options, val] } : f))
    setOptionDraft((d) => ({ ...d, [fieldKey]: '' }))
  }
  const removeOption = (fieldKey, val) =>
    setCustomFields((fields) => fields.map((f) =>
      f.key === fieldKey ? { ...f, options: f.options.filter((o) => o !== val) } : f))
  const removeCustomField = (key) => {
    setCustomFields((f) => f.filter((x) => x.key !== key))
    // Drop it from every module's level list too.
    setModuleLevels((m) => {
      const out = {}
      for (const [mk, keys] of Object.entries(m)) out[mk] = keys.filter((k) => k !== key)
      return out
    })
  }

  const unusedFields = allFields.filter((f) => !levelsForModule.includes(f.key))

  const saveScope = async () => {
    setScopeBusy(true)
    try {
      // Persist only modules that differ from the default, keeping the doc lean.
      const modules = {}
      for (const m of MODULES) {
        const keys = moduleLevelKeys({ scopeConfig: { customFields, modules: moduleLevels } }, m.key)
        if (JSON.stringify(keys) !== JSON.stringify(DEFAULT_LEVEL_KEYS)) modules[m.key] = keys
      }
      await updateOrgSettings(orgId, { scopeConfig: { customFields, modules } }, actor)
      toast.success('Scope settings saved')
    } catch (err) {
      toast.error(err?.message || 'Failed')
    } finally {
      setScopeBusy(false)
    }
  }

  const previewFor = (key) => {
    if (key === SITE_LEVEL_KEY) return `The specific site record — ${sites.length} site${sites.length === 1 ? '' : 's'} available`
    const vals = distinctSiteValues(sites, key)
    if (!vals.length) return 'No values in site data yet'
    return `${vals.slice(0, 4).join(', ')}${vals.length > 4 ? `, +${vals.length - 4} more` : ''} (${vals.length})`
  }

  if (org === null) {
    return (
      <>
        <PageHeader title="Organization settings" subtitle="Manage your organization profile" icon={Settings} />
        <SkeletonCard className="max-w-2xl" />
      </>
    )
  }

  return (
    <>
      <PageHeader title="Organization settings" subtitle="Profile, activities & scope granularity" icon={Settings} />

      {/* Tab bar */}
      <div className="mb-5 flex flex-wrap gap-1.5 border-b border-ink-100 pb-3">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={[
              'inline-flex items-center gap-2 rounded-2xl px-3.5 py-2 text-sm font-medium transition-all duration-200 ease-emil',
              tab === t.key ? 'bg-clay-surface text-ink-900 shadow-clay-pressed' : 'text-ink-500 hover:bg-clay-100 hover:text-ink-800 active:scale-[0.98]',
            ].join(' ')}
          >
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'general' && (
        <form onSubmit={saveGeneral} className="max-w-2xl space-y-5">
          <Card>
            <h3 className="mb-4 font-semibold text-ink-800">Profile</h3>
            <div className="space-y-4">
              <Field label="Organization name" htmlFor="name">
                <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="Address" htmlFor="address">
                <Input id="address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </Field>
              <Field label="Notification email" htmlFor="email" hint="Where safety notifications are sent">
                <Input id="email" type="email" value={form.notificationEmail} onChange={(e) => setForm({ ...form, notificationEmail: e.target.value })} />
              </Field>
            </div>
          </Card>

          <Card>
            <h3 className="flex items-center gap-2 font-semibold text-ink-800">
              <Activity size={17} className="text-brand-600" /> Activities performed
            </h3>
            <p className="mb-3 mt-1 text-sm text-ink-500">
              Select the types of activity your organization performs. Add your own if it&apos;s not listed.
            </p>
            <MultiSelect
              options={activityOptions}
              value={form.activityTypes}
              onChange={(activityTypes) => setForm({ ...form, activityTypes })}
              maxHeight="max-h-56"
            />
            <div className="mt-2 flex gap-2">
              <Input
                placeholder="Add a custom activity…"
                value={customActivity}
                onChange={(e) => setCustomActivity(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomActivity() } }}
              />
              <Button type="button" variant="soft" icon={Plus} onClick={addCustomActivity}>Add</Button>
            </div>
          </Card>

          {/* Departments — populate every department dropdown across all modules */}
          <Card>
            <h3 className="flex items-center gap-2 font-semibold text-ink-800">
              <Building2 size={17} className="text-brand-600" /> Departments
            </h3>
            <p className="mb-3 mt-1 text-sm text-ink-500">
              Your organization&apos;s departments. These populate the department dropdowns across all
              modules — employee provisioning, access requests, training group assignments and reports.
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="e.g. Quality Assurance"
                value={newDept}
                onChange={(e) => setNewDept(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDept() } }}
              />
              <Button type="button" variant="soft" icon={Plus} onClick={addDept}>Add</Button>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {form.departments.map((d) => (
                <span key={d} className="chip bg-clay-100 text-ink-700">
                  {d}
                  <button type="button" onClick={() => removeDept(d)} className="text-ink-400 hover:text-red-600" title="Remove department">
                    <X size={13} />
                  </button>
                </span>
              ))}
              {form.departments.length === 0 && (
                <span className="text-sm text-ink-400">No departments — the defaults ({DEPARTMENTS.join(', ')}) will be used.</span>
              )}
            </div>
            <p className="mt-2 text-xs text-ink-400">
              Removing a department here doesn&apos;t change employees already mapped to it — their records keep the old name.
            </p>
          </Card>

          <div className="flex justify-end">
            <Button type="submit" icon={Save} loading={busy}>Save changes</Button>
          </div>
        </form>
      )}

      {tab === 'scope' && (
        <div className="max-w-3xl space-y-5">
          <Card>
            <h3 className="flex items-center gap-2 font-semibold text-ink-800">
              <Layers size={17} className="text-brand-600" /> Custom scope fields
            </h3>
            <p className="mb-3 mt-1 text-sm text-ink-500">
              Define extra location attributes (e.g. <b>Building</b>, <b>Floor</b>, <b>Zone</b>) beyond Region and Entity.
              These become fields on every Site and can be added as granularity levels below. Give each one its predefined
              dropdown values here — any extra values found in your site data are added automatically.
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="e.g. Building"
                value={newField}
                onChange={(e) => setNewField(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomField() } }}
              />
              <Button type="button" variant="soft" icon={Plus} onClick={addCustomField}>Add field</Button>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {BUILTIN_FIELDS.map((f) => (
                <span key={f.key} className="chip bg-ink-100 text-ink-500" title="Built-in field — values come from site data"><Lock size={12} /> {f.label}</span>
              ))}
            </div>

            <div className="mt-3 space-y-3">
              {customFields.length === 0 && <p className="text-sm text-ink-400">No custom fields yet.</p>}
              {customFields.map((f) => (
                <div key={f.key} className="rounded-2xl bg-clay-surface/60 p-3 shadow-clay-inset">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-ink-800">{f.label}</p>
                    <button type="button" onClick={() => removeCustomField(f.key)} className="rounded-lg p-1 text-ink-400 hover:bg-red-50 hover:text-red-600"><X size={15} /></button>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-400">Predefined dropdown values</p>
                  {f.options.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {f.options.map((o) => (
                        <span key={o} className="chip bg-clay-100 text-ink-700">
                          {o}
                          <button type="button" onClick={() => removeOption(f.key, o)} className="text-ink-400 hover:text-red-600"><X size={12} /></button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 flex gap-2">
                    <Input
                      placeholder={`Add a ${f.label.toLowerCase()} value…`}
                      value={optionDraft[f.key] || ''}
                      onChange={(e) => setOptionDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOption(f.key) } }}
                    />
                    <Button type="button" variant="soft" icon={Plus} onClick={() => addOption(f.key)}>Add value</Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 font-semibold text-ink-800">
                <Layers size={17} className="text-brand-600" /> Scope levels per module
              </h3>
              <Select className="!w-auto !py-2" value={scopeModule} onChange={(e) => setScopeModule(e.target.value)}>
                {MODULES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
              </Select>
            </div>
            <p className="mb-4 mt-1 text-sm text-ink-500">
              Choose which fields — and in what order — a user fills to define scope in{' '}
              <b>{MODULES.find((m) => m.key === scopeModule)?.label}</b>. Any level, including Site, can be added, reordered or removed.
            </p>

            <ol className="space-y-2">
              {levelsForModule.map((key, i) => (
                <li key={key} className="flex items-center gap-2 rounded-2xl bg-clay-surface/60 px-3 py-2 shadow-clay-inset">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-500 text-xs font-bold text-white">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink-800">{fieldLabel(key)}</p>
                    <p className="truncate text-xs text-ink-400">{previewFor(key)}</p>
                  </div>
                  <button type="button" onClick={() => moveLevel(i, -1)} disabled={i === 0} className="rounded-lg p-1 text-ink-400 hover:bg-clay-100 hover:text-ink-700 disabled:opacity-30"><ChevronUp size={16} /></button>
                  <button type="button" onClick={() => moveLevel(i, 1)} disabled={i === levelsForModule.length - 1} className="rounded-lg p-1 text-ink-400 hover:bg-clay-100 hover:text-ink-700 disabled:opacity-30"><ChevronDown size={16} /></button>
                  <button type="button" onClick={() => removeLevel(key)} disabled={levelsForModule.length === 1} title={levelsForModule.length === 1 ? 'At least one level is required' : 'Remove level'} className="rounded-lg p-1 text-ink-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"><X size={16} /></button>
                </li>
              ))}
            </ol>

            {unusedFields.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-ink-100 pt-4">
                <span className="text-xs font-bold uppercase tracking-wide text-ink-400">Add level</span>
                {unusedFields.map((f) => (
                  <button key={f.key} type="button" onClick={() => addLevel(f.key)} className="chip bg-brand-50 text-brand-700 hover:bg-brand-100">
                    <Plus size={13} /> {f.label}
                  </button>
                ))}
              </div>
            )}
          </Card>

          <div className="flex justify-end">
            <Button type="button" icon={Save} loading={scopeBusy} onClick={saveScope}>Save scope settings</Button>
          </div>
        </div>
      )}
    </>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Settings, Save, Activity, Plus, X, Layers, ChevronUp, ChevronDown, Lock, Building2, PhoneCall, LifeBuoy, ImageUp, Trash2, Plug } from 'lucide-react'
import { ERP_ROLES, normalizeErpRoleLabels } from '../../shared/org/erpRoles'
import { DEPARTMENTS } from '../../shared/auth/access'
import { useAuth } from '../../shared/auth/AuthContext'
import { subscribeOrg, updateOrgSettings, subscribeSites } from '../../shared/org/orgData'
import { ACTIVITY_TYPES } from '../../shared/org/orgConstants'
import { MODULES } from '../../shared/modules/registry'
import {
  BUILTIN_FIELDS, SITE_LEVEL, SITE_LEVEL_KEY, DEFAULT_LEVEL_KEYS,
  normalizeScopeConfig, moduleLevelKeys, distinctSiteValues, toFieldKey,
} from '../../shared/org/scopeConfig'
import {
  putFile, removeFile, MAX_INLINE_BYTES, tooLargeForInline, formatSize,
} from '../../shared/storage'
import { fileToDataUrl } from '../../shared/lib/files'
import { safeSrc } from '../../shared/safeUrl'
import { PageHeader, Card, Field, Input, Select, Button, MultiSelect, SkeletonCard } from '../../shared/ui'
import MetabaseSettings from './MetabaseSettings'


const TABS = [
  { key: 'general', label: 'General', icon: Settings },
  { key: 'scope', label: 'Scope & Granularity', icon: Layers },
  { key: 'integrations', label: 'Integrations', icon: Plug },
]

// A logo rides on every page load for every member, so it gets a far tighter
// ceiling than the 10MB an evidence photo may be. 2MB is generous for a mark.
const MAX_LOGO_BYTES = 2 * 1024 * 1024

export default function OrgSettings() {
  const { orgId, actor } = useAuth()
  const [org, setOrg] = useState(null)
  const [tab, setTab] = useState('general')
  const [sites, setSites] = useState([])

  const [form, setForm] = useState({
    name: '', address: '', notificationEmail: '', activityTypes: [], departments: [],
    safetyHelplinePrimary: '', safetyHelplineSecondary: '',
    erpRoleLabels: {},
  })
  const [customActivity, setCustomActivity] = useState('')
  const [newDept, setNewDept] = useState('')
  const [busy, setBusy] = useState(false)

  // The logo is NOT part of `form`, deliberately. subscribeOrg below rewrites
  // `form` on every snapshot, so a picked-but-unsaved logo would vanish the
  // moment anyone touched the org document — and "I uploaded it and it went
  // away" is the worst possible failure for a one-click action. It is written
  // the instant it is chosen, and read back off the live `org`.
  const [logoBusy, setLogoBusy] = useState(false)
  const logoRef = useRef(null)

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
          safetyHelplinePrimary: o.safetyHelplinePrimary || '',
          safetyHelplineSecondary: o.safetyHelplineSecondary || '',
          activityTypes: o.activityTypes || [],
          departments: Array.isArray(o.departments) && o.departments.length ? o.departments : DEPARTMENTS,
          erpRoleLabels: normalizeErpRoleLabels(o.erpRoleLabels),
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

  // ── Organization logo ───────────────────────────────────────────────────────
  //
  // Cloud storage first, inline data URL as the fallback — the same bargain
  // every other upload in this app makes, and it matters more here: the org
  // document is read by every member on every page load, so an inline logo is
  // bytes on all of those reads. The fallback exists so a deployment whose
  // bucket is not enabled yet can still be branded, under the tighter cap a
  // Firestore document imposes.
  const saveLogo = async (patch) => {
    const previousPath = org?.logoPath || ''
    await updateOrgSettings(orgId, patch, actor)
    // Only after the document points somewhere else. Deleting first would leave
    // the header pointing at bytes that are already gone if the write failed.
    if (previousPath && previousPath !== patch.logoPath) removeFile(previousPath)
  }

  const onLogo = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) return toast.error('Pick an image file — PNG or SVG works best')
    if (file.size > MAX_LOGO_BYTES) {
      return toast.error(`Logo too large — keep it under ${formatSize(MAX_LOGO_BYTES)}`)
    }
    setLogoBusy(true)
    try {
      const up = await putFile(orgId, 'org-logo', file, file.name)
      if (up) {
        await saveLogo({ logoUrl: up.url, logoPath: up.path })
      } else {
        if (file.size > MAX_INLINE_BYTES) return toast.error(tooLargeForInline(file.name))
        const dataUrl = await fileToDataUrl(file)
        await saveLogo({ logoUrl: dataUrl, logoPath: '' })
      }
      toast.success('Logo updated')
    } catch (err) {
      toast.error(err?.message || 'Could not save the logo')
    } finally {
      setLogoBusy(false)
    }
  }

  const clearLogo = async () => {
    setLogoBusy(true)
    try {
      await saveLogo({ logoUrl: '', logoPath: '' })
      toast.success('Logo removed — the WE EHS mark is back in the header')
    } catch (err) {
      toast.error(err?.message || 'Could not remove the logo')
    } finally {
      setLogoBusy(false)
    }
  }

  const saveGeneral = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await updateOrgSettings(orgId, {
        name: form.name,
        address: form.address,
        notificationEmail: form.notificationEmail,
        safetyHelplinePrimary: form.safetyHelplinePrimary,
        safetyHelplineSecondary: form.safetyHelplineSecondary,
        activityTypes: form.activityTypes,
        departments: form.departments,
        erpRoleLabels: form.erpRoleLabels,
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
      <PageHeader title="Organization settings" subtitle="Profile, branding, scope granularity & integrations" icon={Settings} />

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

          {/* Brand mark. Saved on pick rather than on Submit — see the comment
              on logoBusy above. */}
          <Card>
            <h3 className="flex items-center gap-2 font-semibold text-ink-800">
              <ImageUp size={17} className="text-brand-600" /> Organization logo
            </h3>
            <p className="mb-4 mt-1 text-sm text-ink-500">
              Shown in the top-left corner of every screen, in place of the WE EHS mark — which moves
              to a small badge in the bottom-right corner. PNG or SVG with a transparent background
              looks best; up to {formatSize(MAX_LOGO_BYTES)}.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <div className="grid h-20 w-20 flex-none place-items-center rounded-2xl bg-clay-surface shadow-clay-inset">
                {org?.logoUrl ? (
                  <img
                    src={safeSrc(org.logoUrl)}
                    alt={`${form.name || 'Organization'} logo`}
                    className="h-16 w-16 rounded-xl bg-white object-contain"
                  />
                ) : (
                  <span className="px-2 text-center text-[10.5px] font-semibold leading-tight text-ink-400">
                    No logo yet
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {/* type="button" on both: this card sits inside the General
                    form, and a bare <button> there submits it. */}
                <Button
                  type="button"
                  variant="soft"
                  icon={logoBusy ? undefined : ImageUp}
                  loading={logoBusy}
                  onClick={() => logoRef.current?.click()}
                >
                  {org?.logoUrl ? 'Replace logo' : 'Upload logo'}
                </Button>
                {org?.logoUrl && (
                  <Button type="button" variant="ghost" icon={Trash2} disabled={logoBusy} onClick={clearLogo}>
                    Remove
                  </Button>
                )}
                <input
                  ref={logoRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onLogo}
                />
              </div>
            </div>
          </Card>

          {/* Org-wide emergency helpline — same on every site's SOS poster */}
          <Card>
            <h3 className="flex items-center gap-2 font-semibold text-ink-800">
              <PhoneCall size={17} className="text-red-600" /> Safety &amp; Security helpline
            </h3>
            <p className="mb-3 mt-1 text-sm text-ink-500">
              Your organization-wide helpline numbers. These are common to every site and print on the
              <b> Safety &amp; Security (Help Line)</b> row of each site&apos;s SOS emergency poster.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Primary helpline" htmlFor="hl1" hint="e.g. 1800 102 4100">
                <Input id="hl1" value={form.safetyHelplinePrimary}
                  onChange={(e) => setForm({ ...form, safetyHelplinePrimary: e.target.value })} />
              </Field>
              <Field label="Secondary helpline" htmlFor="hl2" hint="e.g. 9591900100">
                <Input id="hl2" value={form.safetyHelplineSecondary}
                  onChange={(e) => setForm({ ...form, safetyHelplineSecondary: e.target.value })} />
              </Field>
            </div>
          </Card>

          {/* Emergency response role names. The baseline rescue plans are written
              against roles, not people; this is where an organization says what
              it calls each one. */}
          <Card>
            <h3 className="flex items-center gap-2 font-semibold text-ink-800">
              <LifeBuoy size={17} className="text-red-600" /> Emergency response roles
            </h3>
            <p className="mb-3 mt-1 text-sm text-ink-500">
              The baseline rescue plans name a <b>role</b> for every step, never a person. Set what your
              organization calls each role and it will read in your own language across rescue plans,
              emergency contacts, mock drills and printed plans. Renaming is safe at any time — existing
              records are unaffected.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {ERP_ROLES.filter((r) => r.key !== 'Other').map((r) => (
                <Field key={r.key} label={r.duty} htmlFor={`role-${r.key}`} hint={`Default: ${r.label}`}>
                  <Input
                    id={`role-${r.key}`}
                    value={form.erpRoleLabels?.[r.key] ?? ''}
                    placeholder={r.label}
                    onChange={(e) => setForm({
                      ...form,
                      erpRoleLabels: { ...form.erpRoleLabels, [r.key]: e.target.value },
                    })}
                  />
                </Field>
              ))}
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

      {tab === 'integrations' && <MetabaseSettings orgId={orgId} actor={actor} />}

    </>
  )
}

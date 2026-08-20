import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, Search, Pencil, Trash2, Inbox } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { can } from '../auth/permissions'
import {
  Button,
  Badge,
  PageHeader,
  EmptyState,
  SkeletonTable,
  Modal,
  Input,
  Select,
} from '../ui'
import { formatDate } from '../lib/format'
import RecordForm from './RecordForm'
import { fieldOptions, visibleFields } from './fields'
import { DocIdCell } from '../docId/DocIdTag'

const STATUS_TONE_FALLBACK = 'gray'

// Modules that need live reference data — a site registry, a person list —
// supply a `useLookups` hook; the rest get this and never notice.
const NO_LOOKUPS = {}
const useNoLookups = () => NO_LOOKUPS

function statusMeta(config, value) {
  return config.statuses?.find((s) => s.value === value)
}

// Build the initial form value from field defaults.
function emptyRecord(config) {
  const v = {}
  config.fields.forEach((f) => {
    v[f.key] = f.default ?? ''
  })
  return v
}

/**
 * Generic, fully-working module screen: list (crisp table) + create/edit modal +
 * detail view + status workflow + delete. Driven entirely by a module config.
 *
 * Beyond fields / columns / statuses, a config may declare:
 *   useLookups  hook returning live reference data (sites, people…) handed to
 *               field options, column renderers, filters and compute
 *   filters     { key, label, when, options(lookups, records, facets),
 *                 match(record, value, facets, lookups) } — selects beside the
 *                 search box. `lookups` is handed over so a filter can resolve
 *                 a record against live reference data: the documents library
 *                 needs the site registry to place a document written before it
 *                 started snapshotting its site's region onto itself.
 */
export default function ModulePage({ module, config }) {
  const { orgId, actor, role } = useAuth()
  const [records, setRecords] = useState(null) // null = loading
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [facets, setFacets] = useState({}) // config.filters, by key
  const [editing, setEditing] = useState(null) // record | 'new' | null
  const [form, setForm] = useState({})
  const [detail, setDetail] = useState(null)
  const [busy, setBusy] = useState(false)

  const service = config.service
  // Which hook this is never changes — a module's config is a module-level
  // constant — so the rules of hooks hold despite the indirection.
  const useLookups = config.useLookups || useNoLookups
  const lookups = useLookups()

  // Passed to subscribe so a module whose reads are scoped can build a query the
  // security rules will actually allow. Modules that do not care ignore the
  // third argument, and for them `lookups` is a module-level constant, so this
  // memo never changes and nothing re-subscribes.
  const viewer = useMemo(() => ({ role, sites: lookups.sites || [] }), [role, lookups])

  useEffect(() => {
    if (!orgId) return
    setRecords(null)
    const unsub = service.subscribe(orgId, setRecords, viewer)
    return unsub
  }, [orgId, service, viewer])

  const canCreate = can(role, 'record.create')
  const canEdit = can(role, 'record.edit')
  const canDelete = can(role, 'record.delete')
  const canClose = can(role, 'record.close')

  const titleOf = (r) => (config.titleField ? r[config.titleField] : r.title) || '(untitled)'

  // A filter can depend on another: "which region" only means anything once
  // Region is the chosen level, so the offered set is re-read on every change.
  const activeFilters = useMemo(
    () => (config.filters || []).filter((f) => !f.when || f.when(facets)),
    [config.filters, facets]
  )

  const setFacet = (key, value) => {
    setFacets((prev) => {
      const next = { ...prev, [key]: value }
      // A choice this change has invalidated must stop narrowing the list.
      // Switching the level from Region to Site leaves a region name sitting in
      // the scope filter, where it matches nothing — an empty table and nothing
      // on screen to explain why.
      ;(config.filters || []).forEach((f) => {
        if (f.key === key) return
        const offered =
          (!f.when || f.when(next)) &&
          f.options(lookups, records || [], next).some((o) => (o.value ?? o) === (next[f.key] ?? ''))
        if (!offered) delete next[f.key]
      })
      return next
    })
  }

  const filtered = useMemo(() => {
    if (!records) return []
    const q = search.trim().toLowerCase()
    return records.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (activeFilters.some((f) => !f.match(r, facets[f.key] ?? '', facets, lookups))) return false
      if (!q) return true
      return JSON.stringify(r).toLowerCase().includes(q)
    })
  }, [records, search, statusFilter, activeFilters, facets, lookups])

  // `prefill` lets a module open the form already pointed somewhere — the
  // documents library uses it so "add to this folder" arrives with the site
  // already chosen, rather than making someone re-pick the folder they just
  // clicked. Merged over the empty record, never under it, so a prefilled
  // field cannot be blanked by a default.
  const openNew = (prefill) => {
    setForm({ ...emptyRecord(config), ...(prefill || {}) })
    setEditing('new')
  }
  const openEdit = (r) => {
    setForm({ ...r })
    setEditing(r)
    setDetail(null)
  }

  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const derived = config.compute ? config.compute(form, lookups) : {}
      const payload = { ...form, ...derived }
      const label = titleOf(payload)
      if (editing === 'new') {
        payload.status = config.defaultStatus || config.statuses?.[0]?.value || 'open'
        await service.create(orgId, payload, actor, label)
        toast.success(`${config.singular} created`)
      } else {
        const { id: _id, createdAt: _createdAt, ...rest } = payload
        await service.update(orgId, editing.id, rest, actor, label)
        toast.success(`${config.singular} updated`)
      }
      setEditing(null)
    } catch (err) {
      toast.error(err?.message || 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const changeStatus = async (r, status) => {
    try {
      await service.setStatus(orgId, r.id, status, actor, titleOf(r))
      toast.success(`Marked ${statusMeta(config, status)?.label || status}`)
      setDetail({ ...r, status })
    } catch (err) {
      toast.error(err?.message || 'Update failed')
    }
  }

  const remove = async (r) => {
    if (!window.confirm(`Delete "${titleOf(r)}"? This cannot be undone.`)) return
    try {
      await service.remove(orgId, r.id, actor, titleOf(r))
      toast.success(`${config.singular} deleted`)
      setDetail(null)
    } catch (err) {
      toast.error(err?.message || 'Delete failed')
    }
  }

  const columns = config.columns || [{ key: config.titleField || 'title', label: config.singular }]

  return (
    <>
      <PageHeader
        title={module.title}
        subtitle={config.subtitle || module.description}
        icon={module.icon}
        actions={
          canCreate && (
            <Button icon={Plus} onClick={() => openNew()}>
              New {config.singular}
            </Button>
          )
        }
      />

      {/* An optional module-owned panel above the toolbar. Rendered before the
          filters because what it offers is a way INTO them — the documents
          library uses it for a folder per site, where clicking one sets the
          same facets the dropdowns do. Given setFacet so it cannot drift into
          being a second, competing filter mechanism. */}
      {config.aside?.({ records: records || [], lookups, facets, setFacet, openNew })}

      {/* Toolbar: search + module filters + status filter chips */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative max-w-xs flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <Input
              className="!py-2 pl-9"
              placeholder={`Search ${config.plural.toLowerCase()}…`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {activeFilters.map((f) => {
            const label = typeof f.label === 'function' ? f.label(facets) : f.label
            return (
              <Select
                key={f.key}
                aria-label={label}
                className="!py-2 sm:max-w-[13rem]"
                value={facets[f.key] ?? ''}
                onChange={(e) => setFacet(f.key, e.target.value)}
              >
                {f.options(lookups, records || [], facets).map((o) => (
                  <option key={o.value ?? o} value={o.value ?? o}>
                    {o.label ?? o}
                  </option>
                ))}
              </Select>
            )
          })}
        </div>
        {config.statuses?.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <StatusChip active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>
              All
            </StatusChip>
            {config.statuses.map((s) => (
              <StatusChip
                key={s.value}
                active={statusFilter === s.value}
                onClick={() => setStatusFilter(s.value)}
              >
                {s.label}
              </StatusChip>
            ))}
          </div>
        )}
      </div>

      {/* Say so when a filter is hiding records, rather than letting what is on
          screen pass for everything on record. */}
      {records && filtered.length !== records.length && (
        <p className="mb-2 text-xs text-ink-400">
          Showing {filtered.length} of {records.length} {config.plural.toLowerCase()}
        </p>
      )}

      {/* List */}
      {records === null ? (
        <SkeletonTable rows={6} cols={Math.min(columns.length + 1, 5)} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={records.length === 0 ? `No ${config.plural.toLowerCase()} yet` : 'No matches'}
          description={
            records.length === 0
              ? canCreate
                ? `Create the first ${config.singular.toLowerCase()} to get started.`
                : 'Records will appear here once created.'
              : 'Try a different search or filter.'
          }
          action={records.length === 0 && canCreate && <Button icon={Plus} onClick={() => openNew()}>New {config.singular}</Button>}
        />
      ) : (
        <div className="card table-crisp overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-ink-400">
                <th className="px-5 py-3 font-semibold">ID</th>
                {columns.map((c) => (
                  <th key={c.key} className="px-5 py-3 font-semibold">
                    {c.label}
                  </th>
                ))}
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const sm = statusMeta(config, r.status)
                return (
                  <tr
                    key={r.id}
                    // A module may claim the row click. The documents library
                    // does: in a folder view a file should OPEN, the way it
                    // would anywhere else that calls itself a folder. Falling
                    // back to the detail view means a record with nothing to
                    // open still goes somewhere rather than doing nothing.
                    onClick={() => (config.onRowClick?.(r) ? null : setDetail(r))}
                    className="animate-fade-in-up cursor-pointer transition-colors hover:bg-clay-100"
                    style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }}
                  >
                    <td className="whitespace-nowrap px-5 py-3.5"><DocIdCell id={r.docId} /></td>
                    {columns.map((c, ci) => (
                      <td key={c.key} className={`px-5 py-3.5 ${ci === 0 ? 'font-medium text-ink-900' : 'text-ink-600'}`}>
                        {c.render ? c.render(r, lookups) : formatCell(r[c.key])}
                      </td>
                    ))}
                    <td className="px-5 py-3.5">
                      <Badge tone={sm?.tone || STATUS_TONE_FALLBACK}>{sm?.label || r.status || '—'}</Badge>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {canEdit && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            openEdit(r)
                          }}
                          className="rounded-lg p-1.5 text-ink-400 transition hover:bg-clay-200 hover:text-ink-700 active:scale-90"
                          aria-label="Edit"
                        >
                          <Pencil size={16} />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / edit modal */}
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? `New ${config.singular}` : `Edit ${config.singular}`}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)} type="button">
              Cancel
            </Button>
            <Button form="record-form" type="submit" loading={busy}>
              {editing === 'new' ? 'Create' : 'Save changes'}
            </Button>
          </>
        }
      >
        <form id="record-form" onSubmit={save}>
          <RecordForm fields={config.fields} value={form} onChange={setForm} lookups={lookups} />
          {config.compute && <RiskPreview config={config} form={form} lookups={lookups} />}
        </form>
      </Modal>

      {/* Detail modal */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? titleOf(detail) : ''}
        size="lg"
        footer={
          detail && (
            <div className="flex w-full items-center justify-between">
              <div>
                {canDelete && (
                  <Button variant="danger" icon={Trash2} onClick={() => remove(detail)} type="button">
                    Delete
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                {canEdit && (
                  <Button variant="ghost" icon={Pencil} onClick={() => openEdit(detail)} type="button">
                    Edit
                  </Button>
                )}
              </div>
            </div>
          )
        }
      >
        {detail && (
          <RecordDetail
            config={config}
            record={detail}
            lookups={lookups}
            canClose={canClose}
            onStatus={(s) => changeStatus(detail, s)}
          />
        )}
      </Modal>
    </>
  )
}

function formatCell(v) {
  if (v == null || v === '') return '—'
  return String(v)
}

function StatusChip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={[
        'rounded-full px-3 py-1.5 text-xs font-semibold transition active:scale-95',
        active ? 'bg-brand-600 text-white shadow-clay-brand' : 'bg-clay-surface text-ink-500 shadow-clay-sm hover:text-ink-800',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function RiskPreview({ config, form, lookups }) {
  const derived = config.compute(form, lookups)
  if (derived.riskScore == null) return null
  return (
    <div className="clay-inset mt-4 flex items-center justify-between p-4">
      <span className="text-sm font-medium text-ink-600">Calculated risk score</span>
      <Badge tone={derived.riskTone || 'gray'}>
        {derived.riskScore} · {derived.riskLevel}
      </Badge>
    </div>
  )
}

function RecordDetail({ config, record, lookups, canClose, onStatus }) {
  const sm = statusMeta(config, record.status)
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={sm?.tone || 'gray'}>{sm?.label || record.status || '—'}</Badge>
        <span className="text-xs text-ink-400">Created {formatDate(record.createdAt)} · by {record.createdByName || '—'}</span>
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {visibleFields(config.fields, record).map((f) => (
          <div key={f.key} className={f.type === 'textarea' ? 'sm:col-span-2' : ''}>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-400">{f.label}</dt>
            <dd className="mt-0.5 whitespace-pre-wrap text-sm text-ink-800">
              {renderValue(f, record, lookups)}
            </dd>
          </div>
        ))}
      </dl>

      {/* Status workflow */}
      {config.statuses?.length > 1 && canClose && (
        <div className="border-t border-ink-100 pt-4">
          <p className="label">Move to</p>
          <div className="flex flex-wrap gap-2">
            {config.statuses
              .filter((s) => s.value !== record.status)
              .map((s) => (
                <Button key={s.value} variant="soft" onClick={() => onStatus(s.value)} type="button">
                  {s.label}
                </Button>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}

function renderValue(field, record, lookups) {
  // `detail` renders whether or not the field holds anything, because for some
  // fields an unset value is itself worth saying out loud.
  if (field.detail) return field.detail(record, lookups)
  const value = record[field.key]
  if (value == null || value === '') return '—'
  if (field.type === 'date') return formatDate(value)
  if (field.type === 'select') {
    const opt = fieldOptions(field, record, lookups).find((o) => (o.value ?? o) === value)
    return opt?.label ?? value
  }
  return String(value)
}

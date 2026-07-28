import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import {
  PhoneCall, Phone, Plus, Pencil, Trash2, Wand2, Globe2, MapPin,
} from 'lucide-react'
import { Card, Field, Input, Select, Textarea, Button, Modal, Badge, EmptyState } from '../../../shared/ui'
import { useAuth } from '../../../shared/auth/AuthContext'
import DeptPersonPicker from '../../../shared/org/DeptPersonPicker'
import {
  addContact, updateContact, deleteContact, EXTERNAL_ROLES, INTERNAL_ROLES,
} from '../lib/firestore'
import { findNearestServices } from '../lib/nearby'

const EMPTY = {
  kind: 'external', role: 'Police', customRole: '', name: '', phone: '', altPhone: '', email: '',
  employeeUid: '', department: '', notes: '', orgWide: false,
}

/** Escalation order for internal roles; unknown roles last. */
const roleRank = (role) => {
  const i = INTERNAL_ROLES.indexOf(role)
  return i === -1 ? 99 : i
}

function ContactRow({ c, tone, isManager, onEdit, onDelete }) {
  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <Badge tone={tone}>{c.role}</Badge>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-ink-900">{c.name}</p>
        <p className="truncate text-xs text-ink-400">
          {[c.department, c.email, !c.siteId && 'all sites'].filter(Boolean).join(' · ')}
          {c.notes ? `${c.department || c.email || !c.siteId ? ' · ' : ''}${c.notes}` : ''}
        </p>
      </div>
      <a href={`tel:${c.phone}`} className={`shrink-0 rounded-xl px-3 py-1.5 text-sm font-bold transition ${
        tone === 'red' ? 'bg-red-50 text-red-700 hover:bg-red-100' : 'text-brand-700 hover:underline'
      }`}>
        {c.phone}
      </a>
      {isManager && (
        <div className="flex shrink-0 gap-0.5">
          <button className="btn-ghost px-2 py-1 text-xs" onClick={() => onEdit(c)} title="Edit"><Pencil size={13} /></button>
          <button className="btn-ghost px-2 py-1 text-xs text-red-600 hover:bg-red-50" onClick={() => onDelete(c)} title="Remove"><Trash2 size={13} /></button>
        </div>
      )}
    </li>
  )
}

/**
 * A site's emergency contacts: external services (with nearest-services
 * auto-fill from the site's coordinates) and the internal escalation chain.
 * Contacts default to this site; tick "all sites" for org-wide entries.
 */
export default function ContactsSection({ site, contacts, users }) {
  const { orgId, actor, isManager } = useAuth()
  const [editing, setEditing] = useState(null) // 'new' | contact | null
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)

  const [autoOpen, setAutoOpen] = useState(false)
  const [autoBusy, setAutoBusy] = useState(false)
  const [autoResults, setAutoResults] = useState(null)

  const mine = useMemo(
    () => (contacts || []).filter((c) => !c.siteId || c.siteId === site.id),
    [contacts, site]
  )
  const external = useMemo(() => mine.filter((c) => c.kind === 'external').sort((a, b) => a.role.localeCompare(b.role)), [mine])
  const internal = useMemo(
    () => mine.filter((c) => c.kind === 'internal').sort((a, b) => roleRank(a.role) - roleRank(b.role) || a.name.localeCompare(b.name)),
    [mine]
  )

  const openNew = (kind) => {
    setForm({ ...EMPTY, kind, role: kind === 'internal' ? 'CM' : 'Police' })
    setEditing('new')
  }
  const openEdit = (c) => {
    const known = (c.kind === 'internal' ? INTERNAL_ROLES : EXTERNAL_ROLES).includes(c.role)
    setForm({ ...EMPTY, ...c, role: known ? c.role : 'Other', customRole: known ? '' : c.role, orgWide: !c.siteId })
    setEditing(c)
  }

  const save = async (e) => {
    e.preventDefault()
    const role = form.role === 'Other' ? form.customRole.trim() : form.role
    if (!role) return toast.error('Enter the role')
    if (!form.name.trim()) return toast.error('Enter the contact name')
    if (!form.phone.trim()) return toast.error('Enter the phone number')
    setBusy(true)
    try {
      const scope = form.orgWide
        ? { region: '', entity: '', siteId: '', site: '' }
        : { region: site.region || '', entity: site.entity || '', siteId: site.id, site: site.name }
      const payload = { ...form, role, ...scope }
      if (editing === 'new') { await addContact(orgId, payload, actor); toast.success('Contact added') }
      else { await updateContact(orgId, editing.id, payload, actor); toast.success('Contact updated') }
      setEditing(null)
    } catch (err) { toast.error(err?.message || 'Failed') } finally { setBusy(false) }
  }

  const remove = async (c) => {
    if (!window.confirm(`Remove ${c.role} contact "${c.name}"?`)) return
    try { await deleteContact(orgId, c.id, actor, `${c.role} · ${c.name}`); toast.success('Contact removed') }
    catch (err) { toast.error(err?.message || 'Failed') }
  }

  // ── Nearest Police / Hospital / Fire from this site's coordinates ──
  const hasCoords = site.lat != null && site.lng != null

  const runAutoFill = async () => {
    setAutoBusy(true)
    setAutoResults(null)
    try {
      const found = await findNearestServices(site.lat, site.lng)
      if (!found.length) toast.error('No named services found nearby on OpenStreetMap')
      setAutoResults(found)
    } catch (err) {
      toast.error(err?.message || 'Map lookup failed')
    } finally {
      setAutoBusy(false)
    }
  }

  const applyAutoFill = async () => {
    if (!autoResults?.length) return
    setAutoBusy(true)
    try {
      let added = 0
      let updated = 0
      for (const r of autoResults) {
        const payload = {
          kind: 'external', role: r.role, name: r.name, phone: r.phone,
          altPhone: '', email: '', employeeUid: '', department: '',
          region: site.region || '', entity: site.entity || '', siteId: site.id, site: site.name,
          notes: `Nearest ${r.role.toLowerCase()} (~${r.distanceKm} km) via OpenStreetMap${r.phoneSource === 'fallback' ? ' · phone defaulted to 112 — verify locally' : ''}`,
        }
        const existing = external.find((c) => c.siteId === site.id && c.role === r.role)
        if (existing) { await updateContact(orgId, existing.id, payload, actor); updated += 1 }
        else { await addContact(orgId, payload, actor); added += 1 }
      }
      toast.success(`${added} contact(s) added${updated ? `, ${updated} updated` : ''}`)
      setAutoOpen(false)
      setAutoResults(null)
    } catch (err) {
      toast.error(err?.message || 'Failed to save contacts')
    } finally {
      setAutoBusy(false)
    }
  }

  const roles = form.kind === 'internal' ? INTERNAL_ROLES : EXTERNAL_ROLES

  return (
    <>
      <div className="grid gap-5 lg:grid-cols-2">
        {/* External services */}
        <Card className="overflow-hidden !p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-2 pt-4">
            <h3 className="flex items-center gap-2 font-semibold text-ink-800">
              <PhoneCall size={17} className="text-red-600" /> External services ({external.length})
            </h3>
            {isManager && (
              <div className="flex gap-1.5">
                <Button
                  variant="soft" icon={Wand2} className="!py-1.5 text-xs"
                  disabled={!hasCoords}
                  title={hasCoords ? 'Find nearest Police, Hospital & Fire station' : 'Add coordinates to this site first'}
                  onClick={() => { setAutoResults(null); setAutoOpen(true) }}
                >
                  Map nearest
                </Button>
                <Button icon={Plus} className="!py-1.5 text-xs" onClick={() => openNew('external')}>Add</Button>
              </div>
            )}
          </div>
          {external.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={PhoneCall}
                title="No external contacts"
                description={hasCoords
                  ? 'Use “Map nearest” to pull the closest Police station, Hospital and Fire station from the site’s coordinates — or add them manually.'
                  : 'Add Police, Ambulance, Fire Brigade and Hospital numbers for this site.'}
                action={isManager && hasCoords && <Button icon={Wand2} onClick={() => setAutoOpen(true)}>Map nearest</Button>}
              />
            </div>
          ) : (
            <ul className="divide-y divide-clay-200/60">
              {external.map((c) => (
                <ContactRow key={c.id} c={c} tone="red" isManager={isManager} onEdit={openEdit} onDelete={remove} />
              ))}
            </ul>
          )}
        </Card>

        {/* Internal escalation */}
        <Card className="overflow-hidden !p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-2 pt-4">
            <h3 className="flex items-center gap-2 font-semibold text-ink-800">
              <Phone size={17} className="text-brand-600" /> Internal escalation ({internal.length})
            </h3>
            {isManager && <Button icon={Plus} className="!py-1.5 text-xs" onClick={() => openNew('internal')}>Add</Button>}
          </div>
          {internal.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={Phone} title="No internal contacts" description="Add this site's CM, CLM, Safety L1/L2, Legal and HR contacts." />
            </div>
          ) : (
            <ul className="divide-y divide-clay-200/60">
              {internal.map((c) => (
                <ContactRow key={c.id} c={c} tone="brand" isManager={isManager} onEdit={openEdit} onDelete={remove} />
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* ── Add / edit contact ── */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? `Add contact — ${site.name}` : 'Edit contact'} size="lg">
        <form onSubmit={save} className="space-y-4 p-6">
          <div className="flex gap-2">
            {['external', 'internal'].map((k) => (
              <button key={k} type="button"
                onClick={() => setForm((f) => ({ ...f, kind: k, role: k === 'internal' ? 'CM' : 'Police', employeeUid: '', department: '' }))}
                className={`flex-1 rounded-xl px-3 py-2 text-sm font-bold transition ${form.kind === k ? 'bg-brand-600 text-white shadow-clay-brand' : 'bg-clay-surface text-ink-600 shadow-clay-sm'}`}>
                {k === 'external' ? 'External service' : 'Internal contact'}
              </button>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Role *">
              <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {roles.map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
            </Field>
            {form.role === 'Other' && (
              <Field label="Custom role *">
                <Input value={form.customRole} onChange={(e) => setForm({ ...form, customRole: e.target.value })} placeholder="e.g. Poison Control" />
              </Field>
            )}
          </div>

          {form.kind === 'internal' && (
            <div>
              <label className="label">Pick from employee directory — Department · Person</label>
              <DeptPersonPicker
                users={users}
                value={form.employeeUid}
                onChange={(v, u) => setForm((f) => ({
                  ...f, employeeUid: v,
                  name: u?.name || f.name,
                  email: u?.email || f.email,
                  department: u?.department || u?.dept || f.department,
                }))}
                personPlaceholder="Select employee…"
              />
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name *">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={form.kind === 'external' ? 'e.g. Elland Road Police Station' : 'Contact name'} />
            </Field>
            <Field label="Phone *">
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="e.g. 112 / +91 …" />
            </Field>
            <Field label="Alternate phone">
              <Input value={form.altPhone} onChange={(e) => setForm({ ...form, altPhone: e.target.value })} />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
          </div>

          <label className="flex items-center gap-2.5 rounded-xl bg-clay-surface px-3.5 py-2.5 shadow-clay-inset">
            <input type="checkbox" className="h-4 w-4 accent-current text-brand-600" checked={form.orgWide}
              onChange={(e) => setForm({ ...form, orgWide: e.target.checked })} />
            <span className="text-sm text-ink-700">
              <Globe2 size={13} className="mr-1 inline text-ink-400" />
              Applies to <b>all sites</b> (org-wide contact)
              <span className="ml-1 text-xs text-ink-400">— otherwise it belongs to {site.name}</span>
            </span>
          </label>

          <Field label="Notes">
            <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="e.g. 24×7 control room; ask for the duty officer" />
          </Field>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button type="submit" loading={busy}>{editing === 'new' ? 'Add contact' : 'Save changes'}</Button>
          </div>
        </form>
      </Modal>

      {/* ── Map nearest services ── */}
      <Modal open={autoOpen} onClose={() => setAutoOpen(false)} title={`Map nearest services — ${site.name}`} size="lg">
        <div className="space-y-4 p-6">
          <p className="-mt-1 text-sm text-ink-500">
            Finds the closest named <b>Hospital</b>, <b>Police station</b> and <b>Fire station</b> to this site&apos;s
            coordinates (OpenStreetMap) and saves them as its external contacts.
          </p>
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-clay-surface px-3.5 py-2.5 text-sm shadow-clay-inset">
            <MapPin size={15} className="text-brand-600" />
            <span className="text-ink-700">
              {hasCoords ? <>{site.name} — <span className="font-mono text-xs">{site.lat}, {site.lng}</span></> : 'This site has no coordinates yet — add them in the Sites module.'}
            </span>
          </div>
          <Button type="button" icon={Wand2} loading={autoBusy && !autoResults} disabled={!hasCoords} onClick={runAutoFill}>
            Find nearest services
          </Button>

          {autoResults && autoResults.length > 0 && (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                {autoResults.map((r) => (
                  <div key={r.role} className="rounded-2xl bg-clay-surface p-3.5 shadow-clay-inset">
                    <p className="text-xs font-bold uppercase tracking-widest text-ink-400">{r.role}</p>
                    <p className="mt-1 font-semibold leading-snug text-ink-900">{r.name}</p>
                    <p className="mt-1 text-sm font-bold text-red-700">{r.phone}</p>
                    <p className="mt-1 text-xs text-ink-400">
                      ~{r.distanceKm} km away{r.phoneSource === 'fallback' && ' · phone defaulted to 112 — verify'}
                    </p>
                  </div>
                ))}
              </div>
              <div className="flex justify-end">
                <Button type="button" icon={Plus} loading={autoBusy} onClick={applyAutoFill}>
                  Save {autoResults.length} contact{autoResults.length === 1 ? '' : 's'}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  )
}

import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Siren, Phone, Plus, Pencil, Trash2, Printer, PhoneCall, Mail, MapPin, Wand2 } from 'lucide-react'
import { PageHeader, Field, Input, Select, Textarea, Button, Modal, EmptyState, SkeletonCard, PrintIsolate } from '../../../shared/ui'
import { useAuth } from '../../../shared/auth/AuthContext'
import { subscribeSites, subscribeOrgUsers } from '../../../shared/org/orgData'
import { resolveAccessibleSites } from '../../../shared/auth/access'
import SiteScopePicker from '../../../shared/org/SiteScopePicker'
import DeptPersonPicker from '../../../shared/org/DeptPersonPicker'
import {
  subscribeContacts, addContact, updateContact, deleteContact,
  EXTERNAL_ROLES, INTERNAL_ROLES,
} from '../lib/firestore'
import { findNearestServices } from '../lib/nearby'

const EMPTY = {
  kind: 'external', role: 'Police', customRole: '', name: '', phone: '', altPhone: '', email: '',
  employeeUid: '', department: '', region: '', entity: '', siteId: '', site: '', notes: '',
}

function ContactCard({ c, isManager, onEdit, onDelete }) {
  return (
    <div className="card flex flex-col gap-1.5 !p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-bold text-ink-900">{c.name || '—'}</p>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">
            {c.role}{c.department ? ` · ${c.department}` : ''}
          </p>
        </div>
        {isManager && (
          <div className="flex gap-1">
            <button className="btn-ghost px-2 py-1 text-xs" onClick={() => onEdit(c)} title="Edit"><Pencil size={13} /></button>
            <button className="btn-ghost px-2 py-1 text-xs text-red-600 hover:bg-red-50" onClick={() => onDelete(c)} title="Remove"><Trash2 size={13} /></button>
          </div>
        )}
      </div>
      {c.phone && (
        <a href={`tel:${c.phone}`} className="inline-flex w-fit items-center gap-2 rounded-xl bg-red-50 px-3 py-1.5 text-sm font-bold text-red-700 transition hover:bg-red-100">
          <PhoneCall size={14} /> {c.phone}
        </a>
      )}
      {c.altPhone && (
        <a href={`tel:${c.altPhone}`} className="inline-flex w-fit items-center gap-2 rounded-xl bg-clay-100 px-3 py-1 text-xs font-semibold text-ink-700 hover:bg-clay-200">
          <Phone size={12} /> {c.altPhone}
        </a>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1 text-xs text-ink-500">
        {c.email && <span className="inline-flex items-center gap-1"><Mail size={11} /> {c.email}</span>}
        <span className="inline-flex items-center gap-1"><MapPin size={11} /> {c.site || 'All sites'}</span>
      </div>
      {c.notes && <p className="text-xs italic text-ink-400">{c.notes}</p>}
    </div>
  )
}

export default function Contacts() {
  const { orgId, actor, profile, isAdmin, isManager } = useAuth()
  const [contacts, setContacts] = useState(null)
  const [allSites, setAllSites] = useState([])
  const [users, setUsers] = useState([])
  const [siteFilter, setSiteFilter] = useState('all')
  const [editing, setEditing] = useState(null) // 'new' | contact | null
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)

  // Auto-fill nearest services (OSM) state
  const [autoOpen, setAutoOpen] = useState(false)
  const [autoSiteId, setAutoSiteId] = useState('')
  const [autoBusy, setAutoBusy] = useState(false)
  const [autoResults, setAutoResults] = useState(null)

  useEffect(() => {
    if (!orgId) return undefined
    const u1 = subscribeContacts(orgId, setContacts)
    const u2 = subscribeSites(orgId, setAllSites)
    const u3 = subscribeOrgUsers(orgId, setUsers)
    return () => { u1(); u2(); u3() }
  }, [orgId])

  const siteInventory = useMemo(() => resolveAccessibleSites(profile, allSites, { isAdmin }), [profile, allSites, isAdmin])
  const approvedUsers = useMemo(() => users.filter((u) => u.status === 'approved'), [users])

  const shown = useMemo(() => {
    const list = contacts || []
    // Org-wide contacts (no siteId) always show; site contacts follow the filter.
    return siteFilter === 'all' ? list : list.filter((c) => !c.siteId || c.siteId === siteFilter)
  }, [contacts, siteFilter])

  const groups = useMemo(() => {
    const byRole = (kind, roles) => {
      const mine = shown.filter((c) => c.kind === kind)
      const known = roles.filter((r) => r !== 'Other')
      const order = [...known, ...new Set(mine.map((c) => c.role).filter((r) => !known.includes(r)))]
      return order.map((role) => ({ role, items: mine.filter((c) => c.role === role) })).filter((g) => g.items.length)
    }
    return { external: byRole('external', EXTERNAL_ROLES), internal: byRole('internal', INTERNAL_ROLES) }
  }, [shown])

  const openNew = () => { setForm(EMPTY); setEditing('new') }
  const openEdit = (c) => {
    const known = (c.kind === 'internal' ? INTERNAL_ROLES : EXTERNAL_ROLES).includes(c.role)
    setForm({ ...EMPTY, ...c, role: known ? c.role : 'Other', customRole: known ? '' : c.role })
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
      const payload = { ...form, role }
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

  const roles = form.kind === 'internal' ? INTERNAL_ROLES : EXTERNAL_ROLES

  // ── Auto-fill nearest Hospital / Police / Fire Station from site coordinates ──
  const sitesWithCoords = useMemo(() => siteInventory.filter((s) => s.lat != null && s.lng != null), [siteInventory])

  const runAutoFill = async () => {
    const site = sitesWithCoords.find((s) => s.id === autoSiteId)
    if (!site) return toast.error('Pick a site (only sites with coordinates can be auto-filled)')
    setAutoBusy(true)
    setAutoResults(null)
    try {
      const found = await findNearestServices(site.lat, site.lng)
      if (!found.length) toast.error('No named services found within 15 km on OpenStreetMap')
      setAutoResults(found)
    } catch (err) {
      toast.error(err?.message || 'Map lookup failed')
    } finally {
      setAutoBusy(false)
    }
  }

  const applyAutoFill = async () => {
    const site = sitesWithCoords.find((s) => s.id === autoSiteId)
    if (!site || !autoResults?.length) return
    setAutoBusy(true)
    try {
      let added = 0
      let updated = 0
      for (const r of autoResults) {
        const payload = {
          kind: 'external', role: r.role, name: r.name, phone: r.phone,
          altPhone: '', email: '', employeeUid: '', department: '',
          region: site.region || '', entity: site.entity || '', siteId: site.id, site: site.name,
          notes: `Auto-filled from OpenStreetMap (~${r.distanceKm} km away)${r.phoneSource === 'fallback' ? ' · phone defaulted to 112 — verify locally' : ''}`,
        }
        const existing = (contacts || []).find((c) => c.kind === 'external' && c.siteId === site.id && c.role === r.role)
        if (existing) { await updateContact(orgId, existing.id, payload, actor); updated += 1 }
        else { await addContact(orgId, payload, actor); added += 1 }
      }
      toast.success(`${site.name}: ${added} contact(s) added${updated ? `, ${updated} updated` : ''}`)
      setAutoOpen(false)
      setAutoResults(null)
    } catch (err) {
      toast.error(err?.message || 'Failed to save contacts')
    } finally {
      setAutoBusy(false)
    }
  }

  return (
    <>
      <PrintIsolate id="ferp-sheet" />

      <PageHeader
        title="Emergency Response (FERP)"
        subtitle="Who to call in an emergency — external services and the internal escalation chain"
        icon={Siren}
        actions={
          <div className="flex flex-wrap gap-2">
            <Select className="!w-auto" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)}>
              <option value="all">All sites</option>
              {siteInventory.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
            <Button variant="soft" icon={Printer} onClick={() => window.print()}>Print FERP sheet</Button>
            {isManager && (
              <Button variant="soft" icon={Wand2} onClick={() => { setAutoSiteId(sitesWithCoords[0]?.id || ''); setAutoResults(null); setAutoOpen(true) }}>
                Auto-fill nearest
              </Button>
            )}
            {isManager && <Button icon={Plus} onClick={openNew}>Add contact</Button>}
          </div>
        }
      />

      {contacts === null ? (
        <SkeletonCard className="max-w-3xl" />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={Siren}
          title="No emergency contacts yet"
          description="Add external services (Police, Ambulance, Fire Brigade) and your internal escalation chain (CM, CLM, Safety, Legal, HR)."
          action={isManager && <Button icon={Plus} onClick={openNew}>Add contact</Button>}
        />
      ) : (
        <div className="space-y-8">
          <section>
            <h3 className="mb-3 flex items-center gap-2 font-semibold text-ink-800">
              <PhoneCall size={17} className="text-red-600" /> External emergency services
            </h3>
            {groups.external.length === 0 ? (
              <p className="text-sm italic text-ink-400">No external contacts for this site yet.</p>
            ) : (
              groups.external.map((g) => (
                <div key={g.role} className="mb-4">
                  <p className="mb-2 text-xs font-bold uppercase tracking-widest text-ink-400">{g.role}</p>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {g.items.map((c) => <ContactCard key={c.id} c={c} isManager={isManager} onEdit={openEdit} onDelete={remove} />)}
                  </div>
                </div>
              ))
            )}
          </section>

          <section>
            <h3 className="mb-3 flex items-center gap-2 font-semibold text-ink-800">
              <Phone size={17} className="text-brand-600" /> Internal escalation chain
            </h3>
            {groups.internal.length === 0 ? (
              <p className="text-sm italic text-ink-400">No internal contacts for this site yet.</p>
            ) : (
              groups.internal.map((g) => (
                <div key={g.role} className="mb-4">
                  <p className="mb-2 text-xs font-bold uppercase tracking-widest text-ink-400">{g.role}</p>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {g.items.map((c) => <ContactCard key={c.id} c={c} isManager={isManager} onEdit={openEdit} onDelete={remove} />)}
                  </div>
                </div>
              ))
            )}
          </section>
        </div>
      )}

      {/* ── Printable FERP contact sheet ── */}
      <div id="ferp-sheet" className="hidden bg-white p-10 text-black">
        <h1 className="mb-1 text-2xl font-black uppercase">Fire &amp; Emergency Response Plan — Contact Sheet</h1>
        <p className="mb-6 text-sm">
          {siteFilter === 'all' ? 'All sites' : siteInventory.find((s) => s.id === siteFilter)?.name || ''} · Printed {new Date().toLocaleDateString()}
        </p>
        {[['EXTERNAL EMERGENCY SERVICES', groups.external], ['INTERNAL ESCALATION CHAIN', groups.internal]].map(([label, list]) => (
          <div key={label} className="mb-6">
            <h2 className="mb-2 border-b-2 border-black pb-1 text-sm font-black">{label}</h2>
            <table className="w-full text-sm">
              <tbody>
                {list.flatMap((g) => g.items).map((c) => (
                  <tr key={c.id} className="border-b border-gray-300">
                    <td className="w-1/4 py-1.5 font-bold">{c.role}</td>
                    <td className="w-1/4 py-1.5">{c.name}</td>
                    <td className="w-1/4 py-1.5 font-mono font-bold">{c.phone}{c.altPhone ? ` / ${c.altPhone}` : ''}</td>
                    <td className="py-1.5">{c.site || 'All sites'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {/* ── Add / edit ── */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add emergency contact' : 'Edit emergency contact'} size="lg">
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

          {form.kind === 'internal' ? (
            <div>
              <label className="label">Pick from employee directory — Department · Person</label>
              <DeptPersonPicker
                users={approvedUsers}
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
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name *">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={form.kind === 'external' ? 'e.g. Kondapur Police Station' : 'Contact name'} />
            </Field>
            <Field label="Phone *">
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="e.g. 100 / +91 …" />
            </Field>
            <Field label="Alternate phone">
              <Input value={form.altPhone} onChange={(e) => setForm({ ...form, altPhone: e.target.value })} />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
          </div>

          <div>
            <label className="label">Site scope (blank = all sites)</label>
            <SiteScopePicker
              module="emergency"
              sites={siteInventory}
              value={form}
              onChange={(v) => setForm((f) => ({ ...f, ...v }))}
            />
          </div>

          <Field label="Notes">
            <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="e.g. 24×7 control room; ask for the duty officer" />
          </Field>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button type="submit" loading={busy}>{editing === 'new' ? 'Add contact' : 'Save changes'}</Button>
          </div>
        </form>
      </Modal>

      {/* ── Auto-fill nearest services from site coordinates (OpenStreetMap) ── */}
      <Modal open={autoOpen} onClose={() => setAutoOpen(false)} title="Auto-fill nearest emergency services" size="lg">
        <div className="space-y-4 p-6">
          <p className="-mt-1 text-sm text-ink-500">
            Finds the closest named <b>Hospital</b>, <b>Police station</b> and <b>Fire station</b> to the
            site&apos;s coordinates (OpenStreetMap, 15 km radius) and saves them as that site&apos;s external contacts.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Site (needs coordinates)">
              <Select className="!w-auto" value={autoSiteId} onChange={(e) => { setAutoSiteId(e.target.value); setAutoResults(null) }}>
                <option value="">Select site…</option>
                {sitesWithCoords.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Button type="button" icon={Wand2} loading={autoBusy && !autoResults} disabled={!autoSiteId} onClick={runAutoFill}>
              Find services
            </Button>
          </div>
          {sitesWithCoords.length === 0 && (
            <p className="text-xs text-amber-600">No sites have coordinates yet — add latitude/longitude in the Sites module first.</p>
          )}

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
                  Save {autoResults.length} contact{autoResults.length === 1 ? '' : 's'} for this site
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  )
}

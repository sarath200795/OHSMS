import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  Map, Phone, PhoneCall, Printer, Upload, Trash2, ImageOff, ArrowRight, Building2,
} from 'lucide-react'
import { PageHeader, Card, Select, Button, Badge, EmptyState, SkeletonCard, Modal, PrintIsolate } from '../../../shared/ui'
import { useAuth } from '../../../shared/auth/AuthContext'
import { subscribeSites } from '../../../shared/org/orgData'
import { resolveAccessibleSites } from '../../../shared/auth/access'
import { formatDate } from '../../../shared/lib/format'
import { fileToDataUrl } from '../../../shared/lib/files'
import {
  subscribeContacts, subscribeLayouts, saveLayout, deleteLayout, INTERNAL_ROLES,
} from '../lib/firestore'

const MAX_LAYOUT_BYTES = 900 * 1024

/** Order internal contacts by the escalation chain, unknown roles last. */
const roleRank = (role) => {
  const i = INTERNAL_ROLES.indexOf(role)
  return i === -1 ? 99 : i
}

export default function SiteFerp() {
  const { orgId, actor, profile, isAdmin, isManager } = useAuth()
  const [contacts, setContacts] = useState(null)
  const [layouts, setLayouts] = useState({})
  const [allSites, setAllSites] = useState([])
  const [siteId, setSiteId] = useState('')
  const [viewLayout, setViewLayout] = useState(false)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => {
    if (!orgId) return undefined
    const u1 = subscribeContacts(orgId, setContacts)
    const u2 = subscribeLayouts(orgId, setLayouts)
    const u3 = subscribeSites(orgId, setAllSites)
    return () => { u1(); u2(); u3() }
  }, [orgId])

  const siteInventory = useMemo(() => resolveAccessibleSites(profile, allSites, { isAdmin }), [profile, allSites, isAdmin])
  const site = useMemo(
    () => siteInventory.find((s) => s.id === siteId) || siteInventory[0] || null,
    [siteInventory, siteId]
  )
  const layout = site ? layouts[site.id] : null

  // Site contacts + org-wide fallbacks (no siteId = applies everywhere).
  const siteContacts = useMemo(() => {
    if (!site) return { internal: [], external: [] }
    const mine = (contacts || []).filter((c) => !c.siteId || c.siteId === site.id)
    return {
      internal: mine.filter((c) => c.kind === 'internal').sort((a, b) => roleRank(a.role) - roleRank(b.role) || a.name.localeCompare(b.name)),
      external: mine.filter((c) => c.kind === 'external'),
    }
  }, [contacts, site])

  const uploadLayout = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !site) return
    if (!file.type.startsWith('image/')) return toast.error('Pick an image (photo or exported plan)')
    if (file.size > MAX_LAYOUT_BYTES) return toast.error('Keep the layout under 900 KB — export a compressed JPG/PNG')
    setBusy(true)
    try {
      const dataUrl = await fileToDataUrl(file)
      await saveLayout(orgId, site, { dataUrl, fileName: file.name }, actor)
      toast.success(`Evacuation layout saved for ${site.name}`)
    } catch (err) {
      toast.error(err?.message || 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  const removeLayout = async () => {
    if (!site || !window.confirm(`Remove the evacuation layout for ${site.name}?`)) return
    try {
      await deleteLayout(orgId, site, actor)
      toast.success('Layout removed')
    } catch (err) {
      toast.error(err?.message || 'Failed')
    }
  }

  if (contacts === null || !siteInventory.length) {
    return (
      <>
        <PageHeader title="Site FERP" subtitle="Per-site emergency plan — escalation chain & evacuation layout" icon={Map} />
        {contacts === null ? <SkeletonCard className="max-w-3xl" /> : (
          <EmptyState icon={Building2} title="No sites yet" description="Add sites first — each site gets its own FERP view." />
        )}
      </>
    )
  }

  return (
    <>
      <PrintIsolate id="site-ferp-sheet" />

      <PageHeader
        title="Site FERP"
        subtitle="Per-site emergency plan — internal escalation chain & evacuation layout"
        icon={Map}
        actions={
          <div className="flex flex-wrap gap-2">
            <Select className="!w-auto" value={site?.id || ''} onChange={(e) => setSiteId(e.target.value)}>
              {siteInventory.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
            <Button variant="soft" icon={Printer} onClick={() => window.print()}>Print site FERP</Button>
          </div>
        }
      />

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ── Internal escalation chain for this site ── */}
        <Card className="overflow-hidden !p-0">
          <div className="flex items-center justify-between px-5 pb-1 pt-4">
            <h3 className="flex items-center gap-2 font-semibold text-ink-800">
              <Phone size={17} className="text-brand-600" /> Internal escalation chain — {site.name}
            </h3>
            <Link to="/emergency-response" className="text-xs font-semibold text-brand-600 hover:underline">
              Manage contacts <ArrowRight size={12} className="inline" />
            </Link>
          </div>
          {siteContacts.internal.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={Phone} title="No internal contacts" description="Add CM, CLM, Safety L1/L2, Legal and HR contacts in the Contacts tab." />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-2.5">Role</th>
                  <th className="px-4 py-2.5">Name</th>
                  <th className="px-4 py-2.5">Phone</th>
                  <th className="px-4 py-2.5">Scope</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-clay-200/60">
                {siteContacts.internal.map((c) => (
                  <tr key={c.id} className="hover:bg-clay-100/50">
                    <td className="px-5 py-2.5"><Badge tone="brand">{c.role}</Badge></td>
                    <td className="px-4 py-2.5">
                      <p className="font-semibold text-ink-900">{c.name}</p>
                      <p className="text-xs text-ink-400">{c.department || ''}{c.email ? (c.department ? ' · ' : '') + c.email : ''}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      <a href={`tel:${c.phone}`} className="font-bold text-brand-700 hover:underline">{c.phone}</a>
                      {c.altPhone && <p className="text-xs text-ink-400">{c.altPhone}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-ink-500">{c.siteId ? site.name : 'All sites'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* External quick-dial strip */}
          {siteContacts.external.length > 0 && (
            <div className="border-t border-clay-200/60 px-5 py-3">
              <p className="mb-2 text-xs font-bold uppercase tracking-widest text-ink-400">External quick dial</p>
              <div className="flex flex-wrap gap-1.5">
                {siteContacts.external.map((c) => (
                  <a key={c.id} href={`tel:${c.phone}`} className="chip bg-red-50 font-semibold text-red-700 hover:bg-red-100">
                    <PhoneCall size={12} /> {c.role}: {c.phone}
                  </a>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* ── Evacuation layout ── */}
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 font-semibold text-ink-800">
              <Map size={17} className="text-accent-amber" /> Emergency evacuation layout
            </h3>
            {isManager && (
              <div className="flex gap-1.5">
                <Button variant="soft" icon={Upload} loading={busy} onClick={() => fileRef.current?.click()}>
                  {layout ? 'Replace' : 'Upload layout'}
                </Button>
                {layout && (
                  <button className="btn-ghost px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-50" onClick={removeLayout} title="Remove layout">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={uploadLayout} />
          </div>

          {layout ? (
            <>
              <button type="button" className="block w-full overflow-hidden rounded-2xl shadow-clay-sm transition hover:opacity-95" onClick={() => setViewLayout(true)} title="Click to enlarge">
                <img src={layout.dataUrl} alt={`Evacuation layout — ${site.name}`} className="max-h-[420px] w-full bg-white object-contain" />
              </button>
              <p className="mt-2 text-xs text-ink-400">
                {layout.fileName || 'layout'}{layout.updatedAt?.toDate ? ` · updated ${formatDate(layout.updatedAt.toDate())}` : ''}{layout.updatedByName ? ` by ${layout.updatedByName}` : ''} · click to enlarge
              </p>
            </>
          ) : (
            <EmptyState
              icon={ImageOff}
              title="No evacuation layout yet"
              description={isManager
                ? 'Upload the site’s evacuation / assembly-point plan (JPG or PNG, up to 900 KB).'
                : 'The evacuation plan for this site hasn’t been uploaded yet — ask a manager.'}
              action={isManager && <Button icon={Upload} onClick={() => fileRef.current?.click()}>Upload layout</Button>}
            />
          )}
        </Card>
      </div>

      {/* Full-screen layout viewer */}
      <Modal open={viewLayout} onClose={() => setViewLayout(false)} title={`Evacuation layout — ${site.name}`} size="xl">
        <div className="p-4">
          {layout && <img src={layout.dataUrl} alt={`Evacuation layout — ${site.name}`} className="max-h-[75vh] w-full bg-white object-contain" />}
        </div>
      </Modal>

      {/* ── Printable site FERP (contacts + layout on one sheet) ── */}
      <div id="site-ferp-sheet" className="hidden bg-white p-10 text-black">
        <h1 className="mb-1 text-2xl font-black uppercase">Fire &amp; Emergency Response Plan — {site.name}</h1>
        <p className="mb-5 text-sm">{[site.entity, site.region].filter(Boolean).join(' · ')} · Printed {new Date().toLocaleDateString()}</p>

        <h2 className="mb-2 border-b-2 border-black pb-1 text-sm font-black">EXTERNAL EMERGENCY SERVICES</h2>
        <table className="mb-5 w-full text-sm">
          <tbody>
            {siteContacts.external.map((c) => (
              <tr key={c.id} className="border-b border-gray-300">
                <td className="w-1/3 py-1.5 font-bold">{c.role}</td>
                <td className="w-1/3 py-1.5">{c.name}</td>
                <td className="py-1.5 font-mono font-bold">{c.phone}{c.altPhone ? ` / ${c.altPhone}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2 className="mb-2 border-b-2 border-black pb-1 text-sm font-black">INTERNAL ESCALATION CHAIN</h2>
        <table className="mb-5 w-full text-sm">
          <tbody>
            {siteContacts.internal.map((c) => (
              <tr key={c.id} className="border-b border-gray-300">
                <td className="w-1/4 py-1.5 font-bold">{c.role}</td>
                <td className="w-1/4 py-1.5">{c.name}</td>
                <td className="w-1/4 py-1.5 font-mono font-bold">{c.phone}</td>
                <td className="py-1.5">{c.email || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {layout && (
          <>
            <h2 className="mb-2 border-b-2 border-black pb-1 text-sm font-black">EMERGENCY EVACUATION LAYOUT</h2>
            <img src={layout.dataUrl} alt="Evacuation layout" className="max-h-[520px] w-full object-contain" />
          </>
        )}
      </div>
    </>
  )
}

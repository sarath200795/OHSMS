import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  Map, Phone, PhoneCall, Printer, Upload, Trash2, ImageOff, ArrowLeft, Building2, LifeBuoy,
} from 'lucide-react'
import {
  PageHeader, Card, Button, Badge, EmptyState, SkeletonCard, Modal, PrintIsolate,
} from '../../../shared/ui'
import { useAuth } from '../../../shared/auth/AuthContext'
import { subscribeSites, subscribeOrgUsers } from '../../../shared/org/orgData'
import { resolveAccessibleSites } from '../../../shared/auth/access'
import { formatDate } from '../../../shared/lib/format'
import { fileToDataUrl } from '../../../shared/lib/files'
import RescuePlans from '../components/RescuePlans'
import {
  subscribeContacts, subscribeLayouts, subscribeRescuePlans, saveLayout, deleteLayout, INTERNAL_ROLES,
} from '../lib/firestore'

const MAX_LAYOUT_BYTES = 900 * 1024

/** Escalation order; unknown roles last. */
const roleRank = (role) => {
  const i = INTERNAL_ROLES.indexOf(role)
  return i === -1 ? 99 : i
}

const SECTIONS = [
  { key: 'contacts', label: 'Contacts', icon: Phone },
  { key: 'ferp', label: 'FERP Plan', icon: Map },
  { key: 'rescue', label: 'Rescue Plans', icon: LifeBuoy },
]

export default function SiteDetail() {
  const { siteId } = useParams()
  const { orgId, actor, profile, isAdmin, isManager } = useAuth()
  const [contacts, setContacts] = useState(null)
  const [layouts, setLayouts] = useState({})
  const [plans, setPlans] = useState([])
  const [allSites, setAllSites] = useState([])
  const [users, setUsers] = useState([])
  const [section, setSection] = useState('contacts')
  const [viewLayout, setViewLayout] = useState(false)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => {
    if (!orgId) return undefined
    const u1 = subscribeContacts(orgId, setContacts)
    const u2 = subscribeLayouts(orgId, setLayouts)
    const u3 = subscribeRescuePlans(orgId, setPlans)
    const u4 = subscribeSites(orgId, setAllSites)
    const u5 = subscribeOrgUsers(orgId, setUsers)
    return () => { u1(); u2(); u3(); u4(); u5() }
  }, [orgId])

  const siteInventory = useMemo(() => resolveAccessibleSites(profile, allSites, { isAdmin }), [profile, allSites, isAdmin])
  const site = useMemo(() => siteInventory.find((s) => s.id === siteId) || null, [siteInventory, siteId])
  const approvedUsers = useMemo(() => users.filter((u) => u.status === 'approved'), [users])
  const layout = site ? layouts[site.id] : null

  const siteContacts = useMemo(() => {
    if (!site) return { internal: [], external: [] }
    const mine = (contacts || []).filter((c) => !c.siteId || c.siteId === site.id)
    return {
      internal: mine
        .filter((c) => c.kind === 'internal')
        .sort((a, b) => roleRank(a.role) - roleRank(b.role) || a.name.localeCompare(b.name)),
      external: mine.filter((c) => c.kind === 'external'),
    }
  }, [contacts, site])

  const sitePlans = useMemo(() => plans.filter((p) => p.siteId === siteId), [plans, siteId])

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
      toast.success(`FERP plan saved for ${site.name}`)
    } catch (err) {
      toast.error(err?.message || 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  const removeLayout = async () => {
    if (!site || !window.confirm(`Remove the FERP plan for ${site.name}?`)) return
    try { await deleteLayout(orgId, site, actor); toast.success('FERP plan removed') }
    catch (err) { toast.error(err?.message || 'Failed') }
  }

  if (contacts === null) {
    return (
      <>
        <PageHeader title="Site emergency repository" icon={Building2} />
        <SkeletonCard className="max-w-3xl" />
      </>
    )
  }

  if (!site) {
    return (
      <>
        <PageHeader title="Site not found" icon={Building2} />
        <EmptyState
          icon={Building2}
          title="This site isn't available"
          description="It may have been removed, or you don't have access to it."
          action={<Link to="/emergency-response/sites" className="btn-primary"><ArrowLeft size={16} /> Back to repository</Link>}
        />
      </>
    )
  }

  return (
    <>
      <PrintIsolate id="site-ferp-sheet" />

      <Link to="/emergency-response/sites" className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 transition hover:text-brand-600 print:hidden">
        <ArrowLeft size={15} /> All sites
      </Link>

      <PageHeader
        title={site.name}
        subtitle={`Emergency repository — ${[site.entity, site.region].filter(Boolean).join(' · ') || 'contacts, FERP plan & rescue plans'}`}
        icon={Building2}
        actions={<Button variant="soft" icon={Printer} onClick={() => window.print()}>Print site FERP</Button>}
      />

      {/* Section switch */}
      <div className="mb-5 flex flex-wrap gap-1.5 print:hidden">
        {SECTIONS.map((s) => {
          const count =
            s.key === 'contacts' ? siteContacts.internal.length + siteContacts.external.length
            : s.key === 'rescue' ? sitePlans.length
            : layout ? 1 : 0
          return (
            <button
              key={s.key}
              onClick={() => setSection(s.key)}
              className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition ${
                section === s.key ? 'bg-brand-600 text-white shadow-clay-brand' : 'bg-clay-surface text-ink-500 shadow-clay-sm hover:text-ink-800'
              }`}
            >
              <s.icon size={15} /> {s.label}
              <span className={`rounded-full px-1.5 text-[10px] font-bold ${section === s.key ? 'bg-white/20' : 'bg-clay-100 text-ink-500'}`}>{count}</span>
            </button>
          )
        })}
      </div>

      {/* ── Contacts ── */}
      {section === 'contacts' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="overflow-hidden !p-0">
            <div className="flex items-center justify-between px-5 pb-1 pt-4">
              <h3 className="flex items-center gap-2 font-semibold text-ink-800">
                <PhoneCall size={17} className="text-red-600" /> External services ({siteContacts.external.length})
              </h3>
              <Link to="/emergency-response" className="text-xs font-semibold text-brand-600 hover:underline">Manage</Link>
            </div>
            {siteContacts.external.length === 0 ? (
              <div className="p-5"><EmptyState icon={PhoneCall} title="No external contacts" description="Add Police, Ambulance, Fire Brigade and Hospital numbers — or use Auto-fill nearest on the Contacts tab." /></div>
            ) : (
              <ul className="divide-y divide-clay-200/60">
                {siteContacts.external.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-5 py-3">
                    <Badge tone="red">{c.role}</Badge>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-ink-900">{c.name}</p>
                      {c.notes && <p className="truncate text-xs text-ink-400">{c.notes}</p>}
                    </div>
                    <a href={`tel:${c.phone}`} className="shrink-0 rounded-xl bg-red-50 px-3 py-1.5 text-sm font-bold text-red-700 transition hover:bg-red-100">{c.phone}</a>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="overflow-hidden !p-0">
            <div className="flex items-center justify-between px-5 pb-1 pt-4">
              <h3 className="flex items-center gap-2 font-semibold text-ink-800">
                <Phone size={17} className="text-brand-600" /> Internal escalation ({siteContacts.internal.length})
              </h3>
              <Link to="/emergency-response" className="text-xs font-semibold text-brand-600 hover:underline">Manage</Link>
            </div>
            {siteContacts.internal.length === 0 ? (
              <div className="p-5"><EmptyState icon={Phone} title="No internal contacts" description="Add CM, CLM, Safety L1/L2, Legal and HR contacts on the Contacts tab." /></div>
            ) : (
              <ul className="divide-y divide-clay-200/60">
                {siteContacts.internal.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-5 py-3">
                    <Badge tone="brand">{c.role}</Badge>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-ink-900">{c.name}</p>
                      <p className="truncate text-xs text-ink-400">
                        {c.department || ''}{c.email ? (c.department ? ' · ' : '') + c.email : ''}
                        {!c.siteId && ' · all sites'}
                      </p>
                    </div>
                    <a href={`tel:${c.phone}`} className="shrink-0 font-bold text-brand-700 hover:underline">{c.phone}</a>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {/* ── FERP plan (evacuation layout) ── */}
      {section === 'ferp' && (
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 font-semibold text-ink-800">
              <Map size={17} className="text-accent-amber" /> FERP plan — evacuation layout
            </h3>
            {isManager && (
              <div className="flex gap-1.5">
                <Button variant="soft" icon={Upload} loading={busy} onClick={() => fileRef.current?.click()}>
                  {layout ? 'Replace' : 'Upload plan'}
                </Button>
                {layout && (
                  <button className="btn-ghost px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-50" onClick={removeLayout} title="Remove plan">
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
                <img src={layout.dataUrl} alt={`FERP plan — ${site.name}`} className="max-h-[520px] w-full bg-white object-contain" />
              </button>
              <p className="mt-2 text-xs text-ink-400">
                {layout.fileName || 'layout'}
                {layout.updatedAt?.toDate ? ` · updated ${formatDate(layout.updatedAt.toDate())}` : ''}
                {layout.updatedByName ? ` by ${layout.updatedByName}` : ''} · click to enlarge
              </p>
            </>
          ) : (
            <EmptyState
              icon={ImageOff}
              title="No FERP plan uploaded"
              description={isManager
                ? 'Upload this site’s fire & emergency response plan — evacuation routes, exits and assembly points (JPG/PNG up to 900 KB).'
                : 'The FERP plan for this site hasn’t been uploaded yet — ask a manager.'}
              action={isManager && <Button icon={Upload} onClick={() => fileRef.current?.click()}>Upload plan</Button>}
            />
          )}
        </Card>
      )}

      {/* ── Rescue plans ── */}
      {section === 'rescue' && <RescuePlans site={site} plans={plans} users={approvedUsers} />}

      <Modal open={viewLayout} onClose={() => setViewLayout(false)} title={`FERP plan — ${site.name}`} size="xl">
        <div className="p-4">
          {layout && <img src={layout.dataUrl} alt={`FERP plan — ${site.name}`} className="max-h-[75vh] w-full bg-white object-contain" />}
        </div>
      </Modal>

      {/* ── Printable site FERP: contacts + plan + rescue plans ── */}
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
          <div className="mb-5">
            <h2 className="mb-2 border-b-2 border-black pb-1 text-sm font-black">EVACUATION LAYOUT</h2>
            <img src={layout.dataUrl} alt="FERP plan" className="max-h-[460px] w-full object-contain" />
          </div>
        )}

        {sitePlans.length > 0 && (
          <div style={{ pageBreakBefore: 'always' }}>
            <h2 className="mb-2 border-b-2 border-black pb-1 text-sm font-black">EMERGENCY RESCUE PLANS</h2>
            {sitePlans.map((p) => (
              <div key={p.id} className="mb-4">
                <p className="text-sm font-black">{p.scenario} — {p.title}</p>
                {p.assemblyPoint && <p className="text-xs">Assembly point: {p.assemblyPoint}</p>}
                {p.triggers && <p className="text-xs">Activate when: {p.triggers}</p>}
                <ol className="ml-5 mt-1 list-decimal text-sm">
                  {(p.steps || []).map((s) => (
                    <li key={s.id}>{s.action}{s.responsible ? ` — ${s.responsible}` : ''}</li>
                  ))}
                </ol>
                {(p.team || []).length > 0 && (
                  <p className="mt-1 text-xs"><b>Rescue team:</b> {p.team.map((t) => `${t.role ? t.role + ': ' : ''}${t.name}${t.phone ? ' (' + t.phone + ')' : ''}`).join(' · ')}</p>
                )}
                {(p.equipment || []).length > 0 && <p className="text-xs"><b>Equipment:</b> {p.equipment.join(', ')}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

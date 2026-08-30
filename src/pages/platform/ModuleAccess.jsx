// ─────────────────────────────────────────────────────────────────────────────
// Platform console — which modules each organization may see and use.
//
// Reachable only by an account holding /platformAdmins/{uid}, a document no
// client operation can write. Every organization on the platform is listed;
// selecting one shows the full module registry with a switch against each.
//
// The page is deliberately a draft-then-save, not a live toggle. Switching a
// module off removes it from every screen of a running tenant the instant it is
// written, and an accidental brush against a switch is not an intention. The
// unsaved state is visible, discardable, and named.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import {
  Building2, Check, RotateCcw, Save, Search, ShieldCheck, SlidersHorizontal, X,
} from 'lucide-react'
import { useAuth } from '../../shared/auth/AuthContext'
import { listOrganizations } from '../../shared/org/orgData'
import { MODULES, ADDONS } from '../../shared/modules/registry'
import {
  ALL_MODULE_KEYS,
  disabledKeys,
  normalizeEntitlement,
  resetEntitlement,
  saveEntitlement,
  subscribeAllEntitlements,
} from '../../shared/modules/entitlements'
import { PageHeader, Card, Button, Input, Badge, SkeletonCard, EmptyState } from '../../shared/ui'

const TOTAL = ALL_MODULE_KEYS.length

/** Two maps agree on every known key. */
function sameMap(a, b) {
  return ALL_MODULE_KEYS.every((k) => (a?.[k] !== false) === (b?.[k] !== false))
}

export default function ModuleAccess() {
  const { user, profile } = useAuth()

  const [orgs, setOrgs] = useState(null) // null = still loading
  const [ents, setEnts] = useState({})
  const [entsReady, setEntsReady] = useState(false)
  const [loadError, setLoadError] = useState('')

  const [selected, setSelected] = useState('')
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState('')

  // The organization list comes from /orgIndex — the same public lookup the
  // signup screen uses — because /organizations is readable only by its own
  // members, and the operator of the platform is a member of at most one.
  useEffect(() => {
    let live = true
    listOrganizations()
      .then((list) => live && setOrgs(list))
      .catch((err) => {
        if (!live) return
        setOrgs([])
        setLoadError(err?.message || 'Could not load the organization list.')
      })
    return () => { live = false }
  }, [])

  useEffect(
    () =>
      subscribeAllEntitlements(
        (map) => { setEnts(map); setEntsReady(true) },
        (err) => { setEntsReady(true); setLoadError(err?.message || 'Could not load entitlements.') }
      ),
    []
  )

  const stored = useMemo(
    () => ents[selected]?.map || normalizeEntitlement(null),
    [ents, selected]
  )

  // Adopt the stored state when the selection changes. An in-flight edit for
  // the same org is left alone: a snapshot arriving from this very save (or
  // from another operator's tab) must not silently discard what is on screen.
  useEffect(() => {
    setDraft(null)
  }, [selected])

  const working = draft || stored
  const dirty = draft !== null && !sameMap(draft, stored)

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const list = (orgs || []).filter((o) => !q || o.name.toLowerCase().includes(q) || o.id.toLowerCase().includes(q))
    return list.map((o) => {
      const e = ents[o.id]
      const off = e ? disabledKeys(e.map).length : 0
      return { ...o, configured: Boolean(e), off }
    })
  }, [orgs, ents, filter])

  const current = rows.find((o) => o.id === selected) || (orgs || []).find((o) => o.id === selected)

  const setKey = (key, on) => setDraft({ ...working, [key]: on })
  const setAll = (on) => setDraft(Object.fromEntries(ALL_MODULE_KEYS.map((k) => [k, on])))

  const save = async () => {
    if (!selected) return
    setBusy(true)
    try {
      await saveEntitlement(selected, working, { uid: user?.uid, email: profile?.email || user?.email || '' })
      setDraft(null)
      toast.success(`Saved — ${current?.name || selected}`)
    } catch (err) {
      // The only expected failure is a rules refusal, which means this account
      // no longer holds the platform grant. Say so rather than "write failed".
      toast.error(
        err?.code === 'permission-denied'
          ? 'Refused. This account no longer has platform access.'
          : err?.message || 'Could not save.'
      )
    } finally {
      setBusy(false)
    }
  }

  const restoreDefault = async () => {
    if (!selected) return
    setBusy(true)
    try {
      await resetEntitlement(selected)
      setDraft(null)
      toast.success('Restored to the full product.')
    } catch (err) {
      toast.error(err?.message || 'Could not reset.')
    } finally {
      setBusy(false)
    }
  }

  const loading = orgs === null || !entsReady

  return (
    <>
      <PageHeader
        title="Module access"
        subtitle="Which modules each organization can see and use"
        icon={SlidersHorizontal}
        actions={
          <Badge tone="brand">
            <ShieldCheck size={13} className="mr-1 inline" />
            Platform operator
          </Badge>
        }
      />

      {loadError && (
        <Card className="mb-4 border-l-4 border-l-red-500">
          <p className="text-[13.5px] font-semibold text-red-700">{loadError}</p>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* ── Organizations ─────────────────────────────────────────────── */}
        <Card className="p-0">
          <div className="border-b border-ink-100 p-4">
            <div className="relative">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Find an organization…"
                className="pl-9"
                aria-label="Filter organizations"
              />
            </div>
            <p className="mt-2 text-[11.5px] text-ink-400">
              {loading ? 'Loading…' : `${rows.length} organization${rows.length === 1 ? '' : 's'}`}
            </p>
          </div>

          {loading ? (
            <div className="p-4"><SkeletonCard /></div>
          ) : rows.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={Building2}
                title="No organizations"
                description={filter ? 'Nothing matches that search.' : 'No organization has registered yet.'}
              />
            </div>
          ) : (
            <ul className="max-h-[560px] overflow-y-auto p-2">
              {rows.map((o) => {
                const active = o.id === selected
                return (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(o.id)}
                      aria-current={active ? 'true' : undefined}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                        active ? 'bg-brand-50 text-brand-900' : 'hover:bg-clay-100'
                      }`}
                    >
                      <span className={`grid h-8 w-8 flex-none place-items-center rounded-lg ${active ? 'bg-brand-600 text-white' : 'bg-clay-100 text-ink-500'}`}>
                        <Building2 size={15} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-semibold text-ink-900">{o.name}</span>
                        <span className="block text-[11.5px] text-ink-400">
                          {o.off === 0
                            ? o.configured ? 'All modules on' : 'All modules on (default)'
                            : `${o.off} of ${TOTAL} off`}
                        </span>
                      </span>
                      {o.off > 0 && <Badge tone="amber">{TOTAL - o.off}</Badge>}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        {/* ── Modules for the selected org ───────────────────────────────── */}
        {!selected ? (
          <Card className="grid place-items-center py-16">
            <EmptyState
              icon={SlidersHorizontal}
              title="Choose an organization"
              description="Pick one on the left to see which modules it has, and change them."
            />
          </Card>
        ) : (
          <Card className="p-0">
            <div className="flex flex-wrap items-center gap-3 border-b border-ink-100 p-5">
              {/* A minimum width rather than min-w-0. The row wraps, so without
                  a floor the four controls beside it win every pixel and the
                  organization's name — the one thing that says WHOSE modules
                  these are — truncates to two letters. With a floor, the
                  buttons wrap to their own line instead. */}
              <div className="min-w-[13rem] flex-1">
                <p className="truncate text-[15px] font-bold tracking-[-0.015em] text-ink-900">
                  {current?.name || selected}
                </p>
                <p className="text-[11.5px] text-ink-400">
                  {ALL_MODULE_KEYS.filter((k) => working[k] !== false).length} of {TOTAL} modules enabled
                  {ents[selected]?.raw?.updatedByEmail ? ` · last set by ${ents[selected].raw.updatedByEmail}` : ''}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setAll(true)} disabled={busy}>
                Enable all
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setAll(false)} disabled={busy}>
                Disable all
              </Button>
              {dirty && (
                <Button variant="ghost" size="sm" icon={X} onClick={() => setDraft(null)} disabled={busy}>
                  Discard
                </Button>
              )}
              <Button icon={Save} onClick={save} loading={busy} disabled={!dirty}>
                {dirty ? 'Save changes' : 'Saved'}
              </Button>
            </div>

            {dirty && (
              <p className="border-b border-amber-200 bg-amber-50 px-5 py-2.5 text-[12.5px] font-semibold text-amber-800">
                Unsaved. Nothing changes for this organization until you save.
              </p>
            )}

            <ul className="divide-y divide-ink-100">
              {MODULES.map((m) => (
                <ModuleRow
                  key={m.key}
                  module={m}
                  on={working[m.key] !== false}
                  changed={draft !== null && (stored[m.key] !== false) !== (working[m.key] !== false)}
                  disabled={busy}
                  onChange={(on) => setKey(m.key, on)}
                />
              ))}
            </ul>

            {/* Licensed the same way, listed apart, because the default is the
                opposite: a module is on unless switched off, an add-on is off
                unless switched on. Mixing them into one list would put two
                different meanings under one set of switches. */}
            {ADDONS.length > 0 && (
              <>
                <p className="border-y border-ink-100 bg-clay-50 px-5 py-2.5 text-[11px] font-bold uppercase tracking-wide text-ink-400">
                  Add-ons · off unless switched on
                </p>
                <ul className="divide-y divide-ink-100">
                  {ADDONS.map((a) => (
                    <ModuleRow
                      key={a.key}
                      module={a}
                      on={working[a.key] === true}
                      changed={draft !== null && (stored[a.key] === true) !== (working[a.key] === true)}
                      disabled={busy}
                      onChange={(on) => setKey(a.key, on)}
                    />
                  ))}
                </ul>
              </>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 p-5">
              <p className="max-w-md text-[11.5px] text-ink-400">
                An organization with no record here gets the full product — every module on, every
                add-on off. Restoring the default deletes its record rather than writing each switch,
                so modules added later stay on and add-ons added later stay off.
              </p>
              <Button
                variant="ghost"
                size="sm"
                icon={RotateCcw}
                onClick={restoreDefault}
                disabled={busy || !ents[selected]}
              >
                Restore default
              </Button>
            </div>
          </Card>
        )}
      </div>
    </>
  )
}

/** One module, its description, and the switch that governs it. */
function ModuleRow({ module: m, on, changed, disabled, onChange }) {
  const Icon = m.icon
  return (
    <li className={`flex items-start gap-4 px-5 py-4 ${changed ? 'bg-amber-50/60' : ''}`}>
      <span className={`mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-xl ${on ? 'bg-brand-50 text-brand-700' : 'bg-clay-100 text-ink-400'}`}>
        <Icon size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-[13.5px] font-bold ${on ? 'text-ink-900' : 'text-ink-400'}`}>
          {m.title}
          {changed && <span className="ml-2 text-[11px] font-semibold text-amber-700">changed</span>}
        </p>
        <p className="mt-0.5 text-[12px] leading-snug text-ink-500">{m.description}</p>
      </div>
      <Switch checked={on} disabled={disabled} onChange={onChange} label={m.title} />
    </li>
  )
}

/**
 * A switch, not a checkbox — the state it carries is "on for this customer",
 * which is a setting rather than a selection. Still a real `button` with
 * `role="switch"`, so a screen reader announces it as one and the keyboard
 * reaches it without help.
 */
function Switch({ checked, onChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative mt-1 h-6 w-11 flex-none rounded-full transition-colors duration-200 ease-emil disabled:opacity-50 ${
        checked ? 'bg-brand-600' : 'bg-ink-200'
      }`}
    >
      <span
        className={`absolute top-0.5 grid h-5 w-5 place-items-center rounded-full bg-white shadow-clay-sm transition-transform duration-200 ease-emil ${
          checked ? 'translate-x-[22px]' : 'translate-x-0.5'
        }`}
      >
        {checked && <Check size={12} className="text-brand-700" />}
      </span>
    </button>
  )
}

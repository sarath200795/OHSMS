// ─────────────────────────────────────────────────────────────────────────────
// The Metabase connection form, in one place.
//
// It is rendered from two screens — Organization settings → Integrations, and
// the ODIN tab itself when nothing is connected yet — and that is the whole
// reason it lives here rather than on the settings page. Sending an admin who
// is standing in front of an empty dashboard away to another screen to type an
// API key, and then back again, is three navigations to do one thing; and a
// second copy of the form on the ODIN tab would be a second copy of the save
// logic, which is how the two drift into disagreeing about what "leave the key
// blank" means.
//
// ── One key, several instances ──────────────────────────────────────────────
//
// An organization rarely has exactly one Metabase: there is the group instance
// and the one the newly-acquired region still runs, or one per business the
// estate was assembled from. They are usually reached with the SAME API key,
// because a Metabase key belongs to the account rather than to the host.
//
// So the key is asked for ONCE, at the top, and each instance below it is just
// a URL and a pair of question IDs. An instance that genuinely needs its own
// key can be given one, and that is deliberately the fiddly path rather than
// the default — making every row carry a key field would ask most people to
// paste the same secret three times.
//
// The API key is WRITE-ONLY throughout. Nothing reads one back — the callable
// that reads the settings strips every key before answering (functions/lib/
// metabase.js redactConfig) — so this can say "a key is saved" and can never
// show it. Leaving a key box empty keeps what is stored; typing replaces it.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Plug, Save, KeyRound, CheckCircle2, XCircle, Plus, Trash2, Server } from 'lucide-react'
import { Card, Field, Input, Button } from '../ui'
import { saveIntegration } from '../org/integrations'
import { metabaseSettings, metabaseTestConnection } from '../functions'

const rid = () =>
  (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10))

const blankSource = () => ({ id: `src_${rid()}`, label: '', baseUrl: '', apiKey: '', hasKey: false, ownKey: false, findings: '', audits: '' })

/** The stored config as this form holds it. */
function toForm(config) {
  const sources = (config?.sources?.length ? config.sources : [null]).map((s) => (s ? {
    id: s.id,
    label: s.label || '',
    baseUrl: s.baseUrl || '',
    apiKey: '',                    // never populated — see the header
    hasKey: Boolean(s.hasKey),
    ownKey: Boolean(s.ownKey),
    findings: s.cards?.findings ? String(s.cards.findings) : '',
    audits: s.cards?.audits ? String(s.cards.audits) : '',
  } : blankSource()))
  return { apiKey: '', sources }
}

export default function MetabaseConnect({ orgId, actor, onSaved, compact = false }) {
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(null)   // what the server says is stored
  const [form, setForm] = useState(() => toForm(null))
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState('')  // the source id being tested
  const [results, setResults] = useState({})  // { [sourceId]: { ok, message } }
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let live = true
    setLoading(true)
    metabaseSettings()
      .then(({ config }) => {
        if (!live) return
        setSaved(config)
        setForm(toForm(config))
      })
      .catch((e) => {
        // A missing function deployment is the likeliest cause and surfaces as
        // an internal error, which sends an admin looking in the wrong place.
        if (live) setLoadError(`Could not read the saved settings: ${e?.message || e}`)
      })
      .finally(() => live && setLoading(false))
    return () => { live = false }
  }, [orgId])

  const setSource = (id, patch) =>
    setForm((f) => ({ ...f, sources: f.sources.map((s) => (s.id === id ? { ...s, ...patch } : s)) }))
  const addSource = () => setForm((f) => ({ ...f, sources: [...f.sources, blankSource()] }))
  const removeSource = (id) =>
    setForm((f) => {
      const next = f.sources.filter((s) => s.id !== id)
      // Never none. A form with no rows has nothing to type into.
      return { ...f, sources: next.length ? next : [blankSource()] }
    })

  const test = async (source) => {
    setTesting(source.id)
    setResults((r) => ({ ...r, [source.id]: null }))
    try {
      // The typed key when there is one, so a key can be verified BEFORE it is
      // saved; otherwise `sourceId` lets the server use the key this instance
      // would actually use. Nothing writes either — see metabaseTest.
      const out = await metabaseTestConnection({
        baseUrl: source.baseUrl,
        apiKey: source.apiKey || form.apiKey || undefined,
        sourceId: source.id,
      })
      setResults((r) => ({ ...r, [source.id]: out }))
    } catch (e) {
      setResults((r) => ({ ...r, [source.id]: { ok: false, message: e?.message || 'The connection test could not run.' } }))
    } finally {
      setTesting('')
    }
  }

  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const settings = {
        sources: form.sources.map((s) => ({
          id: s.id,
          label: s.label.trim(),
          baseUrl: s.baseUrl.trim(),
          cards: {
            findings: s.findings.trim() ? Number(s.findings.trim()) : null,
            audits: s.audits.trim() ? Number(s.audits.trim()) : null,
          },
          // Only when it was typed, and only for a source that is meant to have
          // one of its own. An empty box means "keep what is stored", not
          // "clear it" — the alternative is an admin who edits a question ID
          // and silently disconnects an instance.
          ...(s.apiKey.trim() ? { apiKey: s.apiKey.trim() } : s.ownKey ? { apiKey: '' } : {}),
        })),
        // The legacy top-level fields are cleared once a list is saved, so a
        // stale single-source URL cannot come back if `sources` is ever emptied.
        baseUrl: '',
        cards: { findings: null, audits: null },
      }
      if (form.apiKey.trim()) settings.apiKey = form.apiKey.trim()
      await saveIntegration(orgId, 'metabase', settings, actor)
      const { config } = await metabaseSettings()
      setSaved(config)
      setForm(toForm(config))
      toast.success('Metabase connection saved')
      onSaved?.(config)
    } catch (err) {
      toast.error(err?.message || 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  const clearKey = async () => {
    if (!window.confirm('Remove the shared API key? ODIN will stop loading from every instance that relies on it.')) return
    setBusy(true)
    try {
      await saveIntegration(orgId, 'metabase', { apiKey: '' }, actor)
      const { config } = await metabaseSettings()
      setSaved(config)
      setForm(toForm(config))
      toast.success('API key removed')
      onSaved?.(config)
    } catch (err) {
      toast.error(err?.message || 'Could not remove the key')
    } finally {
      setBusy(false)
    }
  }

  const many = form.sources.length > 1

  return (
    <Card as="form" onSubmit={save} className="text-left">
      <h3 className="flex items-center gap-2 font-semibold text-ink-800">
        <Plug size={17} className="text-brand-600" /> {compact ? 'Connect Metabase' : 'Metabase'}
      </h3>
      <p className="mb-4 mt-1 text-sm text-ink-500">
        {compact ? (
          <>
            Paste your Metabase API key and the ID of the saved question that lists your
            Safety &amp; Security findings. The key is stored server-side and never reaches
            anyone&apos;s browser — including yours, after this.
          </>
        ) : (
          <>
            ODIN reads your Safety &amp; Security issues straight out of Metabase and draws them on the
            map and charts in <b>Analytics → ODIN</b>. Everyone in your organization sees the dashboard;
            only administrators see this page, and the API key never reaches anyone&apos;s browser — the
            queries run on the server.
          </>
        )}
      </p>

      {loadError && (
        <p role="status" className="mb-4 rounded-2xl bg-amber-50 px-4 py-3 text-[12.5px] leading-relaxed text-amber-900">
          {loadError}
        </p>
      )}

      {/* The key, once. Asked for above the instances because that is the
          relationship: one credential, however many hosts it opens. */}
      <Field
        label="API key"
        htmlFor="mb-key"
        hint={
          saved?.hasKey
            ? 'A key is saved and used by every instance below unless one overrides it. Leave blank to keep it, or type a new one to replace it — it is never shown again.'
            : 'Create one in Metabase under Settings → Admin → Authentication → API keys, in a group that can read the questions below. The same key is used for every instance.'
        }
      >
        <Input
          id="mb-key"
          type="password"
          autoComplete="off"
          placeholder={saved?.hasKey ? '•••••••• (a key is saved)' : 'mb_…'}
          value={form.apiKey}
          onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
          disabled={loading}
        />
      </Field>

      <div className="mt-5 space-y-3">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-400">
          {many ? `Metabase instances (${form.sources.length})` : 'Metabase instance'}
        </p>
        {form.sources.map((s, i) => (
          <SourceRow
            key={s.id}
            source={s}
            index={i}
            many={many}
            loading={loading}
            testing={testing === s.id}
            result={results[s.id]}
            sharedKey={Boolean(form.apiKey.trim() || saved?.hasKey)}
            onChange={(patch) => setSource(s.id, patch)}
            onRemove={() => removeSource(s.id)}
            onTest={() => test(s)}
          />
        ))}
        <button
          type="button"
          onClick={addSource}
          className="inline-flex items-center gap-2 rounded-2xl bg-clay-surface px-3.5 py-2 text-[12.5px] font-semibold text-ink-700 shadow-clay-sm"
        >
          <Plus size={14} /> Add another instance
        </button>
        <p className="text-[11.5px] leading-relaxed text-ink-400">
          ODIN queries every instance that has a question for a dataset and merges the rows, so one
          dashboard covers the whole estate. Each figure remembers which instance it came from, and
          an instance that is down is named rather than silently dropped.
        </p>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-ink-100 pt-4">
        <Button type="submit" icon={Save} loading={busy} disabled={loading}>Save connection</Button>
        {saved?.hasKey && (
          <Button type="button" variant="ghost" disabled={busy || loading} onClick={clearKey}>
            Remove key
          </Button>
        )}
      </div>
    </Card>
  )
}

/**
 * One instance.
 *
 * The per-instance key is behind a checkbox rather than always on screen. Most
 * estates use one key for everything — that is the premise of the shared field
 * above — and a key box on every row invites pasting the same secret three
 * times, which is three chances to paste it wrong.
 */
function SourceRow({ source, index, many, loading, testing, result, sharedKey, onChange, onRemove, onTest }) {
  const [ownKey, setOwnKey] = useState(source.ownKey)

  return (
    <div className="rounded-2xl bg-clay-surface/60 p-4 shadow-clay-inset">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-[12.5px] font-bold text-ink-700">
          <Server size={14} className="text-ink-400" />
          {source.label.trim() || (many ? `Instance ${index + 1}` : 'Metabase')}
        </span>
        {many && (
          <button
            type="button"
            onClick={onRemove}
            title="Remove this instance"
            aria-label={`Remove instance ${index + 1}`}
            className="grid h-7 w-7 place-items-center rounded-lg text-ink-400 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr]">
          <Field label="Name" htmlFor={`mb-label-${source.id}`} hint="Shown beside figures from this instance.">
            <Input
              id={`mb-label-${source.id}`}
              placeholder="e.g. Group, or South region"
              value={source.label}
              onChange={(e) => onChange({ label: e.target.value })}
              disabled={loading}
            />
          </Field>
          <Field label="Metabase URL" htmlFor={`mb-url-${source.id}`} hint="Must be https and publicly resolvable.">
            <Input
              id={`mb-url-${source.id}`}
              placeholder="https://metabase.yourcompany.com"
              value={source.baseUrl}
              onChange={(e) => onChange({ baseUrl: e.target.value })}
              disabled={loading}
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Findings question ID" htmlFor={`mb-f-${source.id}`} hint="The saved question listing this instance’s issues.">
            <Input id={`mb-f-${source.id}`} inputMode="numeric" placeholder="e.g. 412" value={source.findings} onChange={(e) => onChange({ findings: e.target.value })} disabled={loading} />
          </Field>
          <Field label="Audits question ID" htmlFor={`mb-a-${source.id}`} hint="Optional — only if pass/fail data lives in a separate question.">
            <Input id={`mb-a-${source.id}`} inputMode="numeric" placeholder="e.g. 413" value={source.audits} onChange={(e) => onChange({ audits: e.target.value })} disabled={loading} />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-[12px] font-semibold text-ink-600">
          <input
            type="checkbox"
            checked={ownKey}
            onChange={(e) => {
              setOwnKey(e.target.checked)
              // Unticking clears the typed value AND records the intent, so the
              // save can remove a key this instance previously had of its own.
              if (!e.target.checked) onChange({ apiKey: '', ownKey: false })
              else onChange({ ownKey: true })
            }}
            disabled={loading}
          />
          This instance uses a different API key
        </label>

        {ownKey && (
          <Field
            label="API key for this instance"
            htmlFor={`mb-k-${source.id}`}
            hint={source.hasKey && source.ownKey ? 'A key is saved for this instance. Leave blank to keep it.' : undefined}
          >
            <Input
              id={`mb-k-${source.id}`}
              type="password"
              autoComplete="off"
              placeholder={source.hasKey && source.ownKey ? '•••••••• (a key is saved)' : 'mb_…'}
              value={source.apiKey}
              onChange={(e) => onChange({ apiKey: e.target.value })}
              disabled={loading}
            />
          </Field>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="soft"
            size="sm"
            icon={KeyRound}
            loading={testing}
            disabled={loading || !source.baseUrl.trim() || (!sharedKey && !source.apiKey.trim() && !source.hasKey)}
            onClick={onTest}
          >
            Test this instance
          </Button>
          {result && (
            <span
              role="status"
              className={`inline-flex items-start gap-1.5 text-[11.5px] leading-relaxed ${result.ok ? 'text-emerald-800' : 'text-amber-800'}`}
            >
              {result.ok
                ? <CheckCircle2 size={13} className="mt-0.5 flex-none" />
                : <XCircle size={13} className="mt-0.5 flex-none" />}
              {result.message}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

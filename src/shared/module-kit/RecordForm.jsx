import { useRef, useState } from 'react'
import { Paperclip, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { Field, Input, Textarea, Select } from '../ui'
import { fieldOptions, visibleFields } from './fields'

// Renders a form from a module's `fields` config. Supported types:
// text | textarea | number | date | select | email | file.
//
// `lookups` is whatever the module's `useLookups` hook returned — live reference
// data a field builds itself from, such as the site registry behind a Site
// dropdown. Fields with a `when` predicate only appear while it holds.
export default function RecordForm({ fields, value, onChange, lookups }) {
  const set = (key) => (e) => onChange({ ...value, [key]: e.target.value })

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {visibleFields(fields, value).map((f) => {
        const options = fieldOptions(f, value, lookups)
        const control =
          f.type === 'textarea' ? (
            <Textarea
              id={f.key}
              rows={f.rows || 3}
              required={f.required}
              value={value[f.key] ?? ''}
              onChange={set(f.key)}
              maxLength={f.maxLength || 2000}
              placeholder={f.placeholder}
            />
          ) : f.type === 'file' ? (
            <FileField field={f} value={value[f.key]} form={value} lookups={lookups}
              onChange={(v) => onChange({ ...value, [f.key]: v })} />
          ) : f.type === 'select' ? (
            <Select id={f.key} required={f.required} value={value[f.key] ?? ''} onChange={set(f.key)}>
              {/* A dropdown with nothing in it should say where the choices come
                  from, not leave "Select…" above an empty list. */}
              <option value="">
                {options.length ? f.placeholder || 'Select…' : f.empty || 'Nothing to choose from'}
              </option>
              {options.map((o) => (
                <option key={o.value ?? o} value={o.value ?? o}>
                  {o.label ?? o}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              id={f.key}
              type={f.type || 'text'}
              required={f.required}
              value={value[f.key] ?? ''}
              onChange={set(f.key)}
              maxLength={f.maxLength || 500}
              placeholder={f.placeholder}
              min={f.min}
              max={f.max}
            />
          )

        return (
          <div key={f.key} className={f.full || f.type === 'textarea' ? 'sm:col-span-2' : ''}>
            <Field label={f.label + (f.required ? ' *' : '')} htmlFor={f.key} hint={f.hint}>
              {control}
            </Field>
          </div>
        )
      })}
    </div>
  )
}

/**
 * A file on a record.
 *
 * The kit stays storage-agnostic: the FIELD declares how to store, via an
 * `upload(file, form, lookups)` that resolves to whatever should be saved (a
 * { url, path, name } object here). module-kit has no idea what a bucket is,
 * and a module that files by site can work its own path out from the form —
 * which is what the documents library does.
 *
 * The stored value is the upload RESULT, not the File. A half-finished pick
 * must never look like an attachment, so nothing is written until the upload
 * resolves, and a failure clears back to empty rather than leaving a filename
 * with nothing behind it.
 *
 * ── `defer` ──────────────────────────────────────────────────────────────────
 *
 * A field may instead set `defer: true`, which keeps the raw File in the form
 * and uploads NOTHING here — the module does it inside its own save, and the
 * value it receives is a File rather than an upload result.
 *
 * Why that exists: uploading on pick puts bytes in the bucket before there is
 * any record pointing at them, and every path that ends without a save — a
 * validation error, an expired session, a closed dialog — strands them. Storage
 * rules forbid clients deleting, so nothing can tidy up afterwards. Deferring
 * shrinks that window from "however long the form is open" to the moment
 * between the upload resolving and the write.
 *
 * Opt-in, because it is a real trade: the wait moves from filling the form to
 * pressing Save, which is the slower-feeling half. Modules that do not set it
 * behave exactly as before.
 */
function FileField({ field, value, form, lookups, onChange }) {
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)

  const pick = async (file) => {
    if (!file) return
    if (field.maxBytes && file.size > field.maxBytes) {
      toast.error(`That file is too large (max ${Math.round(field.maxBytes / 1024 / 1024)} MB)`)
      if (inputRef.current) inputRef.current.value = ''
      return
    }
    // Deferred: hold the File and let the module store it at save time. Nothing
    // reaches the bucket here, so abandoning the form leaves nothing behind.
    if (field.defer) {
      onChange(file)
      if (inputRef.current) inputRef.current.value = ''
      return
    }
    setBusy(true)
    try {
      const stored = await field.upload?.(file, form, lookups)
      if (!stored) throw new Error('Upload failed — the file was not saved')
      onChange(stored)
    } catch (e) {
      toast.error(e?.message || 'Upload failed')
      onChange(null)
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  if (busy) {
    return <p className="rounded-xl bg-clay-surface px-3 py-2.5 text-sm text-ink-500 shadow-clay-inset">Uploading…</p>
  }

  // Either an upload result ({url, name}) or, when deferred, the File itself —
  // both carry a name, and both mean "something is attached".
  if (value?.url || value?.name) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-clay-surface px-3 py-2 shadow-clay-inset">
        <Paperclip size={15} className="flex-none text-ink-400" />
        <span className="truncate text-sm text-ink-700">{value.name || 'Attached file'}</span>
        {/* Nothing is stored yet, and saying so is what stops someone closing
            the dialog believing the file is safe. */}
        {!value.url && <span className="flex-none text-xs font-semibold text-ink-400">saved on submit</span>}
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label="Remove the attached file"
          className="ml-auto flex-none rounded-lg p-1 text-ink-400 transition hover:bg-red-50 hover:text-red-600"
        >
          <X size={15} />
        </button>
      </div>
    )
  }

  return (
    <input
      ref={inputRef}
      id={field.key}
      type="file"
      accept={field.accept}
      required={field.required}
      onChange={(e) => pick(e.target.files?.[0])}
      className="block w-full text-sm text-ink-600 file:mr-3 file:rounded-xl file:border-0 file:bg-clay-surface file:px-3 file:py-2 file:text-sm file:font-semibold file:text-ink-700 file:shadow-clay-sm"
    />
  )
}

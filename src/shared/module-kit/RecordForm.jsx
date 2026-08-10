import { Field, Input, Textarea, Select } from '../ui'
import { fieldOptions, visibleFields } from './fields'

// Renders a form from a module's `fields` config. Supported types:
// text | textarea | number | date | select | email.
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
              placeholder={f.placeholder}
            />
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

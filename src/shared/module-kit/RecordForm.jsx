import { Field, Input, Textarea, Select } from '../ui'

// Renders a form from a module's `fields` config. Supported types:
// text | textarea | number | date | select | email.
export default function RecordForm({ fields, value, onChange }) {
  const set = (key) => (e) => onChange({ ...value, [key]: e.target.value })

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {fields.map((f) => {
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
              <option value="">{f.placeholder || 'Select…'}</option>
              {f.options.map((o) => (
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

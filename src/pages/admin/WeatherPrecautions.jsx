import { CloudRain } from 'lucide-react'
import { Button, Card, Field, Textarea } from '../../shared/ui'
import { ALERTS, builtInPrecaution, editorRows } from '../../shared/weather/activityPrecautions'

const PRIMARY = ALERTS.filter((alert) => alert.key === 'heat' || alert.key === 'rain')
const ADVERSE = ALERTS.filter((alert) => alert.key !== 'heat' && alert.key !== 'rain')

function slug(value) {
  const text = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
  return text || 'activity'
}

function setLine(value, label, alertKey, text) {
  const prev = value?.[label] && typeof value[label] === 'object' ? value[label] : {}
  const nextRow = { ...prev }
  if (String(text || '').trim()) nextRow[alertKey] = text
  else delete nextRow[alertKey]
  const next = { ...(value || {}) }
  if (Object.keys(nextRow).length) next[label] = nextRow
  else delete next[label]
  return next
}

function AlertFields({ row, alerts, value, onChange }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {alerts.map((alert) => {
        const id = `wx-${slug(row.label)}-${alert.key}`
        const builtIn = row.entry ? builtInPrecaution(row.label, alert.key) : ''
        return (
          <Field
            key={alert.key}
            label={`${row.label} — ${alert.label}`}
            htmlFor={id}
            hint={
              builtIn
                ? 'Blank uses the built-in wording.'
                : 'Blank skips this activity for this alert.'
            }
          >
            <Textarea
              id={id}
              rows={3}
              maxLength={500}
              value={value?.[row.label]?.[alert.key] || ''}
              placeholder={builtIn || 'No built-in wording for this alert.'}
              onChange={(e) => onChange(setLine(value, row.label, alert.key, e.target.value))}
            />
          </Field>
        )
      })}
    </div>
  )
}

function ActivityBlock({ row, value, onChange }) {
  const edited = value?.[row.label] && Object.keys(value[row.label]).length > 0
  return (
    <details className="rounded-xl border border-surface-200 bg-surface-50 px-3 py-2">
      <summary className="cursor-pointer py-1 text-sm font-semibold text-ink-800">
        {row.label}
        {row.selected ? '' : ' — used when a site records this work'}
      </summary>
      <div className="mt-3 space-y-3 pb-2">
        <AlertFields row={row} alerts={PRIMARY} value={value} onChange={onChange} />
        <details className="rounded-lg border border-surface-200 bg-white px-3 py-2">
          <summary className="cursor-pointer py-1 text-sm font-semibold text-ink-700">
            {row.label} — adverse weather
          </summary>
          <div className="mt-3">
            <AlertFields row={row} alerts={ADVERSE} value={value} onChange={onChange} />
          </div>
        </details>
        {edited && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              const next = { ...(value || {}) }
              delete next[row.label]
              onChange(next)
            }}
          >
            {`Use built-in wording for ${row.label}`}
          </Button>
        )}
      </div>
    </details>
  )
}

export default function WeatherPrecautions({ activityTypes, value, onChange }) {
  const { selected, extra } = editorRows(activityTypes)
  return (
    <Card>
      <h3 className="flex items-center gap-2 font-semibold text-ink-800">
        <CloudRain size={17} className="text-brand-600" /> Weather digest precautions
      </h3>
      <p className="mb-3 mt-1 text-sm text-ink-500">
        The six-hour weather mail fills the precautions cell from the activities selected above.
        Heat stress, rain and each adverse-weather alert can say something different for outdoor
        work, work at height, hot work, kitchens, gyms, deliveries and electrical work. A site with
        its own record — a site type, a HIRA activity or a permit type — uses that work for its
        rows. Leave a box blank to keep the built-in sentence. With no activity selected, and
        nothing recorded at the site, the mail keeps the general precautions.
      </p>
      {selected.length === 0 && (
        <p className="mb-3 text-sm text-ink-600">
          No activities selected yet. The digest will use the general precautions until you select
          some above, or until a site has a matching permit, HIRA activity or site type.
        </p>
      )}
      <div className="space-y-2">
        {selected.map((row) => (
          <ActivityBlock key={row.label} row={row} value={value} onChange={onChange} />
        ))}
        {extra.length > 0 && (
          <details className="rounded-xl border border-surface-200 px-3 py-2">
            <summary className="cursor-pointer py-1 text-sm font-semibold text-ink-800">
              Work a site may record on its own
            </summary>
            <p className="mb-2 mt-2 text-sm text-ink-500">
              These are not selected for the whole organisation. Edit them to change the sentence a
              site gets when a permit, a hazard assessment or a site type names that work.
            </p>
            <div className="space-y-2">
              {extra.map((row) => (
                <ActivityBlock key={row.label} row={row} value={value} onChange={onChange} />
              ))}
            </div>
          </details>
        )}
      </div>
    </Card>
  )
}

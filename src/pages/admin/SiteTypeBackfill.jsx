import { useState } from 'react'
import { Plus, Tags, X } from 'lucide-react'
import { Button, Card, Field, IconButton, Input, Select } from '../../shared/ui'
import {
  CULT_OWNERSHIP_SITE_TYPES,
  planSiteTypeBackfill,
  siteTypeOptions,
} from '../../shared/weather/activityPrecautions'

function samePlan(a, b) {
  return JSON.stringify(a?.updates || []) === JSON.stringify(b?.updates || [])
}

/**
 * Editor for the org's entity → site type map, plus a dry run that counts
 * how many empty site types that map would fill. Apply is the parent's
 * write. Loading the ownership-model default only fills this list.
 */
export default function SiteTypeBackfill({ rows, onChange, activityTypes, sites, busy, onApply }) {
  const [preview, setPreview] = useState(null)
  const options = siteTypeOptions(activityTypes)
  const known = new Set([...options.general, ...options.extra])
  const list = rows || []

  const edit = (index, patch) => {
    onChange(list.map((row, i) => (i === index ? { ...row, ...patch } : row)))
    setPreview(null)
  }
  const remove = (index) => {
    onChange(list.filter((_, i) => i !== index))
    setPreview(null)
  }
  const add = () => {
    onChange([...list, { entity: '', siteType: '' }])
    setPreview(null)
  }
  const loadDefault = () => {
    onChange(CULT_OWNERSHIP_SITE_TYPES.map((row) => ({ ...row })))
    setPreview(null)
  }

  const runPreview = () => setPreview(planSiteTypeBackfill(sites, list, activityTypes))

  const apply = () => {
    const plan = planSiteTypeBackfill(sites, list, activityTypes)
    if (!samePlan(plan, preview)) {
      setPreview(plan)
      return
    }
    if (!plan.counts.wouldUpdate) return
    // Drop the preview so a second click waits for a fresh count. The first
    // write is idempotent either way; this stops it being fired twice while
    // the site list is still catching up.
    setPreview(null)
    onApply(plan)
  }

  const previewStale =
    preview && !samePlan(preview, planSiteTypeBackfill(sites, list, activityTypes))

  return (
    <Card>
      <h3 className="flex items-center gap-2 font-semibold text-ink-800">
        <Tags size={17} className="text-brand-600" /> Fill empty site types from entity
      </h3>
      <p className="mb-3 mt-1 text-sm text-ink-500">
        Match the entity name to a site type, and write that type only where the site does not have
        one yet. The match ignores case, spaces and punctuation, so Market Place and Marketplace are
        the same name. It compares the whole name, so a company name that happens to contain a code
        stays unmatched. A second apply updates nothing. Saving the page stores this list. Preview
        counts the sites; Apply writes them.
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        <Button type="button" variant="soft" onClick={loadDefault} disabled={busy}>
          Load ownership-model default
        </Button>
        <Button type="button" variant="soft" icon={Plus} onClick={add} disabled={busy}>
          Add row
        </Button>
      </div>
      <p className="mb-3 text-sm text-ink-500">
        The default is FOFO, FOCO, COCO and Marketplace to Indoor gym, EBO to Retail store, and D2C
        to Warehouse. Loading it only fills the list.
      </p>
      {list.length === 0 && (
        <p className="text-sm text-ink-500">
          No entity mapping yet. Load the default or add a row.
        </p>
      )}
      <div className="space-y-3">
        {list.map((row, index) => (
          <div key={index} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <Field label="Entity" htmlFor={`entity-map-${index}`}>
              <Input
                id={`entity-map-${index}`}
                value={row.entity}
                placeholder="e.g. COCO"
                onChange={(e) => edit(index, { entity: e.target.value })}
              />
            </Field>
            <Field label="Site type" htmlFor={`type-map-${index}`}>
              <Select
                id={`type-map-${index}`}
                value={row.siteType}
                onChange={(e) => edit(index, { siteType: e.target.value })}
              >
                <option value="">Select a site type</option>
                {row.siteType && !known.has(row.siteType) && (
                  <option value={row.siteType}>{row.siteType}</option>
                )}
                <optgroup label="General">
                  {options.general.map((label) => (
                    <option key={label} value={label}>
                      {label}
                    </option>
                  ))}
                </optgroup>
                {options.extra.length > 0 && (
                  <optgroup label="This organisation">
                    {options.extra.map((label) => (
                      <option key={label} value={label}>
                        {label}
                      </option>
                    ))}
                  </optgroup>
                )}
              </Select>
            </Field>
            <IconButton
              icon={X}
              label={`Remove ${row.entity || 'row'} mapping`}
              onClick={() => remove(index)}
              disabled={busy}
            />
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="soft"
          onClick={runPreview}
          disabled={busy || list.length === 0}
        >
          Preview
        </Button>
        <Button
          type="button"
          onClick={apply}
          disabled={busy || !preview || previewStale || preview.counts.wouldUpdate === 0}
          loading={busy}
        >
          Apply to empty sites
        </Button>
      </div>
      {preview && (
        <div className="mt-3 space-y-2 rounded-2xl bg-surface-50 p-3 text-sm text-ink-700">
          {previewStale && <p>The list or the sites changed. Preview again before applying.</p>}
          <p>
            Would fill: {preview.counts.wouldUpdate}. Already have a type:{' '}
            {preview.counts.alreadySet}. Entity not in this map: {preview.counts.unmatched}. No
            entity: {preview.counts.emptyEntity}.
          </p>
          {preview.byEntity.length > 0 && (
            <ul className="list-disc pl-5">
              {preview.byEntity.map((row) => (
                <li key={row.entity}>
                  {row.entity} → {row.siteType} ({row.count})
                </li>
              ))}
            </ul>
          )}
          {preview.unmatchedEntities.length > 0 && (
            <p>
              Not in the map:{' '}
              {preview.unmatchedEntities.map((row) => `${row.entity} (${row.count})`).join(', ')}.
            </p>
          )}
          {preview.dropped.length > 0 && (
            <p>
              Repeated once case and spaces are ignored, so only the first row is used:{' '}
              {preview.dropped.join(', ')}.
            </p>
          )}
        </div>
      )}
    </Card>
  )
}

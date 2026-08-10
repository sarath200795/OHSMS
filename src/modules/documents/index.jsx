import { useMemo } from 'react'
import ModulePage from '../../shared/module-kit/ModulePage'
import { createModuleService } from '../../shared/module-kit/service'
import { MODULE_BY_KEY } from '../../shared/modules/registry'
import { Badge } from '../../shared/ui'
import { formatDate, isOverdue } from '../../shared/lib/format'
import { useAccessibleSites, useSiteFacets } from '../../shared/org/useAccessibleSites'
import {
  REGION, SITE, LEVEL_OPTIONS,
  classificationFields, levelFilterOptions, levelSummary, matches, scopeOf,
} from './lib/classification'

const module = MODULE_BY_KEY.documents

const TYPE_TONE = { Policy: 'brand', SOP: 'blue', SDS: 'amber', Form: 'gray' }

/**
 * The site registry, which is also where the region list comes from: regions are
 * whatever this org's sites say they are. A fixed list would be wrong for every
 * org that does not happen to be shaped like the one it was written for.
 */
function useSiteRegistry() {
  const sites = useAccessibleSites()
  const { regions } = useSiteFacets(sites)
  return useMemo(() => ({ sites, regions }), [sites, regions])
}

function LevelBadge({ doc, sites }) {
  const { tone, label } = levelSummary(doc, sites)
  return <Badge tone={tone}>{label}</Badge>
}

// The badge alone answers "how wide is this?"; the scope beside it answers
// "is it mine?", which is the question someone scanning the library is asking.
// Org level names nothing, so nothing is shown rather than a dash for a value
// that was never meant to exist.
function LevelCell({ doc, sites }) {
  const { level, scope } = levelSummary(doc, sites)
  return (
    <span className="flex flex-wrap items-center gap-2">
      <LevelBadge doc={doc} sites={sites} />
      {(level === REGION || level === SITE) && <span>{scope || '—'}</span>}
    </span>
  )
}

const config = {
  singular: 'Document',
  plural: 'Documents',
  subtitle: 'Versioned policies, SOPs, forms and Safety Data Sheets (SDS)',
  titleField: 'title',
  service: createModuleService('documents', 'documents'),
  useLookups: useSiteRegistry,
  defaultStatus: 'draft',
  statuses: [
    { value: 'draft', label: 'Draft', tone: 'gray' },
    { value: 'active', label: 'Active', tone: 'green' },
    { value: 'under_review', label: 'Under review', tone: 'amber' },
    { value: 'archived', label: 'Archived', tone: 'gray' },
  ],
  filters: [
    {
      key: 'level',
      label: 'Level',
      options: (lookups, records) => levelFilterOptions(records),
      match: (r, value) => matches(r, value),
    },
    {
      // Only meaningful once a level that names something is chosen.
      key: 'scope',
      label: (facets) => (facets.level === REGION ? 'Region' : 'Site'),
      when: (facets) => facets.level === REGION || facets.level === SITE,
      options: (lookups, records, facets) =>
        facets.level === REGION
          ? [{ value: '', label: 'Every region' }, ...lookups.regions.map((r) => ({ value: r, label: r }))]
          : [{ value: '', label: 'Every site' }, ...lookups.sites.map((s) => ({ value: s.id, label: s.name }))],
      match: (r, value, facets) => matches(r, facets.level, value),
    },
  ],
  columns: [
    { key: 'title', label: 'Document' },
    { key: 'docType', label: 'Type', render: (r) => <Badge tone={TYPE_TONE[r.docType] || 'gray'}>{r.docType || '—'}</Badge> },
    { key: 'level', label: 'Level', render: (r, lookups) => <LevelCell doc={r} sites={lookups.sites} /> },
    { key: 'version', label: 'Ver.' },
    { key: 'reviewDate', label: 'Review due', render: (r) => (
      <span className={isOverdue(r.reviewDate) ? 'font-semibold text-red-600' : ''}>{formatDate(r.reviewDate)}</span>
    ) },
  ],
  fields: [
    { key: 'title', label: 'Document title', full: true, required: true },
    { key: 'docType', label: 'Type', type: 'select', required: true, options: ['Policy', 'SOP', 'SDS', 'Form'] },
    {
      key: 'level',
      label: 'Level',
      type: 'select',
      required: true,
      options: LEVEL_OPTIONS,
      placeholder: 'Where does this apply?',
      hint: 'Organization applies everywhere; Region and Site decide who it is relevant to',
      // A document with no level is not blank, it is unclassified — and the
      // detail view is where someone lands before deciding to fix it.
      detail: (r, lookups) => <LevelBadge doc={r} sites={lookups.sites} />,
    },
    // Naming the region / site is the whole point of choosing that level, so it
    // is required — but only while the level asks for it, or the browser would
    // block a save on a field nobody can see.
    {
      key: 'region',
      label: 'Region',
      type: 'select',
      required: true,
      when: (v) => v.level === REGION,
      options: (v, lookups) => lookups.regions,
      empty: 'No regions yet — set one on a site first',
    },
    {
      key: 'siteId',
      label: 'Site',
      type: 'select',
      required: true,
      when: (v) => v.level === SITE,
      options: (v, lookups) => lookups.sites.map((s) => ({ value: s.id, label: s.name })),
      empty: 'No sites you can access',
      // Never the raw id: a site that has left the registry still has the name
      // it was filed under stored on the document.
      detail: (r, lookups) => scopeOf(r, lookups.sites) || '—',
    },
    { key: 'version', label: 'Version', placeholder: 'e.g. 1.0' },
    { key: 'owner', label: 'Owner' },
    { key: 'reference', label: 'Reference no.' },
    { key: 'effectiveDate', label: 'Effective date', type: 'date' },
    { key: 'reviewDate', label: 'Next review date', type: 'date', hint: 'Overdue reviews are flagged' },
    { key: 'summary', label: 'Summary / notes', type: 'textarea', full: true, rows: 3 },
  ],
  compute: (form, lookups) => classificationFields(form, lookups.sites),
}

export default function DocumentsModule() {
  return <ModulePage module={module} config={config} />
}

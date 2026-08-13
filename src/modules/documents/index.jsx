import { useMemo } from 'react'
import { ExternalLink, Paperclip, Folder as FolderIcon } from 'lucide-react'
import { useAuth } from '../../shared/auth/AuthContext'
import { putFile, MAX_UPLOAD_BYTES } from '../../shared/storage'
import { safeHref } from '../../shared/safeUrl'
import ModulePage from '../../shared/module-kit/ModulePage'
import { documentsService } from './lib/service'
import { MODULE_BY_KEY } from '../../shared/modules/registry'
import { Badge } from '../../shared/ui'
import { formatDate, isOverdue } from '../../shared/lib/format'
import { useAccessibleSites, useSiteFacets } from '../../shared/org/useAccessibleSites'
import {
  ORG, REGION, SITE, LEVEL_OPTIONS,
  classificationFields, levelFilterOptions, levelSummary, matches, scopeOf,
} from './lib/classification'
import {
  DOC_TYPES, docTypeTone, docTypeLabel, SOURCE_OPTIONS, SOURCE_UPLOAD, SOURCE_LINK,
  isSafeDocumentUrl, documentHref, documentLabel, documentFolder, siteFolders,
} from './lib/docTypes'

const module = MODULE_BY_KEY.documents



/**
 * The site registry, which is also where the region list comes from: regions are
 * whatever this org's sites say they are. A fixed list would be wrong for every
 * org that does not happen to be shaped like the one it was written for.
 */
function useSiteRegistry() {
  const sites = useAccessibleSites()
  const { regions } = useSiteFacets(sites)
  // orgId rides along so the file field can work out its own storage path —
  // module-kit knows nothing about buckets, and the folder a document belongs
  // in is decided by the form, not by the kit.
  const { orgId } = useAuth()
  return useMemo(() => ({ sites, regions, orgId }), [sites, regions, orgId])
}

/**
 * The one control that answers "where is the actual document".
 *
 * A library whose records carry a title, a version and a review date but no way
 * to open the thing they describe is an index of documents nobody can read.
 * Rendered as a link only when there is something safe to open — a stored
 * javascript: URL must not become clickable just because it reached the record.
 */
function OpenCell({ doc }) {
  const href = documentHref(doc)
  if (!href) return <span className="text-ink-400">—</span>
  const Icon = doc.source === SOURCE_LINK ? ExternalLink : Paperclip
  return (
    <a
      href={safeHref(href)}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1.5 font-semibold text-brand-600 hover:underline"
      title={documentLabel(doc) || 'Open the document'}
    >
      <Icon size={13} /> Open
    </a>
  )
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

/**
 * A folder for every site, and one for everything that is not filed to a site.
 *
 * Not a second filter mechanism — clicking a folder sets exactly the facets the
 * dropdowns set, so the two can never disagree about what is on screen.
 *
 * The empty folders are the useful half. A site with nothing filed against it
 * reads as "0", which is the finding an audit is looking for; a view assembled
 * only from documents that exist can never show an absence.
 */
function Folders({ records, lookups, facets, setFacet }) {
  const { folders, orgWide } = siteFolders(lookups.sites, records)
  if (!folders.length) return null

  const openSite = facets.level === SITE ? facets.scope : null
  const openOrg = facets.level === ORG
  const pick = (level, scope) => {
    setFacet('level', level)
    setFacet('scope', scope)
  }

  const tile = (key, name, count, active, onClick) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex min-w-[150px] flex-1 items-center gap-2 rounded-2xl px-3 py-2.5 text-left transition ${
        active ? 'bg-brand-600 text-white shadow-clay-sm' : 'bg-clay-surface text-ink-700 shadow-clay-sm hover:bg-clay-100'
      }`}
    >
      <FolderIcon size={16} className="flex-none opacity-70" />
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</span>
      <span className={`flex-none text-xs font-bold ${active ? 'text-white/80' : count ? 'text-ink-500' : 'text-ink-300'}`}>
        {count}
      </span>
    </button>
  )

  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-widest text-ink-400">Folders</p>
        {(facets.level || facets.scope) && (
          <button type="button" className="text-xs font-semibold text-brand-600 hover:underline"
            onClick={() => pick('', '')}>
            Show all
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {tile('org', 'Organization-wide', orgWide, openOrg, () => pick(openOrg ? '' : ORG, ''))}
        {folders.map((f) =>
          tile(f.id, f.name, f.count, openSite === f.id, () =>
            (openSite === f.id ? pick('', '') : pick(SITE, f.id))))}
      </div>
    </div>
  )
}

const config = {
  singular: 'Document',
  plural: 'Documents',
  subtitle: 'Versioned policies, SOPs, forms and Safety Data Sheets (SDS)',
  titleField: 'title',
  service: documentsService,
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
    { key: 'docType', label: 'Type', render: (r) => <Badge tone={docTypeTone(r.docType)}>{r.docType || '—'}</Badge> },
    { key: 'open', label: 'Document', render: (r) => <OpenCell doc={r} /> },
    { key: 'level', label: 'Level', render: (r, lookups) => <LevelCell doc={r} sites={lookups.sites} /> },
    { key: 'version', label: 'Ver.' },
    { key: 'reviewDate', label: 'Review due', render: (r) => (
      <span className={isOverdue(r.reviewDate) ? 'font-semibold text-red-600' : ''}>{formatDate(r.reviewDate)}</span>
    ) },
  ],
  fields: [
    { key: 'title', label: 'Document title', full: true, required: true },
    { key: 'docType', label: 'Type', type: 'select', required: true, options: DOC_TYPES,
      detail: (r) => docTypeLabel(r.docType) },
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
    // Declared AFTER level/site, because the folder a file is stored in is
    // worked out from the site chosen above.
    {
      key: 'source',
      label: 'The document itself',
      type: 'select',
      required: true,
      options: SOURCE_OPTIONS,
      placeholder: 'Upload it, or link to it',
      hint: 'Upload a copy into this site’s folder, or point at where it already lives',
    },
    {
      key: 'file',
      label: 'File',
      type: 'file',
      full: true,
      when: (v) => v.source === SOURCE_UPLOAD,
      maxBytes: MAX_UPLOAD_BYTES,
      // Filed into the folder belonging to this document's site. documentFolder
      // reads the form, so choosing a different site before uploading files it
      // in the right place without the kit knowing any of that.
      upload: (file, form, lookups) => putFile(lookups.orgId, documentFolder(form), file, file.name),
      detail: (r) => <OpenCell doc={r} />,
    },
    {
      key: 'linkUrl',
      label: 'Link',
      full: true,
      when: (v) => v.source === SOURCE_LINK,
      placeholder: 'https://…',
      hint: 'An http or https address — anything else is refused on save',
      detail: (r) => <OpenCell doc={r} />,
    },
    { key: 'version', label: 'Version', placeholder: 'e.g. 1.0' },
    { key: 'owner', label: 'Owner' },
    { key: 'reference', label: 'Reference no.' },
    { key: 'effectiveDate', label: 'Effective date', type: 'date' },
    { key: 'reviewDate', label: 'Next review date', type: 'date', hint: 'Overdue reviews are flagged' },
    { key: 'summary', label: 'Summary / notes', type: 'textarea', full: true, rows: 3 },
  ],
  // compute runs inside the save, so throwing here refuses the write and shows
  // the reason — the only validation seam the kit offers, and the right one:
  // this has to hold whether the value came from the form or from a paste.
  aside: (ctx) => <Folders {...ctx} />,
  compute: (form, lookups) => {
    if (form.source === SOURCE_LINK && !isSafeDocumentUrl(form.linkUrl)) {
      // Checked on the way IN as well as on render. A javascript: or data: URL
      // stored by one member and clicked by another is stored XSS with an
      // audience, and a library is a place people click things.
      throw new Error('The link must be an http or https address')
    }
    if (form.source === SOURCE_UPLOAD && !form.file?.url) {
      throw new Error('Attach the file, or switch to a link')
    }
    return {
      ...classificationFields(form, lookups.sites),
      // Recorded on the document so the folder it was filed under survives a
      // later change of site — the file does not move, and a record claiming a
      // folder its file is not in is worse than one that says where it went.
      folder: documentFolder(form),
    }
  },
}

export default function DocumentsModule() {
  return <ModulePage module={module} config={config} />
}

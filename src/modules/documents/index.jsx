import { useMemo, useState } from 'react'
import { ExternalLink, Paperclip, Folder as FolderIcon, FolderOpen, Plus, ChevronLeft } from 'lucide-react'
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
  REGION, SITE, LEVEL_OPTIONS,
  classificationFields, levelFilterOptions, levelSummary, matches, scopeOf,
} from './lib/classification'
import {
  DOC_TYPES, docTypeTone, docTypeLabel, SOURCE_OPTIONS, SOURCE_UPLOAD, SOURCE_LINK,
  isSafeDocumentUrl, documentHref, documentLabel, documentFolder, siteFolders, matchesScope,
} from './lib/docTypes'

const module = MODULE_BY_KEY.documents



/**
 * The site registry, which is also where the region list comes from: regions are
 * whatever this org's sites say they are. A fixed list would be wrong for every
 * org that does not happen to be shaped like the one it was written for.
 */
function useSiteRegistry() {
  const sites = useAccessibleSites()
  const { regions, entities } = useSiteFacets(sites)
  // orgId rides along so the file field can work out its own storage path —
  // module-kit knows nothing about buckets, and the folder a document belongs
  // in is decided by the form, not by the kit.
  const { orgId } = useAuth()
  return useMemo(() => ({ sites, regions, entities, orgId }), [sites, regions, entities, orgId])
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
 *
 * A list rather than tiles, capped so a hundred-site org does not push the
 * library itself below the fold.
 */
const PAGE = 20

function Folders({ records, lookups, facets, setFacet, openNew }) {
  const [shown, setShown] = useState(PAGE)
  const { folders, orgWide } = siteFolders(lookups.sites, records)
  if (!folders.length) return null

  const visible = folders.slice(0, shown)
  const openSite = facets.siteId || ''

  // Inside a folder the list of every other folder is in the way — the table
  // below is now the contents, so this collapses to a way back out and a way to
  // add here. The same shape a file manager uses, for the same reason.
  if (openSite) {
    const here = folders.find((f) => f.id === openSite)
    return (
      <div className="card mb-4 flex flex-wrap items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setFacet('siteId', '')}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline"
        >
          <ChevronLeft size={15} /> All folders
        </button>
        <span className="text-ink-300">/</span>
        <FolderOpen size={15} className="text-ink-400" />
        <span className="text-sm font-bold text-ink-900">{here?.name || 'Folder'}</span>
        <span className="text-xs font-semibold text-ink-400">
          {here?.count ?? 0} document{(here?.count ?? 0) === 1 ? '' : 's'}
        </span>
        <button
          type="button"
          onClick={() => openNew({ level: SITE, siteId: openSite, source: SOURCE_UPLOAD })}
          className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-3 py-1.5 text-xs font-bold text-white transition hover:brightness-95"
        >
          <Plus size={14} /> Add here
        </button>
      </div>
    )
  }

  const Row = ({ name, count, active, onOpen, onAdd }) => (
    <li className={`flex items-center gap-2 border-b border-ink-100 last:border-0 ${active ? 'bg-brand-50' : ''}`}>
      <button
        type="button"
        onClick={onOpen}
        aria-pressed={active}
        className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-left transition hover:bg-clay-100"
      >
        <FolderIcon size={15} className={`flex-none ${active ? 'text-brand-600' : 'text-ink-400'}`} />
        <span className={`min-w-0 flex-1 truncate text-sm ${active ? 'font-bold text-brand-700' : 'font-semibold text-ink-700'}`}>
          {name}
        </span>
        {/* A folder holding nothing is the finding, so the zero is shown and
            greyed rather than hidden. */}
        <span className={`flex-none text-xs font-bold ${count ? 'text-ink-500' : 'text-ink-300'}`}>
          {count}
        </span>
      </button>
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          title={`Add a document to ${name}`}
          aria-label={`Add a document to ${name}`}
          className="mr-2 flex-none rounded-lg p-1.5 text-ink-400 transition hover:bg-brand-50 hover:text-brand-600"
        >
          <Plus size={15} />
        </button>
      )}
    </li>
  )

  return (
    <div className="card mb-4 overflow-hidden p-0">
      {/* No "show all" here — reaching this point means no folder is open,
          because the breadcrumb above returns early when one is. */}
      <div className="px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-ink-400">
          Folders <span className="text-ink-300">({folders.length} sites)</span>
        </p>
      </div>

      <ul className="max-h-[22rem] overflow-y-auto border-t border-ink-100">
        {/* Everything not filed to a site. No add button: "organization-wide"
            is a level someone chooses deliberately, not a folder to drop into. */}
        <Row name="Organization-wide" count={orgWide} active={false}
          onOpen={() => setFacet('siteId', '')} />
        {visible.map((f) => (
          <Row
            key={f.id}
            name={f.name}
            count={f.count}
            active={openSite === f.id}
            onOpen={() => setFacet('siteId', openSite === f.id ? '' : f.id)}
            // Opens the form already filed to this folder — nobody should have
            // to re-pick the site they just clicked.
            onAdd={() => openNew({ level: SITE, siteId: f.id, source: SOURCE_UPLOAD })}
          />
        ))}
      </ul>

      {folders.length > shown && (
        <button
          type="button"
          onClick={() => setShown((n) => n + PAGE)}
          className="w-full border-t border-ink-100 px-3 py-2 text-xs font-semibold text-brand-600 transition hover:bg-clay-100"
        >
          Show {Math.min(PAGE, folders.length - shown)} more of {folders.length}
        </button>
      )}
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
  // Region / Entity / Site, each standing on its own rather than the old
  // level-then-scope pair. Someone looking for a site's fire drawings should
  // not have to know they must pick "Site" before a site list appears.
  //
  // All three read the snapshot on the document (siteRegion / siteEntity),
  // which is what firestore.rules reads to decide who may see the row — so the
  // filter and the rule cannot disagree about which region a document is in.
  // matchesScope receives the whole facet set, so only one of the three needs
  // to do the work; the other two match everything and let it decide.
  filters: [
    {
      key: 'region',
      label: 'Region',
      options: (lookups) => [
        { value: '', label: 'Every region' },
        ...lookups.regions.map((r) => ({ value: r, label: r })),
      ],
      match: (r, value, facets) => matchesScope(r, facets),
    },
    {
      key: 'entity',
      label: 'Entity',
      options: (lookups) => [
        { value: '', label: 'Every entity' },
        ...(lookups.entities || []).map((e) => ({ value: e, label: e })),
      ],
      match: () => true,
    },
    {
      key: 'siteId',
      label: 'Site',
      options: (lookups) => [
        { value: '', label: 'Every site' },
        ...lookups.sites.map((s) => ({ value: s.id, label: s.name })),
      ],
      match: () => true,
    },
    {
      key: 'level',
      label: 'Level',
      options: (lookups, records) => levelFilterOptions(records),
      match: (r, value) => matches(r, value),
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

  // In a folder, a file opens. Returning false hands the click back to the
  // detail view, so a record that carries neither an upload nor a link still
  // goes somewhere — a row that silently does nothing reads as broken.
  onRowClick: (r) => {
    const href = documentHref(r)
    if (!href) return false
    window.open(safeHref(href), '_blank', 'noopener,noreferrer')
    return true
  },
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

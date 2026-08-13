import { SITE } from './classification'

/**
 * What a document IS, where its file lives, and how it is reached.
 *
 * Two things a library needs that this one did not have: somewhere to put the
 * actual document, and somewhere to file it. A record that carries a title, a
 * version and a review date but no way to open the thing it describes is an
 * index of documents nobody can read.
 */

// The four the library started with, then the engineering records a site
// accumulates and has to produce on demand — commissioning drawings, pressure
// tests, structural and electrical calculations. These are the ones that get
// asked for in an audit and found in somebody's email.
export const DOC_TYPES = [
  { value: 'Policy', label: 'Policy', tone: 'brand' },
  { value: 'SOP', label: 'SOP', tone: 'blue' },
  { value: 'SDS', label: 'SDS', tone: 'amber' },
  { value: 'Form', label: 'Form', tone: 'gray' },
  { value: 'GFC', label: 'GFC (Good For Construction)', tone: 'blue' },
  { value: 'HPT', label: 'HPT (Hydrostatic Pressure Test)', tone: 'violet' },
  { value: 'Structural Stability', label: 'Structural Stability', tone: 'green' },
  { value: 'Load Balancing', label: 'Load Balancing', tone: 'green' },
  { value: 'UPS & Power Backup Calculation', label: 'UPS & Power Backup Calculation', tone: 'violet' },
]

export const DOC_TYPE_BY_VALUE = Object.fromEntries(DOC_TYPES.map((t) => [t.value, t]))
export const docTypeTone = (v) => DOC_TYPE_BY_VALUE[v]?.tone || 'gray'
export const docTypeLabel = (v) => DOC_TYPE_BY_VALUE[v]?.label || v || '—'

// ── How the document is reached ──────────────────────────────────────────────

export const SOURCE_UPLOAD = 'upload'
export const SOURCE_LINK = 'link'

export const SOURCE_OPTIONS = [
  { value: SOURCE_UPLOAD, label: 'Upload a file' },
  { value: SOURCE_LINK, label: 'Link to it' },
]

/**
 * Only http(s). A document library is a place people click things, and a
 * javascript: or data: URL stored by one member and opened by another is
 * stored XSS with an audience — the same reason shared/safeUrl exists. Checked
 * on the way IN as well as on render, so a bad value never reaches the record.
 */
export function isSafeDocumentUrl(url) {
  const s = String(url || '').trim()
  if (!s) return false
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/** Where a document can actually be opened, or '' when there is nothing yet. */
export function documentHref(doc) {
  if (doc?.source === SOURCE_LINK) return isSafeDocumentUrl(doc.linkUrl) ? String(doc.linkUrl).trim() : ''
  return doc?.file?.url || ''
}

export const hasDocument = (doc) => Boolean(documentHref(doc))

/** What to call the thing being opened, for a link's text and a title. */
export function documentLabel(doc) {
  if (doc?.source === SOURCE_LINK) {
    const href = documentHref(doc)
    if (!href) return ''
    try {
      return new URL(href).hostname.replace(/^www\./, '')
    } catch {
      return 'Link'
    }
  }
  return doc?.file?.name || ''
}

// ── Folders ──────────────────────────────────────────────────────────────────

export const FOLDER_PREFIX = 'documents'

/**
 * The storage folder a document's file belongs in — one per site.
 *
 * Encoded into the single `kind` segment rather than as a nested path, because
 * storagePath() sanitises every segment (a slash becomes an underscore) and
 * storage.rules matches exactly orgs/{orgId}/{kind}/{fileName}. A deeper path
 * would be silently flattened by one and refused by the other.
 *
 * Everything not filed to a site shares the root folder. Region is deliberately
 * not given its own: a region is a set of sites, not a place a document lives,
 * and inventing a second axis of folders makes a file's home ambiguous.
 */
export function documentFolder(doc = {}) {
  const siteId = doc.level === SITE ? String(doc.siteId || '').trim() : ''
  return siteId ? `${FOLDER_PREFIX}-${siteId}` : FOLDER_PREFIX
}

/**
 * A folder for every site, whether or not anything has been filed there yet.
 *
 * An empty folder is the useful half of this: it says "nothing has been filed
 * for this site", which is the finding an audit is looking for. A view built
 * only from documents that exist can never show an absence.
 */
export function siteFolders(sites = [], docs = []) {
  const counts = new Map()
  let orgWide = 0
  for (const d of docs || []) {
    if (!d) continue
    const id = d.level === SITE ? String(d.siteId || '').trim() : ''
    if (id) counts.set(id, (counts.get(id) || 0) + 1)
    else orgWide += 1
  }
  const folders = (sites || []).filter(Boolean).map((s) => ({
    id: s.id,
    name: s.name,
    folder: `${FOLDER_PREFIX}-${s.id}`,
    count: counts.get(s.id) || 0,
  }))
  folders.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
  return { folders, orgWide }
}

/**
 * Narrow the library by region, entity and site.
 *
 * A document is filed at org, region or site level — there is no entity level —
 * so entity and region are answered through the SITE REGISTRY: a site-level
 * document belongs to whatever region and entity its site belongs to. That is
 * the only way an entity filter can mean anything without inventing a fourth
 * level and making a document's home ambiguous.
 *
 * An org-wide document matches every narrowing, because it genuinely applies
 * everywhere: filtering to one site and losing the org-wide policy that governs
 * it is how someone concludes a site has no policy.
 */
export function matchesScope(doc, { region = '', entity = '', siteId = '' } = {}, sites = []) {
  if (!region && !entity && !siteId) return true
  if (!doc) return false

  const level = doc.level || ''
  if (level !== SITE && level !== 'region') return true // org-wide, or unclassified

  if (level === 'region') {
    // A region-level document answers a region question and nothing narrower:
    // it names a region, not a site, so it cannot be attributed to one.
    if (siteId || entity) return false
    return String(doc.region || '') === region
  }

  if (siteId && doc.siteId !== siteId) return false

  // The document's OWN snapshot first. classificationFields stamps siteRegion
  // and siteEntity at write time, and firestore.rules reads those same fields
  // to decide who may read the row — so filtering on them means the filter and
  // the rule agree about which region a document is in. The registry is the
  // fallback for documents written before the snapshot existed.
  const site = (sites || []).find((s) => s && s.id === doc.siteId)
  const docRegion = String(doc.siteRegion || site?.region || '')
  const docEntity = String(doc.siteEntity || site?.entity || '')

  if (region && docRegion !== region) return false
  if (entity && docEntity !== entity) return false
  return true
}

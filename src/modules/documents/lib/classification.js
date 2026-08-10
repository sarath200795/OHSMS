// ─────────────────────────────────────────────────────────────────────────────
// Where a document applies: organization, region or site.
//
// The level is the answer to "is this mine?". A site manager opening the library
// needs the org-wide policies, the ones written for their region, and the ones
// written for their site — and needs the other forty sites' paperwork out of the
// way. That only works if the level is a fixed set of three, not a free-text tag
// that becomes "Site", "site-level" and "Kochi only" within a month.
//
// Two of the three levels name something, and the name is the whole point:
// "Region" without a region says a document is narrower than the organization
// without saying where, which nobody can act on. So a level that fails to name
// what it exists to name is treated as no classification at all — it lands with
// the documents that predate the field, because both need the same fix.
//
// Levels and their storage follow Objectives (level + the thing it scopes to)
// and the site fields every other module writes: region name, siteId, and the
// site's name beside it.
// ─────────────────────────────────────────────────────────────────────────────

export const ORG = 'org'
export const REGION = 'region'
export const SITE = 'site'
export const UNCLASSIFIED = 'unclassified'

export const LEVELS = [
  { key: ORG, label: 'Organization', tone: 'brand' },
  { key: REGION, label: 'Region', tone: 'blue' },
  { key: SITE, label: 'Site', tone: 'green' },
]

// Not a level anyone can choose — what a document reads as until someone does.
export const UNCLASSIFIED_LEVEL = { key: UNCLASSIFIED, label: 'Unclassified', tone: 'amber' }

export const LEVEL_BY_KEY = Object.fromEntries(LEVELS.map((l) => [l.key, l]))

/** The three choices a document can be filed under, for a form dropdown. */
export const LEVEL_OPTIONS = LEVELS.map((l) => ({ value: l.key, label: l.label }))

const clean = (v) => String(v ?? '').trim()

/**
 * The level a document is effectively filed at.
 *
 * Absent, blank, unrecognised, or naming nothing → unclassified. Nothing here
 * guesses: a document with no level is never quietly promoted to org-wide just
 * because that is the level that would hide the problem.
 */
export function levelOf(doc) {
  switch (clean(doc?.level)) {
    case ORG: return ORG
    case REGION: return clean(doc?.region) ? REGION : UNCLASSIFIED
    case SITE: return clean(doc?.siteId) ? SITE : UNCLASSIFIED
    default: return UNCLASSIFIED
  }
}

export const isClassified = (doc) => levelOf(doc) !== UNCLASSIFIED

/**
 * What the level names — a region, a site, or nothing at organization level.
 *
 * The registry is the authority on a site's current name, so a renamed site
 * renames on every document at once. The copy stored on the document is the
 * fallback that keeps it readable after the site is deleted, which is exactly
 * what deleteSites() leaves behind.
 */
export function scopeOf(doc, sites = []) {
  const level = levelOf(doc)
  if (level === REGION) return clean(doc.region)
  if (level !== SITE) return ''
  const id = clean(doc.siteId)
  return clean(sites.find((s) => clean(s?.id) === id)?.name) || clean(doc.site)
}

/** Level, how it should read, and what it names — everything a list row needs. */
export function levelSummary(doc, sites = []) {
  const level = levelOf(doc)
  const meta = LEVEL_BY_KEY[level] || UNCLASSIFIED_LEVEL
  return { level, label: meta.label, tone: meta.tone, scope: scopeOf(doc, sites) }
}

/**
 * The library filter. An empty `level` means every level; `scope` narrows one
 * level to a single region (by name) or site (by id).
 */
export function matches(doc, level = '', scope = '') {
  const want = clean(level)
  if (want && levelOf(doc) !== want) return false
  const which = clean(scope)
  if (!which) return true
  if (want === REGION) return clean(doc?.region) === which
  if (want === SITE) return clean(doc?.siteId) === which
  return true
}

/**
 * Filter choices, with the size of the unclassified backlog on the label so it
 * is visible rather than something you have to go looking for. The count is of
 * every document, deliberately — it is what is left to fix, not what the current
 * filter happens to show.
 */
export function levelFilterOptions(docs = []) {
  const pending = docs.filter((d) => !isClassified(d)).length
  return [
    { value: '', label: 'All levels' },
    ...LEVEL_OPTIONS,
    { value: UNCLASSIFIED, label: pending ? `Unclassified (${pending})` : 'Unclassified' },
  ]
}

/**
 * What `visibility` says to the security rule: 'all' is the whole org, 'site'
 * is only people whose access reaches the named site. It is deliberately a
 * separate field from `level` rather than derived from it in the rule, because
 * the client's query has to filter on exactly what the rule checks — and a
 * query cannot express "level is anything except site" over documents that
 * predate the field.
 */
export const VISIBLE_ALL = 'all'
export const VISIBLE_SITE = SITE

// Every key is written on every save, blank when unused. Firestore rejects
// undefined, and a document moved from Site to Organization that kept its
// siteId would apply everywhere and to one place at once — and, now, would
// still be locked to that site's staff.
const OPEN = {
  region: '',
  siteId: '',
  site: '',
  visibility: VISIBLE_ALL,
  siteRegion: '',
  siteEntity: '',
}

/**
 * The classification to persist.
 *
 * Only the fields the chosen level uses are filled — a document moved from Site
 * to Organization while keeping its siteId would go on turning up under that
 * site's filter, applying everywhere and to one place at once.
 *
 * The site's name is snapshotted next to its id so the document still says where
 * it applies once the site leaves the registry. Firestore rejects undefined, so
 * every field is written, blank when the level has no use for it.
 */
export function classificationFields(form = {}, sites = []) {
  const level = clean(form.level)
  if (level === REGION) return { ...OPEN, level, region: clean(form.region) }
  if (level === SITE) {
    const id = clean(form.siteId)
    const known = sites.find((s) => clean(s?.id) === id)
    // A site level that never resolved to a site names nothing, so it is not a
    // boundary either — it stays open rather than becoming a document only an
    // admin can ever see.
    if (!id) return { ...OPEN, level }
    return {
      level,
      region: '',
      siteId: id,
      site: clean(known?.name) || clean(form.site),
      visibility: SITE,
      // Snapshotted for the security rule, which cannot read the site document
      // without spending a lookup per row of the library. See firestore.rules.
      siteRegion: clean(known?.region) || clean(form.siteRegion),
      siteEntity: clean(known?.entity) || clean(form.siteEntity),
    }
  }
  return { ...OPEN, level: level === ORG ? ORG : '' }
}

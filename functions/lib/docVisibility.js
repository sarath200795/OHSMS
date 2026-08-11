// ─────────────────────────────────────────────────────────────────────────────
// Stamping `visibility` onto documents written before site scoping existed.
//
// The same decision as scripts/backfill-document-visibility.mjs, moved here so
// it can run as an admin-only callable instead of a local script holding a
// production password. The script still works and stays; this is the path that
// does not put a password in someone's shell history.
//
// WHY IT IS REQUIRED, not tidy-up. firestore.rules reads `visibility` DIRECTLY
// — it has to, or the condition stops constraining list queries and an
// unfiltered list returns the whole library. Direct access to a field that is
// not there errors, and an erroring rule denies. So an unstamped document is
// readable by nobody except admins, managers and auditors.
//
// It narrows nothing. Every document gets the access it already has recorded in
// a form the rule can read.
// ─────────────────────────────────────────────────────────────────────────────

const clean = (v) => String(v ?? '').trim()

/**
 * What to write onto this document, or null if it is already stamped.
 *
 * Every field the rule touches is written, not just `visibility` — a
 * half-stamped document is one nobody but an elevated role could open, because
 * the rule reads siteRegion and siteEntity directly too.
 *
 * @param sites Map of siteId -> site data, for the region/entity snapshot.
 */
export function visibilityPatch(doc, sites = new Map()) {
  if (clean(doc?.visibility)) return null

  const siteId = clean(doc?.siteId)
  const isSite = clean(doc?.level) === 'site' && siteId !== ''

  if (!isSite) {
    // Includes a 'site' level that never resolved to a site: it names nothing,
    // so it is not a boundary either, and must not become a document only an
    // admin can ever open.
    return { visibility: 'all', siteId, siteRegion: '', siteEntity: '' }
  }

  const site = sites.get(siteId)
  return {
    visibility: 'site',
    siteRegion: clean(site?.region),
    siteEntity: clean(site?.entity),
  }
}

/** Split a list of {id, data} into what needs writing and what does not. */
export function planBackfill(docs = [], sites = new Map()) {
  const writes = []
  let alreadyStamped = 0

  docs.forEach((d) => {
    const patch = visibilityPatch(d?.data, sites)
    if (!patch) {
      alreadyStamped += 1
      return
    }
    writes.push({ id: d.id, patch, title: clean(d?.data?.title) || '(untitled)' })
  })

  return {
    writes,
    alreadyStamped,
    siteScoped: writes.filter((w) => w.patch.visibility === 'site').length,
    orgWide: writes.filter((w) => w.patch.visibility === 'all').length,
  }
}

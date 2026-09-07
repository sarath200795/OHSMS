// ─────────────────────────────────────────────────────────────────────────────
// One Meraki per site, as standard.
//
// Every site has network gear carrying its cameras, so an estate where sites
// have no Meraki record is not an estate without switches — it is an estate
// where the switches are untracked. That matters more here than as tidiness:
// health cascades DOWN from the Meraki, so a site with no Meraki record can
// never be shown as dark, and a network outage there reads as every camera on
// site failing individually. The missing record does not make the module
// quieter, it makes it wrong.
//
// So the standard shape is one Meraki per site, provisioned in a batch and
// topped up as sites are added. The decision of which sites need one is pure
// and lives here, because "did we already do this?" is the part that must never
// be guessed — running it twice must not produce two switches per site.
// ─────────────────────────────────────────────────────────────────────────────

const clean = (v) => String(v ?? '').trim()

/**
 * The standard name for a site's Meraki.
 *
 * Prefixed rather than bare so a search for the site name finds the site, the
 * DVRs and the switch together, and so nobody mistakes the device row for the
 * site row.
 */
export function standardMerakiName(site) {
  const name = clean(site?.name) || clean(site?.siteName) || clean(site?.id)
  return name ? `MX-${name}` : ''
}

/**
 * Sites that have no Meraki yet.
 *
 * Matched on siteId, never on name: a site renamed after provisioning would
 * otherwise look unprovisioned and collect a second switch every time someone
 * pressed the button.
 */
export function sitesMissingMeraki(sites = [], merakis = []) {
  const covered = new Set(merakis.map((m) => clean(m?.siteId)).filter(Boolean))
  // A site with no id cannot be matched against later and would collect a fresh
  // switch on every run. Everything else gets one, including a site whose name
  // is blank — standardMerakiName falls back to the id, and an ugly "MX-<id>"
  // that someone can see and rename beats a site silently missing its switch,
  // which is the case where the health cascade quietly stops working.
  const out = []
  for (const s of sites) {
    const id = clean(s?.id)
    if (!id || covered.has(id)) continue
    // Marked covered as we go, so a site appearing twice in the input — a CSV
    // with a repeated row, a hook handed an array that overlaps a previous
    // batch — is the same "already handled" case as one provisioned last week.
    // Filtering without this produced two switches from a SINGLE run, which no
    // amount of re-reading the collection first would have caught.
    covered.add(id)
    out.push(s)
  }
  return out
}

/**
 * The document id for a site's standard Meraki.
 *
 * Derived from the site rather than auto-generated, and that is the whole
 * defence against the case the siteId check cannot see: two provisioning runs
 * overlapping. Both read the collection, both find the site uncovered, both
 * write — and with auto-ids those are two documents. Addressed by site, they
 * are one document written twice, which is the correct outcome.
 *
 * Prefixed because a bare site id in the Meraki collection reads as though the
 * two collections share a key space; and because "site_" cannot collide with a
 * Firestore auto-id, which is 20 alphanumeric characters.
 *
 * @returns '' when the id cannot be used in a path — the caller falls back to
 *          an auto-id, since refusing to provision at all would be worse than
 *          provisioning without the extra guard.
 */
export function merakiDocId(siteId) {
  const id = clean(siteId)
  if (!id || id.includes('/') || id === '.' || id === '..' || id.length > 1000) return ''
  return `site_${id}`
}

/**
 * The documents to create for those sites.
 *
 * Status is deliberately `unknown`, not `online`. Nothing has checked whether
 * these switches are up; claiming they are would put a green number on the
 * dashboard that no one verified. `unknown` is treated as working by the health
 * pass so it does not tank the estate figure, and is counted separately so it
 * cannot hide.
 */
export function standardMerakiPayloads(sites = [], merakis = []) {
  return sitesMissingMeraki(sites, merakis).map((s) => ({
    name: standardMerakiName(s),
    siteId: clean(s.id),
    siteName: clean(s.name) || clean(s.siteName),
    ipAddress: '',
    status: 'unknown',
    model: '',
    serial: '',
    defects: [],
    notes: 'Created as the standard Meraki for this site — add its IP and model.',
  }))
}

/**
 * Sites carrying more than one Meraki.
 *
 * The mirror of sitesMissingMeraki, and it matters for the same reason. Health
 * cascades down from the switch, and darkSites() only marks a site dark when
 * EVERY Meraki on it is offline — deliberately, because a site with two real
 * switches is still carried by the second one. So a duplicate record does not
 * merely clutter the register: it stands in as a switch that is always fine,
 * and the site never goes dark no matter what happens to the network.
 *
 * Which means the extras cannot just be deleted here. One of them may be a real
 * second switch, and the one to keep may be the one somebody filled in the IP
 * for. This reports; a person decides.
 *
 * @returns [{ siteId, siteName, devices }] — devices in the order given,
 *          sites in the order first seen, only where devices.length > 1
 */
export function sitesWithDuplicateMerakis(merakis = [], sites = []) {
  const named = new Map(
    sites.map((s) => [clean(s?.id), clean(s?.name) || clean(s?.siteName)]).filter(([id]) => id)
  )
  const bySite = new Map()
  for (const m of merakis) {
    const siteId = clean(m?.siteId)
    // A record naming no site is a different defect — it is not a duplicate of
    // anything, and lumping them together would report one phantom "site" with
    // every orphan on it.
    if (!siteId) continue
    if (!bySite.has(siteId)) bySite.set(siteId, [])
    bySite.get(siteId).push(m)
  }
  const out = []
  for (const [siteId, devices] of bySite) {
    if (devices.length < 2) continue
    out.push({
      siteId,
      siteName: named.get(siteId) || clean(devices[0]?.siteName) || siteId,
      devices,
    })
  }
  return out
}

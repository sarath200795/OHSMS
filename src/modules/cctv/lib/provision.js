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
  return sites.filter((s) => {
    const id = clean(s?.id)
    return Boolean(id) && !covered.has(id)
  })
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

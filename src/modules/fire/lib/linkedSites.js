// ─────────────────────────────────────────────────────────────────────────────
// Which registry sites the equipment registers actually point at.
//
// Every asset class carries a free-text `centerName` from the system it was
// imported from, plus a `siteId` once linkExtinguishersToSites has matched it
// against the site registry. Those two can disagree, and until now nothing in
// the app said which sites the fleet is really keyed to — only how many units
// were still linkable ("Link N to sites" on the repository).
//
// So: count by the link, not by the name. An asset is
//   linked   — siteId names a site in the registry
//   orphaned — siteId is set but names nothing the registry has (a deleted
//              site, or one outside this user's scope). Counting these as
//              "linked" would report coverage the data does not have.
//   unlinked — no siteId, grouped by whatever center name it carries
//
// Pure, so the page stays a rendering of it.
// ─────────────────────────────────────────────────────────────────────────────

const clean = (v) => String(v ?? '').trim()
const byName = (a, b) => clean(a?.name).localeCompare(clean(b?.name))

const EMPTY_COUNTS = { ext: 0, aed: 0, fas: 0, sign: 0, total: 0 }

const bump = (map, key, kind) => {
  const row = map.get(key) || { ...EMPTY_COUNTS }
  row[kind] += 1
  row.total += 1
  map.set(key, row)
}

/**
 * The ids a link can actually resolve to. Hoisted out of the predicate so a
 * list filter builds it once instead of per row.
 */
export function siteIdSet(sites = []) {
  return new Set((sites || []).filter((s) => clean(s?.id)).map((s) => clean(s.id)))
}

/**
 * Is this asset attached to a site the registry still has?
 *
 * A siteId that resolves to nothing counts as NOT linked, deliberately: the
 * chip is there to answer "can I find this by site?", and a dangling id cannot.
 * The Sites page reports those separately so they are not simply lost.
 */
export function isLinkedToSite(asset, ids) {
  const set = ids instanceof Set ? ids : siteIdSet(ids)
  return !!asset && set.has(clean(asset.siteId))
}

/**
 * Narrow a register by link state. `state` is 'linked', 'unlinked', or any
 * falsy value for no filtering at all.
 */
export function filterByLinkState(assets = [], sites = [], state) {
  if (state !== 'linked' && state !== 'unlinked') return assets
  const ids = siteIdSet(sites)
  return (assets || []).filter((a) => isLinkedToSite(a, ids) === (state === 'linked'))
}

/**
 * The assets that ARE linked, one row each, for a reader who wants to see the
 * list rather than the counts. Ordered by site, then by the asset's own label,
 * so a site's units read together.
 *
 * Rows carry the resolved site, so a caller never has to index the registry
 * again to print a name.
 *
 * @returns Array<{asset, site, label}>
 */
export function listLinkedAssets(assets = [], sites = []) {
  const byId = new Map((sites || []).filter((s) => clean(s?.id)).map((s) => [clean(s.id), s]))
  return (assets || [])
    .filter((a) => a && !a.deletedAt && byId.has(clean(a.siteId)))
    .map((asset) => ({
      asset,
      site: byId.get(clean(asset.siteId)),
      // Extinguishers carry a serial, AEDs an assetId, FAS a deviceId. Signage
      // carries no id at all, so it is named by what it is and where it hangs —
      // a column of dashes would make the list useless for the one register
      // that most needs it.
      label: clean(asset.serialNo) || clean(asset.assetId) || clean(asset.deviceId)
        || [clean(asset.type), clean(asset.location) || clean(asset.floor)].filter(Boolean).join(' · ')
        || '—',
    }))
    .sort((a, b) => byName(a.site, b.site) || a.label.localeCompare(b.label))
}

/**
 * Group the equipment registers by the site they are linked to.
 *
 * @param {{extinguishers?: array, aeds?: array, fas?: array, signages?: array}} registers
 * @param {array} sites  the site registry (already scoped to the reader)
 * @returns {{
 *   linked: Array<{site: object, counts: object}>,   // most equipment first
 *   empty: array,                                    // sites with no equipment
 *   unlinked: Array<{centerName: string, counts: object}>,
 *   orphaned: Array<{siteId: string, counts: object}>,
 *   totals: object,
 * }}
 */
export function summariseLinkedSites(registers = {}, sites = []) {
  const { extinguishers = [], aeds = [], fas = [], signages = [] } = registers
  const byId = new Map((sites || []).filter((s) => clean(s?.id)).map((s) => [clean(s.id), s]))

  const linkedCounts = new Map()
  const orphanCounts = new Map()
  const unlinkedCounts = new Map()

  const feed = (assets, kind) => {
    for (const a of assets || []) {
      if (!a || a.deletedAt) continue
      const id = clean(a.siteId)
      if (id && byId.has(id)) bump(linkedCounts, id, kind)
      else if (id) bump(orphanCounts, id, kind)
      // An asset with neither a link nor a name is still a real record; label
      // it rather than filing it under an empty string nobody can search for.
      else bump(unlinkedCounts, clean(a.centerName) || '(no site name)', kind)
    }
  }
  feed(extinguishers, 'ext')
  feed(aeds, 'aed')
  feed(fas, 'fas')
  feed(signages, 'sign')

  const linked = [...linkedCounts.entries()]
    .map(([id, counts]) => ({ site: byId.get(id), counts }))
    .sort((a, b) => b.counts.total - a.counts.total || byName(a.site, b.site))

  const empty = (sites || []).filter((s) => !linkedCounts.has(clean(s?.id))).sort(byName)

  const unlinked = [...unlinkedCounts.entries()]
    .map(([centerName, counts]) => ({ centerName, counts }))
    .sort((a, b) => b.counts.total - a.counts.total || a.centerName.localeCompare(b.centerName))

  const orphaned = [...orphanCounts.entries()]
    .map(([siteId, counts]) => ({ siteId, counts }))
    .sort((a, b) => b.counts.total - a.counts.total || a.siteId.localeCompare(b.siteId))

  const sum = (rows) => rows.reduce((n, r) => n + r.counts.total, 0)
  return {
    linked,
    empty,
    unlinked,
    orphaned,
    totals: {
      sitesLinked: linked.length,
      sitesTotal: (sites || []).length,
      assetsLinked: sum(linked),
      assetsUnlinked: sum(unlinked),
      assetsOrphaned: sum(orphaned),
    },
  }
}

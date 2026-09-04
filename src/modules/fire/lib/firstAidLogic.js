// ─────────────────────────────────────────────────────────────────────────────
// Scoring rules for first aid box contents, shared by the First Aid register
// (the matrix) and the First Aid Readiness dashboard so both read a site the
// same way.
//
// This is the signage model applied to a box: the unit is a (site, item) pair,
// not a box, because "does this site have a first aid box" is a question every
// site answers yes to. What is worth knowing is which of the contents are
// actually in it, in date, and in the quantity the box is meant to hold.
//
// Kept beside signageLogic and deliberately reusing its site-attribute helper —
// the two pages ask the identical question of the identical five registers, and
// a second copy of that resolution is exactly how the signage matrix and its
// dashboard once disagreed about which region a site was in.
// ─────────────────────────────────────────────────────────────────────────────
import { FIRST_AID_ITEM_BY_NAME, FIRST_AID_ITEM_NAMES } from './constants'
import { dueState } from './assetLogic'
import { siteAttributeMap } from './signageLogic'

export { siteAttributeMap }

// Conditions recorded against an item that mean it is in the box but not fit
// for use. Distinct from 'Missing' (not there) and 'Expired' (there, but out of
// date, which is handled by date as well as by condition).
export const ISSUE_CONDITIONS = ['Low Stock', 'Damaged']

/** The quantity a site is expected to hold of an item. Unknown items need one. */
export const requiredQty = (item) => FIRST_AID_ITEM_BY_NAME[item]?.minQty || 1

/** Does this item have a shelf life worth asking about on the form? */
export const itemExpires = (item) => !!FIRST_AID_ITEM_BY_NAME[item]?.expires

/**
 * Is this record out of date?
 *
 * By condition OR by date — a surveyor may record 'Expired' without knowing the
 * printed date, and an untouched record whose date has since passed is expired
 * whether or not anybody has been back to say so. Both are the same fact.
 */
export const isExpired = (r, today = new Date()) =>
  r?.condition === 'Expired' || dueState(r?.expiryDate, today) === 'expired'

/** In date, but not for much longer (within the shared 30-day window). */
export const isExpiringSoon = (r, today = new Date()) =>
  !isExpired(r, today) && dueState(r?.expiryDate, today) === 'due'

/** Stock that can actually be used: present, in date, and not written off. */
const isUsable = (r, today) => r?.condition !== 'Missing' && !isExpired(r, today)

const qtyOf = (r) => Number(r?.quantity) || 0

/**
 * Status of one (site, item) cell from the records already narrowed to it.
 * → { count, status: 'ok' | 'issue' | 'missing' | 'none', label, qty, required, expired }
 *
 * `qty` sums EVERY box at the site. A site with three first aid boxes is asked
 * for the item's minimum in total rather than in each — the register records
 * where each box is, but the question the dashboard answers is whether the site
 * is equipped, and requiring a full kit per box would report a well-stocked
 * site with a small satellite box as a failure.
 */
export function firstAidCell(recs, item, today = new Date()) {
  const required = requiredQty(item)
  if (!recs || recs.length === 0) return { count: 0, status: 'none', label: '—', qty: 0, required, expired: 0 }

  const usable = recs.filter((r) => isUsable(r, today))
  const qty = usable.reduce((a, r) => a + qtyOf(r), 0)
  const expired = recs.filter((r) => isExpired(r, today)).length
  const label = `${qty}/${required}`

  // Nothing usable is the same answer however it got there: recorded Missing,
  // counted at zero, or every unit of it out of date. All three mean a person
  // reaching into this box for this item finds nothing they can use.
  if (qty === 0) return { count: recs.length, status: 'missing', label, qty, required, expired }

  const short = qty < required
  const flagged = usable.some((r) => ISSUE_CONDITIONS.includes(r.condition))
  const nearlyOut = usable.some((r) => isExpiringSoon(r, today))
  const status = short || flagged || nearlyOut || expired > 0 ? 'issue' : 'ok'
  return { count: recs.length, status, label, qty, required, expired }
}

/**
 * An item counts toward a site's readiness only when the box actually holds
 * enough of it, in date.
 *
 * This is stricter than signage, where a faded-but-present sign still counts as
 * covered, and it is stricter on purpose. Signage asks whether a sign is THERE;
 * every first aid item is scored against a required count, which makes it the
 * analogue of signage's one counted column — the fire-extinguisher sign — where
 * a partial match has never counted either. Two of twenty bandages is not a
 * stocked box, and a readiness figure that called it one would be answering the
 * opposite of the question it was asked.
 *
 * Partial stock is not lost: it lands in `issues`, which the matrix draws amber
 * and both tables count separately from a bare gap.
 */
export const isItemAvailable = (cell) => cell.status === 'ok'

/**
 * Readiness across a set of sites.
 *
 * A "cell" is one (site, item) pair — the unit the matrix draws and the unit
 * readiness is measured in, so a site holding fifteen of sixteen items reads as
 * 94 %, not as a plain pass/fail.
 *
 * @param sites   site names in scope (kept even with no records, so a site
 *                nobody has surveyed reads as 0 % rather than vanishing from
 *                the denominator)
 * @param records the first aid register
 * @param items   which contents to score — the matrix's visible columns
 * @param attrs   { regionOf, entityOf } the maps the CALLER already built for
 *                its filters, passed in rather than rebuilt so a row and the
 *                chip that hides it cannot resolve a site differently
 *
 * → {
 *     sites, records, items, cells,
 *     available, ok, issue, missing, notRecorded, readiness,
 *     fullyStocked, sitesWithGaps, expired, expiringSoon, boxes,
 *     byItem: [{ item, required, available, gaps, issues, records, readiness }],
 *     bySite: [{ site, region, entity, available, total, gaps, issues, records,
 *                boxes, expired, readiness, missingItems }],
 *     byCondition: { [condition]: count },
 *   }
 */
export function firstAidSummary(sites, records, items = FIRST_AID_ITEM_NAMES, attrs = {}, today = new Date()) {
  const regionOf = attrs.regionOf || siteAttributeMap('region', [records])
  const entityOf = attrs.entityOf || siteAttributeMap('entity', [records])

  // Bucket the register by site ONCE. This runs over every site × every item,
  // and re-scanning the whole register inside each cell is what makes a large
  // estate feel broken — the same trap signageSummary documents.
  const bySiteRecords = new Map(sites.map((s) => [s, []]))
  let recordCount = 0
  let expired = 0
  let expiringSoon = 0
  const byCondition = {}
  for (const r of records || []) {
    if (!bySiteRecords.has(r.centerName)) continue
    bySiteRecords.get(r.centerName).push(r)
    recordCount++
    if (isExpired(r, today)) expired++
    else if (isExpiringSoon(r, today)) expiringSoon++
    const c = r.condition || 'Available'
    byCondition[c] = (byCondition[c] || 0) + 1
  }

  const byItem = items.map((i) => ({
    item: i, required: requiredQty(i), available: 0, gaps: 0, issues: 0, records: 0, readiness: 0,
  }))
  const itemIndex = new Map(byItem.map((r, i) => [r.item, i]))

  const totals = { ok: 0, issue: 0, missing: 0, notRecorded: 0 }
  const bySite = []
  const allBoxes = new Set()

  for (const site of sites) {
    const siteRecs = bySiteRecords.get(site) || []
    const boxes = new Set(siteRecs.map((r) => (r.boxLocation || '').trim()).filter(Boolean))
    for (const b of boxes) allBoxes.add(`${site}::${b}`)
    const row = {
      site,
      region: regionOf[site] || '',
      entity: entityOf[site] || '',
      available: 0,
      total: items.length,
      gaps: 0,
      issues: 0,
      records: siteRecs.length,
      boxes: boxes.size,
      expired: siteRecs.filter((r) => isExpired(r, today)).length,
      readiness: 0,
      missingItems: [],
    }
    for (const item of items) {
      const recs = siteRecs.filter((r) => r.item === item)
      const cell = firstAidCell(recs, item, today)
      const t = byItem[itemIndex.get(item)]
      t.records += recs.length
      totals[cell.status === 'none' ? 'notRecorded' : cell.status]++
      if (isItemAvailable(cell)) {
        row.available++
        t.available++
      } else {
        row.gaps++
        t.gaps++
        row.missingItems.push(item)
      }
      if (cell.status === 'issue') {
        row.issues++
        t.issues++
      }
    }
    row.readiness = row.total ? Math.round((row.available / row.total) * 100) : 0
    bySite.push(row)
  }

  const cells = sites.length * items.length
  const available = bySite.reduce((n, r) => n + r.available, 0)
  for (const t of byItem) t.readiness = sites.length ? Math.round((t.available / sites.length) * 100) : 0

  return {
    sites: sites.length,
    records: recordCount,
    items: items.length,
    cells,
    available,
    ...totals,
    expired,
    expiringSoon,
    boxes: allBoxes.size,
    readiness: cells ? Math.round((available / cells) * 100) : 0,
    fullyStocked: bySite.filter((r) => r.gaps === 0).length,
    sitesWithGaps: bySite.filter((r) => r.gaps > 0).length,
    byItem: byItem.sort((a, b) => a.readiness - b.readiness || a.item.localeCompare(b.item)),
    bySite: bySite.sort((a, b) => b.gaps - a.gaps || b.issues - a.issues || a.site.localeCompare(b.site)),
    byCondition,
  }
}

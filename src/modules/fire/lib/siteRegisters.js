// ─────────────────────────────────────────────────────────────────────────────
// Which register each site appears in.
//
// The signage pages count 116 sites and the extinguisher register counts 104,
// and both are right: there is no single site list here. useFleet builds one by
// taking the DISTINCT `centerName` across every register — extinguishers,
// signage, AEDs, fire alarm panels, first aid boxes, stretchers and mock drills
// — so any site named in any of them becomes a row on the signage matrix.
//
// That is deliberate. A site with no signage has to appear, or the gap it
// represents disappears with it. But it has two consequences worth being able
// to see rather than reason about:
//
//   1. A site genuinely present in one register and not another is a REAL gap —
//      116 minus 104 is twelve sites with signage or an AED and no extinguisher
//      on the register, which is either a survey nobody did or equipment nobody
//      logged.
//
//   2. `centerName` is FREE TEXT, not a key into the site registry. "Kochi Hub"
//      on one register and "Kochi HUB" on another are two sites to every count
//      on the page. A phantom sits in the signage denominator reading 0 %
//      forever, so it does not merely miscount sites — it understates
//      compliance, permanently, and looks exactly like a site that needs work.
//
// Those two need different fixes — go and survey, versus go and rename — and
// nothing on the page could tell them apart. Hence this file.
//
// Pure, and takes the registers rather than reading them, so the arithmetic can
// be tested without a Firestore or a browser.
// ─────────────────────────────────────────────────────────────────────────────

const clean = (v) => String(v ?? '').trim()

/**
 * The registers, in the order they should be shown.
 *
 * `key` matches the field on the result rows; `name` is what a person reading
 * the panel calls that register.
 */
export const REGISTERS = [
  { key: 'ext', name: 'Extinguishers' },
  { key: 'signage', name: 'Signage' },
  { key: 'aed', name: 'AEDs' },
  { key: 'fas', name: 'Fire alarm' },
  { key: 'firstAid', name: 'First aid' },
  { key: 'stretcher', name: 'Stretchers' },
  { key: 'drill', name: 'Mock drills' },
]

/**
 * The comparison key for two site names that are "the same site, typed twice".
 *
 * Case, punctuation and spacing only. Deliberately NOT fuzzy — an edit-distance
 * match would pair "Depot 1" with "Depot 2", which are two real sites, and a
 * diagnostic that cries wolf gets switched off. Everything this flags is a pair
 * a person would read as identical.
 */
export const nameKey = (v) => clean(v).toLowerCase().replace(/[^a-z0-9]+/g, '')

/**
 * Every site name across the registers, and where each one appears.
 *
 * @param registers { extinguishers, signages, aeds, fas, firstAid, stretchers, mockDrills }
 * @returns {
 *   rows,           every site, with a boolean per register, name-sorted
 *   totals,         how many distinct sites each register knows, plus `any`
 *   missing,        per register, the sites that register has never heard of
 *   variants,       groups of names that differ only by case/punctuation
 * }
 */
export function siteRegisters({
  extinguishers = [], signages = [], aeds = [], fas = [], firstAid = [], stretchers = [], mockDrills = [],
} = {}) {
  // site name → { site, ext, signage, aed, fas, firstAid, stretcher, drill }
  const seen = new Map()

  const mark = (rows, key) => {
    for (const r of rows || []) {
      const site = clean(r?.centerName)
      if (!site) continue
      if (!seen.has(site)) {
        // Seeded from REGISTERS rather than written out by hand: the literal
        // this replaces was the second place a register had to be listed, and
        // a key present here but absent there reads as "no site is on it".
        seen.set(site, { site, ...Object.fromEntries(REGISTERS.map((r) => [r.key, false])) })
      }
      seen.get(site)[key] = true
    }
  }

  mark(extinguishers, 'ext')
  mark(signages, 'signage')
  mark(aeds, 'aed')
  mark(fas, 'fas')
  mark(firstAid, 'firstAid')
  mark(stretchers, 'stretcher')
  mark(mockDrills, 'drill')

  const rows = [...seen.values()].sort((a, b) => a.site.localeCompare(b.site))

  const totals = { any: rows.length }
  const missing = {}
  for (const r of REGISTERS) {
    totals[r.key] = rows.filter((row) => row[r.key]).length
    // Sorted by name, because this list is read as a worklist and somebody has
    // to find each one in the register they are about to correct.
    missing[r.key] = rows.filter((row) => !row[r.key]).map((row) => row.site)
  }

  return { rows, totals, missing, variants: nameVariants(rows) }
}

/**
 * Groups of site names that differ only by case, punctuation or spacing.
 *
 * A group of one is not a finding, so only collisions are returned. These are
 * the rows worth looking at FIRST: each one is a site being counted twice, and
 * the second copy drags every percentage on the page down.
 */
export function nameVariants(rows = []) {
  const byKey = new Map()
  for (const row of rows) {
    const key = nameKey(row.site)
    if (!key) continue
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key).push(row)
  }

  return [...byKey.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({
      key,
      names: group.map((r) => r.site).sort((a, b) => a.localeCompare(b)),
      // Which registers the whole group touches, so it is obvious where the
      // rename has to happen.
      registers: REGISTERS.filter((r) => group.some((row) => row[r.key])).map((r) => r.key),
    }))
    .sort((a, b) => a.names[0].localeCompare(b.names[0]))
}

/**
 * One sentence saying why two counts on the same page differ.
 *
 * Returns '' when they do not, so a caller can render it unconditionally and it
 * stays silent while there is nothing to explain.
 */
export function registerGapSummary(result, key = 'ext') {
  const reg = REGISTERS.find((r) => r.key === key)
  if (!result || !reg) return ''
  const short = result.missing[key]?.length || 0
  if (!short) return ''
  return `${result.totals.any} sites appear across the five registers; ` +
    `${result.totals[key]} are on the ${reg.name.toLowerCase()} register. ` +
    `The other ${short} are named somewhere else and not there.`
}

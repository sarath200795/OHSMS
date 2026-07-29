// ─────────────────────────────────────────────────────────────────────────────
// Linking equipment to the site registry.
//
// Equipment arrived from a standalone system where the site was a free-text
// "Center Name", so the two modules never shared a key. Matching is done once,
// here, and the result is stored as a siteId on each asset — after that the
// link survives either side being renamed.
//
// Three tiers, loosest last:
//   1. normalisation  — case, punctuation, dashes, and the word "Gym", which is
//      the systematic difference ("Cult Ameerpet" vs "Cult Gym Ameerpet")
//   2. OVERRIDES      — decisions normalisation cannot make, because they need
//      locality or brand knowledge. Every one was confirmed against the site
//      master's Locality column, not guessed from string similarity.
//   3. nothing        — left unlinked and reported, never matched on a hunch
//
// Tier 2 exists because similarity scoring gets these actively wrong: it paired
// "G8 Fitness Studio - Sainikpuri" with "Stark Fitness Studio (Sainikpuri)" —
// same locality, different business — and "Cult Suchitra Hybrid" with a
// Somajiguda site when a Suchitra Road site exists.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Equipment center name → canonical site name.
 * Keyed on the exact string the equipment records carry.
 */
export const SITE_NAME_OVERRIDES = {
  // Locality or brand disambiguation
  'Cult Suchitra Hybrid': 'Cult Gym Suchitra Road (Suchitra)',
  'Elevate fitness Chandanagar': 'Elevate Fitness Studio',
  'Fitness Freaks - S R Nagar': 'Fitness Freaks',
  'Gym Point Chandanagar': 'Gym Point The Fitness Studio (Chandanagar)',
  'Gym Point Gopanapalle': 'Gympoint (T-360 Fitness)',
  'Millenium Fitness (Punjagutta)': 'Millenium Fitness Club',
  'Pilate Studio Banjara Hills Rd-2': 'Pilates Circle - Banjara Hills',
  'Raptor Fitness (Addaguta)': 'Raptor Fitness (Addagutta)',
  'G8 Fitness Studio - Sainikpuri': 'G8 Fitness',
  'Stark fitness studio (Hyder Nagar)': 'Stark Fitness Studio (Hydernagar)',
  'Sunrise Miyapur': 'Cult Miyapur Sunrise Swimming',
  'V Fitness (Miyapur)': 'V Fitness Center (Nizampet)',
  'Play Time Sport': 'Fitso Kondapur Playtime Sports',
  'Play time Swimming': 'Fitso Kondapur Playtime',
  // Typos in the source data
  'Strak Fitness Studio - Sainikpuri': 'Stark Fitness Studio (Sainikpuri)',
  'F7 by Prasad Konda (Raisal Bazar)': 'F7 By Prasad konda (Risala Bazar)',
  'Five Hive Fitness (Kukatpally)': 'Five The Fitness Hive (Kukatpally)',
  // Naming-convention differences
  'Cult Store - Irrum Manzil': 'Cult EBO @ Irrum Manzil',
  'Madhapur Pearl': 'Fitso Madhapur Pearl',
  'F99 Pragathi Nagar': 'F99 Fit (Pragathi Nagar)',
  'CULT – Botanical Garden': 'Cult Gym Botanical Garden Rd',
  'Cult Botanical Garden Camelot Layout': 'Cult Gym Camelot layout, Botanical Garden',
  'Stallion Xtreme Fitness (BHEL)': 'Stallion Fitness (BHEL)',
  'Stallion Xtreme Suchitra': 'Stallion Xtreme Fitness (Suchitra)',
  // Site names carry a locality suffix the equipment records omit
  'Cult Gym Beeramguda': 'Cult gym Beeramguda - Hybrid (Beeramguda)',
  'Cult Gym Nizampet - Hybrid': 'Cult Gym Nizampet - Hybrid (Nizampet)',
  'Cult Somajiguda': 'Cult Gym Somajiguda - Hybrid',
  'Cult Gym Moosapet': 'Cult Gym Moosapet (Moosapet)',
  'Cult Gym Khajaguda': 'Cult Gym Khajaguda (Khajaguda)',
  'F Square Fitness (Kondapur)': 'F Square Fitness',
  'Pran Fitness Kondapur': 'Pran Fitness',
  'Conquest Fitness (Kondapur)': 'Conquest Fitness',
  'Iron Fist Fitness': 'Iron Fist',
  'Absolute Fitness Studio Kukatpally': 'Absolute Fitness Studio',
}

const base = (s) => String(s ?? '').trim().toLowerCase().replace(/[‐-―]/g, '-').replace(/\s+/g, ' ')
const alnum = (s) => base(s).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
// "Gym" is noise: the site registry includes it, the equipment records often don't.
const core = (s) => alnum(s).split(' ').filter((w) => w !== 'gym').join(' ')

// ── Similarity, used only to suggest (never to match) ────────────────────────
// Words are sorted before comparing so word order cannot matter, then compared
// by character bigram overlap so a misspelling inside a word still scores high.
// Comparing whole words alone is not enough: "Cult Shaikpett" and "Cult
// Ameerpet" share exactly one word with "Cult Shaikpet", so a word-level score
// ties them and picks whichever site comes first.
const sortedCore = (s) => core(s).split(' ').filter(Boolean).sort().join(' ')

function bigrams(s) {
  const m = new Map()
  for (let i = 0; i < s.length - 1; i += 1) {
    const g = s.slice(i, i + 2)
    m.set(g, (m.get(g) || 0) + 1)
  }
  return m
}

/** Sørensen–Dice over character bigrams: 1 is identical, 0 shares nothing. */
function dice(a, b) {
  const A = bigrams(a)
  const B = bigrams(b)
  let shared = 0
  let total = 0
  for (const n of A.values()) total += n
  for (const [g, n] of B) {
    total += n
    const m = A.get(g)
    if (m) shared += Math.min(m, n)
  }
  return total ? (2 * shared) / total : 0
}

// Below this, a suggestion is more likely to mislead than help. "Cult
// Shaikpett" scores 0.96 against the site it means and 0.48 against the next
// closest, so the gap this has to sit inside is real but not wide.
const SUGGEST_FLOOR = 0.55

/** Index a site list by each normalisation tier. First writer wins. */
export function indexSites(sites) {
  const idx = new Map()
  for (const s of sites) {
    for (const f of [base, alnum, core]) {
      const k = f(s.name)
      if (k && !idx.has(k)) idx.set(k, s)
    }
  }
  return idx
}

/**
 * Resolve one center name to a site.
 * Returns { site, how } where `how` is 'exact' | 'normalised' | 'override',
 * or null when nothing matches — never a best guess.
 */
export function resolveSite(centerName, sites, idx = indexSites(sites)) {
  const raw = String(centerName ?? '').trim()
  if (!raw) return null

  const mapped = SITE_NAME_OVERRIDES[raw]
  if (mapped) {
    const site = sites.find((s) => base(s.name) === base(mapped))
    return site ? { site, how: 'override' } : null
  }

  const exact = sites.find((s) => s.name === raw)
  if (exact) return { site: exact, how: 'exact' }

  const hit = idx.get(base(raw)) || idx.get(alnum(raw)) || idx.get(core(raw))
  return hit ? { site: hit, how: 'normalised' } : null
}

/**
 * The closest site name to one that did not resolve, for a "did you mean?"
 * prompt on upload.
 *
 * This is the similarity scoring the header warns about, and it is used here
 * for the one thing it is safe for: offering a person a choice. It never
 * matches anything on its own — resolveSite still decides what is a match, and
 * a suggestion only takes effect when someone accepts it. That is the whole
 * difference between this and the mis-pairings that made the override table
 * necessary.
 *
 * Scored by Dice coefficient over normalised word sets, so "Cult Ameerpet Gym"
 * and "Cult Gym Ameerpet" score identically regardless of word order. The 0.5
 * floor keeps unrelated names from being offered at all — a wrong suggestion a
 * tired uploader accepts is worse than no suggestion.
 */
export function suggestSite(name, sites, idx = indexSites(sites)) {
  if (!name || resolveSite(name, sites, idx)) return null
  const want = sortedCore(name)
  if (!want) return null

  let best = null
  for (const s of sites) {
    const have = sortedCore(s.name)
    if (!have) continue
    const score = dice(want, have)
    if (!best || score > best.score) best = { site: s, score }
  }
  return best && best.score >= SUGGEST_FLOOR ? best : null
}

/**
 * Work out what linking would change, without writing anything.
 *
 * Entity is taken from the matched site rather than a lookup table: the two
 * systems label the same site differently (1P vs COCO), and the mapping is not
 * clean — 1P is usually COCO but sometimes FOFO or Pilate. Reading it off the
 * linked site is exact per asset and needs no translation table.
 */
export function planSiteLinks(assets, sites) {
  const idx = indexSites(sites)
  const linked = []
  const unmatched = []

  for (const e of assets) {
    if (e.deletedAt) continue
    const hit = resolveSite(e.centerName, sites, idx)
    if (!hit) { unmatched.push(e); continue }
    const entityChanged = (e.entity || '') !== (hit.site.entity || '')
    // The centre name the asset arrived with is whatever the source system
    // called the place. Once it resolves, the registry's name is the right one
    // to show, so a difference here is a change worth making.
    const nameChanged = (e.centerName || '') !== hit.site.name
    const needsWrite = e.siteId !== hit.site.id || entityChanged || nameChanged
    // `asset` is the general name; `ext` is kept because the extinguisher path
    // has always destructured it and renaming it there buys nothing.
    if (needsWrite) linked.push({ asset: e, ext: e, site: hit.site, how: hit.how, entityChanged, nameChanged })
  }

  const centers = new Set(assets.filter((e) => !e.deletedAt).map((e) => e.centerName))
  // Assets with no center name at all are a real case (older records); label
  // them rather than listing an empty string the reader cannot act on.
  const unmatchedCenters = [...new Set(
    unmatched.map((e) => String(e.centerName ?? '').trim() || '(no center name)')
  )].sort()

  return {
    linked,
    unmatched,
    unmatchedCenters,
    totalCenters: centers.size,
    entityChanges: linked.filter((l) => l.entityChanged).length,
    nameChanges: linked.filter((l) => l.nameChanged).length,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Which site a message means — searched ONLY among the sites the sender can
// already reach.
//
// That restriction is the privacy property, not an optimisation. Searching the
// whole registry and then refusing would answer a different question first —
// "does a site with this code exist?" — and a bot that answers that to anyone
// with a linked number is an enumeration oracle for the site master. Searched
// within reach, "no match" and "not yours" are the same reply.
//
// Order, tightest first; the first tier that finds anything decides:
//   1. code       the external centre id, case-insensitive, as a STRING so
//                 "0071" keeps its zeros. Exact only — a prefix of an id is
//                 not a match, or "50" would confirm every centre that starts
//                 with it.
//   2. name       the normalised name (case, punctuation, the word "gym")
//   3. contains   case-insensitive partial: every word of the query (3+)
//                 occurs in the normalised name ("angala" → Koramangala)
//   4. fuzzy      Dice over character bigrams of the sorted words, floor 0.5,
//                 the same scoring the app's suggestSite uses
// One hit is the answer. Two to eight is a list to pick from (WhatsApp's
// interactive list holds ten; eight leaves room and stays readable). More
// than eight asks for the Centre ID. A miss is not a location request —
// closestSites names the nearest reachable centres so the caller can pick.
// ─────────────────────────────────────────────────────────────────────────────

/** How many centres a single reply may list. WhatsApp list rows stop at 10. */
export const MAX_CHOICES = 8
export const FUZZY_FLOOR = 0.5

/** "Did you mean?" names. Below the match floor, so a suggestion is never an answer. */
export const SUGGEST_LIMIT = 3
export const SUGGEST_FLOOR = 0.4

const NOISE = new Set(['gym', 'cult'])
const words = (s) =>
  String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‐-―]/g, '-')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
const nameKey = (s) =>
  words(s)
    .filter((w) => w !== 'gym')
    .join(' ')
const fuzzyKey = (s) =>
  words(s)
    .filter((w) => !NOISE.has(w))
    .sort()
    .join(' ')
/** Centre id comparison. Trim and case only — the stored spelling stays put. */
export function centreIdKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

const codeKey = centreIdKey

function bigrams(s) {
  const m = new Map()
  for (let i = 0; i < s.length - 1; i += 1) {
    const g = s.slice(i, i + 2)
    m.set(g, (m.get(g) || 0) + 1)
  }
  return m
}

export function dice(a, b) {
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

const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''))

/**
 * @returns { status: 'one', site, how }
 *        | { status: 'many', sites, how }     2..MAX_CHOICES
 *        | { status: 'tooMany', count }
 *        | { status: 'none' }
 */
export function resolveSiteQuery(query, sites = []) {
  const list = (sites || []).filter((s) => s && s.id)
  const q = String(query ?? '').trim()
  if (!q || !list.length) return { status: 'none' }

  const decide = (hits, how) => {
    if (hits.length === 1) return { status: 'one', site: hits[0], how }
    if (hits.length <= MAX_CHOICES) return { status: 'many', sites: [...hits].sort(byName), how }
    return { status: 'tooMany', count: hits.length }
  }

  const code = codeKey(q.replace(/\s+/g, ''))
  const byCode = list.filter((s) => s.code != null && codeKey(s.code) === code && code)
  if (byCode.length) return decide(byCode, 'code')

  const key = nameKey(q)
  if (key) {
    const exact = list.filter((s) => nameKey(s.name) === key)
    if (exact.length) return decide(exact, 'name')

    // A one- or two-character fragment matches the directory. Require every
    // word to be long enough, and require all of them — dropping the short
    // word would make "n hub" match every hub.
    const want = key.split(' ')
    if (want.length && want.every((w) => w.length >= 3)) {
      const contains = list.filter((s) => {
        const name = nameKey(s.name)
        return name && want.every((w) => name.includes(w))
      })
      if (contains.length) return decide(contains, 'contains')
    }
  }

  const fq = fuzzyKey(q)
  if (fq.length >= 3) {
    const scored = list
      .map((s) => ({ s, score: dice(fq, fuzzyKey(s.name)) }))
      .filter((x) => x.score >= FUZZY_FLOOR)
      .sort((a, b) => b.score - a.score || byName(a.s, b.s))
    if (scored.length === 1) return { status: 'one', site: scored[0].s, how: 'fuzzy' }
    if (scored.length > 1) {
      // A clear winner is an answer; a field of near-equals is a choice.
      if (scored[0].score >= 0.85 && scored[0].score - scored[1].score >= 0.2) {
        return { status: 'one', site: scored[0].s, how: 'fuzzy' }
      }
      if (scored.length > MAX_CHOICES) return { status: 'tooMany', count: scored.length }
      return { status: 'many', sites: scored.map((x) => x.s), how: 'fuzzy' }
    }
  }
  return { status: 'none' }
}

/**
 * Dice of the query against one name word. A short token inside a longer
 * query is not a suggestion: "demo" inside "demo002" would offer every centre
 * whose name merely starts with the same syllable as a code.
 */
function wordScore(query, word) {
  if (word.length < 3 || query.length < 3) return 0
  // More than two characters apart: "demo" inside "demo002" would offer every
  // centre that merely shares a syllable with a code.
  if (Math.abs(word.length - query.length) > 2) return 0
  return dice(query, word)
}

/** Best Dice score of the query against the name and against each of its words. */
export function nameSimilarity(query, name) {
  const fq = fuzzyKey(query)
  if (fq.length < 3) return 0
  const target = fuzzyKey(name)
  if (!target) return 0
  let best = dice(fq, target)
  for (const w of target.split(' ')) {
    const score = wordScore(fq, w)
    if (score > best) best = score
  }
  return best
}

/**
 * Closest centre names when nothing matched. Only sites in `sites` — the
 * caller passes the reachable set, and a suggestion of a centre outside it
 * would confirm that centre exists. Never an automatic answer.
 */
export function closestSites(query, sites = [], limit = SUGGEST_LIMIT) {
  const list = (sites || []).filter((s) => s && s.id)
  if (fuzzyKey(query).length < 3 || !list.length) return []
  return list
    .map((s) => ({ s, score: nameSimilarity(query, s.name) }))
    .filter((x) => x.score >= SUGGEST_FLOOR)
    .sort((a, b) => b.score - a.score || byName(a.s, b.s))
    .slice(0, limit)
    .map((x) => x.s)
}

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
//                 "0071" keeps its zeros
//   2. name       the normalised name (case, punctuation, the word "gym")
//   3. contains   every word of the query appears in the name ("koramangala")
//   4. fuzzy      Dice over character bigrams of the sorted words, floor 0.5,
//                 the same scoring the app's suggestSite uses
// One hit is the answer. Two to ten is a list to pick from. More than ten asks
// for the code.
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_CHOICES = 10
export const FUZZY_FLOOR = 0.5

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

    const want = key.split(' ')
    const contains = list.filter((s) => {
      const have = new Set(words(s.name))
      return want.every(
        (w) => have.has(w) || [...have].some((h) => h.startsWith(w) && w.length >= 4)
      )
    })
    if (contains.length) return decide(contains, 'contains')
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
      return { status: 'many', sites: scored.slice(0, MAX_CHOICES).map((x) => x.s), how: 'fuzzy' }
    }
  }
  return { status: 'none' }
}

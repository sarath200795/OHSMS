// ─────────────────────────────────────────────────────────────────────────────
// Document IDs: MODULE-ORG_0001.
//
// Every record the app generates gets one, in one shape, so that a permit, an
// incident and an audit finding can all be quoted in an email, written on a
// paper form, or read down a phone line without ambiguity about which system
// they came from or which of thirteen modules owns them.
//
// Short codes on both sides rather than full names. "Permit to Work-Acme
// Corporation_0001" is the same information, but it will not fit in a column,
// cannot be a filename without escaping, and nobody reads it aloud correctly.
// PTW-ACME_0001 survives all three.
//
// The counter is continuous per module per org and never resets. A per-year
// counter means two records can share a number, and every consumer then has to
// carry the year to stay unambiguous — which is exactly what this format exists
// to avoid.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Module → code. These are permanent: an id already written on a paper permit
 * or quoted in a closed incident cannot be re-pointed at a different module, so
 * a code here may be added but never repurposed.
 */
export const DOC_CODES = {
  incidents: 'INC',
  illnesses: 'ILL',
  hira: 'HIRA',
  inspections: 'INSP',
  audit: 'AUD',
  auditFindings: 'AUDF',
  ptw: 'PTW',
  observations: 'OBS',
  loto: 'LOTO',
  drills: 'DRL',
  committee: 'HSE',
  training: 'TRN',
  trainingSessions: 'TRNS',
  documents: 'DOC',
  emergency: 'ERP',
  objectives: 'OBJ',
}
// Equipment is deliberately absent. An extinguisher already carries FE-0001 and
// an AED an asset tag; those identify a physical thing that was bought, not a
// document that was generated, and giving them a second number would mean two
// answers to "which unit is this".

/** Human labels, for the admin screen that lists the counters. */
export const DOC_KIND_LABEL = {
  incidents: 'Incidents',
  illnesses: 'Occupational illnesses',
  hira: 'Risk assessments',
  inspections: 'Inspections',
  audit: 'Audit plans',
  auditFindings: 'Audit findings',
  ptw: 'Work permits',
  observations: 'Observations',
  loto: 'LOTO procedures',
  drills: 'Mock drills',
  committee: 'Committee meetings',
  training: 'Training courses',
  trainingSessions: 'Training sessions',
  documents: 'Documents & SDS',
  emergency: 'Emergency response plans',
  objectives: 'Objectives & targets',
}

export const SEQ_PAD = 4

// Suffixes that say what kind of company it is, not which company. Stripping
// them is what turns "Acme Corporation Pvt Ltd" into ACME rather than ACMEC.
const NOISE = new Set([
  'LTD', 'LIMITED', 'PVT', 'PRIVATE', 'INC', 'INCORPORATED', 'LLP', 'LLC',
  'PLC', 'CO', 'COMPANY', 'CORP', 'CORPORATION', 'GROUP', 'HOLDINGS',
  'INDUSTRIES', 'ENTERPRISES', 'SOLUTIONS', 'SERVICES', 'THE', 'AND',
])

/**
 * A short code for an organisation, derived from its name.
 *
 * A first word long enough to stand alone becomes the code, because that is
 * what people already call the company. Only when it is too short to be
 * recognisable do initials make a better handle.
 *
 * This is a starting point, not a rule — orgs can set their own in settings,
 * which is why nothing here tries to guarantee global uniqueness.
 */
export function deriveOrgCode(name) {
  const words = String(name || '')
    .toUpperCase()
    // Apostrophes sit inside a word rather than between two, so they close up:
    // O'Brien is one name, and splitting it would yield OB instead of OBRIE.
    .replace(/['‘’]/g, '')
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

  const meaningful = words.filter((w) => !NOISE.has(w))
  const use = meaningful.length ? meaningful : words
  if (!use.length) return 'ORG'

  if (use[0].length >= 3) return use[0].slice(0, 5)
  // "AB Industries" reads better as ABI than as AB.
  const initials = use.map((w) => w[0]).join('')
  return (initials.length >= 2 ? initials : use[0]).slice(0, 5)
}

/** Normalise a code an admin typed: uppercase, alphanumeric, 2–5 characters. */
export function normalizeOrgCode(value) {
  const clean = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5)
  return clean.length >= 2 ? clean : ''
}

/** `INC-ACME_0042`. */
export function formatDocId(kind, orgCode, seq) {
  const code = DOC_CODES[kind] || String(kind || 'DOC').toUpperCase()
  const org = normalizeOrgCode(orgCode) || 'ORG'
  return `${code}-${org}_${String(Math.max(1, Number(seq) || 1)).padStart(SEQ_PAD, '0')}`
}

/**
 * Read an id back apart. Returns null for anything that is not one of ours —
 * including the older `IRA-2026-0001` reference numbers, which are deliberately
 * not parsed as though they were.
 */
export function parseDocId(value) {
  const m = /^([A-Z]{2,6})-([A-Z0-9]{2,5})_(\d{1,9})$/.exec(String(value || '').trim())
  if (!m) return null
  const [, code, orgCode, digits] = m
  const kind = Object.keys(DOC_CODES).find((k) => DOC_CODES[k] === code) || null
  return { code, kind, orgCode, seq: Number(digits) }
}

/** Sequence numbers already used for a kind, so a backfill can continue past them. */
export function highestSeq(ids = []) {
  let max = 0
  for (const id of ids) {
    const p = parseDocId(id)
    if (p && p.seq > max) max = p.seq
  }
  return max
}

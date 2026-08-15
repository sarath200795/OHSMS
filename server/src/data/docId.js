// ─────────────────────────────────────────────────────────────────────────────
// `INSP-ACME_0042` — the document id format, ported.
//
// THIS IS A COPY, AND THAT IS THE DECISION. The original is
// src/shared/docId/format.js and it stays the source of truth: the browser
// still formats ids for every module that has not moved to this server yet, and
// both sides have to produce the same string or one org ends up with two
// numbering schemes and two records claiming INSP-ACME_0007.
//
// It is copied rather than imported because the container build context is
// server/ (see Dockerfile) — a relative import reaching up into src/ resolves
// on a developer's machine and is simply absent from the image, which is a
// crash on the first inspection submitted in production and nowhere before it.
// Vendoring one 40-line pure function is the cheaper of the two failures.
//
// WHAT KEEPS THE COPY HONEST: docId.test.js asserts this file against the same
// expectations as the original, and any change to the format lands in both
// files or the suite fails. Only the pure formatting half is here; the counter
// itself lives in docSeq.js, because on a server it is a transaction rather
// than a cached read.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Module → code, copied verbatim from src/shared/docId/format.js.
 *
 * These are permanent: an id already written on a paper permit or quoted in a
 * closed incident cannot be re-pointed at a different module, so a code here
 * may be added but never repurposed.
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
  escalations: 'CE',
  legalIssues: 'LEG',
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

/**
 * `INSP-ACME_0042`.
 *
 * The one deliberate deviation from the original: `Object.hasOwn` rather than a
 * bare `DOC_CODES[kind]`. That literal inherits from Object.prototype, so
 * `DOC_CODES['constructor']` is the Object CONSTRUCTOR — truthy, so the `||`
 * fallback never fires and the id is built by interpolating a function into a
 * string. It changes nothing for any of the eighteen real kinds (docId.test.js
 * proves that against the same table), and it is the same inherited-key trap
 * that was a live authorization bypass in src/authz/policy.js.
 */
export function formatDocId(kind, orgCode, seq) {
  const code = (Object.hasOwn(DOC_CODES, kind) && DOC_CODES[kind]) || String(kind || 'DOC').toUpperCase()
  const org = normalizeOrgCode(orgCode) || 'ORG'
  return `${code}-${org}_${String(Math.max(1, Number(seq) || 1)).padStart(SEQ_PAD, '0')}`
}

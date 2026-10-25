// ─────────────────────────────────────────────────────────────────────────────
// One spelling for a WhatsApp handset.
//
// Meta's webhook `from` is the wa_id: country code plus the subscriber
// number, digits only, no '+'. For the mobiles this deployment serves that
// is `91` and then ten digits (`9177…`). The same handset was also being
// stored as the admin typed it — `+91 77…`, `0091…`, `91` plus a trunk `0`,
// or the ten digits alone. `waLinks/{from}` is an exact document id, so the
// message was logged uid:null, orgId:null, outcome:'unknown' for a number
// that was already linked.
//
// canonicalWaId is what a new write uses. waIdLookupKeys is what a read
// tries, canonical first and then those older spellings, so a row that
// already exists is still found. A 10-digit number that is not an Indian
// mobile is still refused: inventing a different country code would bind
// someone else's handset.
// ─────────────────────────────────────────────────────────────────────────────

const INDIAN_MOBILE = /^[6-9]\d{9}$/

function digitsOf(input) {
  if (input == null || typeof input === 'object') return ''
  const compact = String(input)
    .normalize('NFKC')
    .trim()
    .replace(/[\s().-]/g, '')
  // A sentence that merely contains the digits is not a handset.
  if (!/^\+?\d{8,16}$/.test(compact)) return ''
  let digits = compact.replace(/^\+/, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.startsWith('0')) digits = digits.slice(1)
  return digits
}

/** Meta's wa_id, or '' when `input` is not a handset. */
export function canonicalWaId(input) {
  const digits = digitsOf(input)
  if (!digits) return ''
  if (/^91[6-9]\d{9}$/.test(digits)) return digits
  // `91` plus a national trunk zero: `910` + the 10-digit mobile.
  if (/^910[6-9]\d{9}$/.test(digits)) return `91${digits.slice(3)}`
  if (INDIAN_MOBILE.test(digits)) return `91${digits}`
  // Another country, already in international form (11–15 digits). A bare
  // 10-digit number that is not an Indian mobile is not guessed.
  if (/^[1-9]\d{10,14}$/.test(digits)) return digits
  return ''
}

/**
 * Document ids that can be this handset. Canonical first. The `+` forms are
 * only for rows written before the id was stripped. Every key is one path
 * segment.
 */
export function waIdLookupKeys(input) {
  const keys = []
  const add = (value) => {
    const key = String(value || '')
    if (!key || keys.includes(key) || key.includes('/')) return
    if (!/^\+?\d{8,16}$/.test(key)) return
    keys.push(key)
  }
  const canonical = canonicalWaId(input)
  add(canonical)
  const digits = digitsOf(input)
  add(digits)
  if (digits) add(`+${digits}`)
  if (canonical) add(`+${canonical}`)
  if (/^91[6-9]\d{9}$/.test(canonical)) {
    const national = canonical.slice(2)
    add(national)
    add(`0${national}`)
    add(`910${national}`)
    add(`00${canonical}`)
    add(`+91${national}`)
  }
  return keys
}

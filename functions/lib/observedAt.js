// The clock printed next to a weather reading.
//
// The provider stamps UTC. The digest window, the sites and the mail are
// Asia/Kolkata, which is UTC+05:30 all year. Formatting here, rather than
// with the machine's local zone, keeps the screen, the phone and the mail on
// one label for one instant.

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `23 Sep, 16:30 IST`, or '' when the value is not a timestamp. */
export function formatObservedAt(value) {
  const ms = observedAtMs(value)
  if (!Number.isFinite(ms)) return ''
  const ist = new Date(ms + IST_OFFSET_MS)
  const hh = String(ist.getUTCHours()).padStart(2, '0')
  const mm = String(ist.getUTCMinutes()).padStart(2, '0')
  return `${ist.getUTCDate()} ${MONTHS[ist.getUTCMonth()]}, ${hh}:${mm} IST`
}

export function asOfLabel(value) {
  const formatted = formatObservedAt(value)
  return formatted ? `As of ${formatted}` : ''
}

export function observedAtMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const text = String(value || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) return NaN
  // No zone means UTC. A bare timestamp must not shift with the machine's zone,
  // or the mail and a laptop in another country would disagree.
  const zoned = /Z$|[+-]\d{2}:\d{2}$/.test(text) ? text : `${text.replace(/\.\d+$/, '')}Z`
  const ms = Date.parse(zoned)
  return Number.isFinite(ms) ? ms : NaN
}

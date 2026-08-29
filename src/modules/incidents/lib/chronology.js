// ─────────────────────────────────────────────────────────────────────────────
// The chronology of the event.
//
// An investigation diagram answers "why". It cannot answer "in what order", and
// that is the question every serious review asks first: what was happening at
// 06:40, when did the operator notice, how long before the line was stopped,
// when did first aid arrive. A 5-Why built on a sequence nobody wrote down is
// built on somebody's memory of the sequence.
//
// So the incident carries a timeline of its own — one row per established fact,
// each with a moment and, where it matters, where the fact came from (a CCTV
// clip, a shift log, a witness statement). "Where from" is what separates a
// chronology that survives contact with a regulator from a narrative.
//
// Kept as plain data on the incident document, ordered on READ rather than on
// write: rows are typed in the order people remember them, not the order they
// happened, and re-sorting the list under someone's cursor while they type is
// the sort of helpfulness that loses an entry.
// ─────────────────────────────────────────────────────────────────────────────

/** A stable-enough id for a row that only ever has to be unique in one array. */
const rid = () =>
  (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10))

/** An empty row, dated to the incident so the common case needs no typing. */
export function blankChronologyEntry(incident = {}) {
  return {
    id: `chr_${rid()}`,
    date: incident.incidentDate || '',
    time: '',
    event: '',
    source: '',
  }
}

/**
 * An incident's chronology as an array, whatever the document actually holds.
 *
 * Defensive in the same way incidentInvestigations() is: this field did not
 * exist for the first years of the register, so every incident raised before it
 * has no key at all, and a report that renders `undefined.map` is a report that
 * cannot be printed for the incidents that most need printing.
 */
export function incidentChronology(incident) {
  const rows = Array.isArray(incident?.chronology) ? incident.chronology : []
  return rows
    .filter((r) => r && typeof r === 'object')
    .map((r, i) => ({
      id: String(r.id || `chr_${i}`),
      date: String(r.date || ''),
      time: String(r.time || ''),
      event: String(r.event || ''),
      source: String(r.source || ''),
    }))
}

/**
 * The sort key for a row: 'YYYY-MM-DDTHH:MM'.
 *
 * A row with a date and no time sorts to the START of its day rather than
 * being pushed to the end of it — "the 14th, time unknown" belongs before
 * "the 14th at 09:12" in a reader's mind, and the alternative buries an
 * undated-but-known event after everything that happened after it.
 */
export function chronologyMoment(row) {
  const date = String(row?.date || '')
  if (!date) return ''
  const time = /^\d{1,2}:\d{2}/.test(String(row?.time || '')) ? String(row.time) : '00:00'
  // Zero-pad a single-digit hour so string comparison stays chronological:
  // '9:05' sorts after '10:05' otherwise, which is exactly backwards.
  return `${date}T${time.length === 4 ? `0${time}` : time}`
}

/**
 * Rows in the order they happened, undated ones last in the order they were
 * entered.
 *
 * Undated rows are kept, not dropped. "We do not know when the alarm was
 * silenced" is a finding; deleting the row because it has no timestamp deletes
 * the finding along with the gap it records.
 */
export function sortChronology(rows = []) {
  return rows
    .map((row, i) => ({ row, i, key: chronologyMoment(row) }))
    .sort((a, b) => {
      if (a.key && b.key) return a.key < b.key ? -1 : a.key > b.key ? 1 : a.i - b.i
      if (a.key) return -1
      if (b.key) return 1
      return a.i - b.i
    })
    .map((x) => x.row)
}

/** How a row's moment reads in a report: '14 Mar 2026 · 09:12', or 'Time not established'. */
export function formatChronologyMoment(row) {
  const date = String(row?.date || '')
  const time = String(row?.time || '')
  if (!date) return time ? `Date not established · ${time}` : 'Time not established'
  // Parsed as a plain date, not a Date — 'YYYY-MM-DD' through `new Date()` is
  // read as UTC midnight and prints as the previous day for anyone west of
  // Greenwich, which on an incident record is a factual error.
  const [y, m, d] = date.split('-')
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const month = MONTHS[Number(m) - 1]
  const readable = month ? `${Number(d)} ${month} ${y}` : date
  return time ? `${readable} · ${time}` : readable
}

/**
 * Rows worth saving: anything with something written in the event column.
 *
 * The editor always keeps one empty row at the bottom so there is somewhere to
 * type, and saving that row would put a blank line into every printed report.
 */
export const meaningfulChronology = (rows = []) =>
  rows.filter((r) => String(r?.event || '').trim().length > 0)

/**
 * The elapsed span the chronology covers, as a plain string, or '' when fewer
 * than two rows carry a moment. Printed under the table because "the whole
 * thing took eleven minutes" is the fact a reader takes away from it.
 */
export function chronologySpan(rows = []) {
  const moments = sortChronology(rows).map(chronologyMoment).filter(Boolean)
  if (moments.length < 2) return ''
  const ms = Date.parse(`${moments[moments.length - 1]}:00`) - Date.parse(`${moments[0]}:00`)
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const mins = Math.round(ms / 60000)
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`
  const hours = Math.floor(mins / 60)
  const rem = mins % 60
  if (hours < 24) return `${hours}h${rem ? ` ${rem}m` : ''}`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'}${hours % 24 ? ` ${hours % 24}h` : ''}`
}

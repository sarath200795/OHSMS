// ─────────────────────────────────────────────────────────────────────────────
// When a defect was reported.
//
// `updatedAt` cannot answer this. It moves every time anyone renames a camera
// or corrects an IP address, so a lens smeared in March would read as reported
// in July because someone fixed a typo — and every month chart built on it
// would be wrong in a way nobody could see. `defectReportedOn` is the day the
// fault was found, and only ever moves when the defects do.
//
// Pure and clock-free: `today` is passed in, so a test never depends on the day
// it runs and the same rules can be replayed against any date.
// ─────────────────────────────────────────────────────────────────────────────

const ISO = /^\d{4}-\d{2}-\d{2}$/

/**
 * A stored report date, or '' for anything that is not a plain YYYY-MM-DD.
 *
 * Everything that is not a date becomes '' rather than throwing: the records
 * that predate this field have nothing in it at all, and they must survive a
 * read, not break one.
 */
export const asReportedOn = (v) => {
  const s = String(v ?? '').trim()
  return ISO.test(s) ? s : ''
}

/** Today in local time — the day the person filling the form is having, not UTC's. */
export function todayISO(today = new Date()) {
  const tz = today.getTimezoneOffset() * 60000
  return new Date(today.getTime() - tz).toISOString().slice(0, 10)
}

/**
 * The report date to carry after a device's defect list is edited.
 *
 * Raising the first defect on a clean device dates it today, because that is
 * nearly always right and nobody would type it otherwise. Clearing the last one
 * blanks it, so a date never outlives the fault it describes.
 *
 * Everything else keeps what is already there — including blank. Adding a
 * second defect to a device does not re-date the first, and a record that
 * arrived without a date is left without one rather than being given today's:
 * defects are routinely entered days after the walk-round that found them, and
 * an invented date is indistinguishable from a recorded one once it is stored.
 */
export function nextReportedOn({ before = [], after = [], current = '', today = new Date() } = {}) {
  if (!after.length) return ''
  if (!before.length) return todayISO(today)
  return asReportedOn(current)
}

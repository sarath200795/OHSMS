import { daysUntil, toDate, hasQuotation } from './extinguisherLogic'
import { DUE_SOON_DAYS } from './constants'

/**
 * Hydrostatic pressure testing.
 *
 * A refill and an HPT are different events wearing similar clothes. A refill is
 * consumable — the unit is emptied and recharged. An HPT is a pressure test of
 * the cylinder itself, done on a multi-year cycle, and it can CONDEMN the
 * cylinder. So "get a vendor quotation" is the wrong first step for a unit whose
 * HPT has come due: what has to be recorded is the test and its certificate.
 */

/** The interval most jurisdictions use for a portable extinguisher cylinder. */
export const HPT_INTERVAL_YEARS = 5

export const HPT_RESULT = { PASS: 'pass', FAIL: 'fail' }

/**
 * True when this unit is on the To Be Refilled list BECAUSE of its HPT.
 *
 * Same window the list itself uses — due, or due within DUE_SOON_DAYS — so the
 * button offered on a row cannot disagree with the reason the row is there.
 */
export function isHptDue(ext, today = new Date()) {
  const days = daysUntil(ext?.dateOfNextHPT, today)
  return days !== null && days <= DUE_SOON_DAYS
}

/**
 * The default next-due date: the test date plus the cycle.
 *
 * Formatted from the local calendar fields rather than through toISOString().
 * toDate() yields LOCAL midnight, and toISOString() converts to UTC — so
 * anywhere east of Greenwich the result came back a day early, which on a
 * five-year interval is a silently wrong compliance date nobody would query.
 */
export function nextHptDate(testedOn, years = HPT_INTERVAL_YEARS) {
  const d = toDate(testedOn)
  if (!d) return ''
  const next = new Date(d)
  next.setFullYear(next.getFullYear() + years)
  const mm = String(next.getMonth() + 1).padStart(2, '0')
  const dd = String(next.getDate()).padStart(2, '0')
  return `${next.getFullYear()}-${mm}-${dd}`
}

/** A test is recorded once, with its certificate. */
export function hasHpt(ext) {
  return Boolean(ext?.hpt && ext.hpt.submittedAt)
}

/**
 * Validate a submission. Returns an error string, or '' when it is good.
 *
 * A passed test must name the date it was next due, because that date is what
 * takes the unit off the list — accepting a pass without one would quietly
 * leave it due forever while looking handled.
 */
export function validateHpt({ testedOn, result, nextDueOn, vendor } = {}) {
  if (!toDate(testedOn)) return 'Enter the date the test was carried out'
  if (toDate(testedOn) > new Date()) return 'The test date is in the future'
  if (!String(vendor || '').trim()) return 'Name the agency that carried out the test'
  if (result !== HPT_RESULT.PASS && result !== HPT_RESULT.FAIL) return 'Record whether the cylinder passed or failed'
  if (result === HPT_RESULT.PASS && !toDate(nextDueOn)) return 'Enter when the next test falls due'
  if (result === HPT_RESULT.PASS && toDate(nextDueOn) <= toDate(testedOn)) {
    return 'The next test must fall due after the test date'
  }
  return ''
}

/**
 * What a submission changes on the extinguisher.
 *
 * THE SAFETY PROPERTY: a FAILED test does not move dateOfNextHPT. A failed
 * hydrostatic test condemns the cylinder — it must not be refilled or returned
 * to service — so advancing the due date would take a condemned unit off the
 * due list and make it read as compliant for another five years. On a failure
 * the date is left exactly where it was, so the unit stays on the list until
 * somebody deals with it.
 */
export function hptUpdate({ result, nextDueOn }) {
  const passed = result === HPT_RESULT.PASS
  return passed ? { dateOfNextHPT: nextDueOn } : {}
}

/** Short human summary for the audit trail and the row chip. */
export function hptSummary({ testedOn, result, vendor } = {}) {
  const verdict = result === HPT_RESULT.PASS ? 'passed' : 'FAILED'
  return `HPT ${verdict} on ${testedOn || 'unknown date'}${vendor ? ` · ${vendor}` : ''}`
}

/**
 * What the workflow needs from this unit before it can move on.
 *
 * THE RULE IS HERE, ONCE, because it was not. RefillDue asked HPT-due units for
 * the test; PhysicalDefects and Repository asked the same units for a vendor
 * quotation, because each page decided for itself and two of them did not know
 * about the test. So the same cylinder was told two different things depending
 * on which list you reached it from.
 *
 * HPT OUTRANKS QUOTATION, and not as a matter of taste. A hydrostatic test can
 * CONDEMN the cylinder. Until it has passed, the unit can neither be refilled
 * nor returned to service with a defect repaired — so a quotation raised first
 * buys work on a cylinder that may be scrap, and worse, resolving against that
 * quotation marks the unit as handled while the test is still outstanding.
 *
 * The test settles the question. Everything else waits for it.
 */
export const WORKFLOW_STEP = { HPT: 'hpt', QUOTATION: 'quotation', NONE: 'none' }

export function requiredStep(ext, today = new Date()) {
  if (isHptDue(ext, today)) return WORKFLOW_STEP.HPT
  if (!hasQuotation(ext)) return WORKFLOW_STEP.QUOTATION
  return WORKFLOW_STEP.NONE
}

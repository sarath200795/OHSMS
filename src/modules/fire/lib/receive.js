// ─────────────────────────────────────────────────────────────────────────────
// An extinguisher comes back from the vendor.
//
// Sending it out (markReceivedByVendor) is the only half the register had.
// "In Process of Refilling" then waited on Refilled & closed, which also
// rewrites the hydrostatic-test date. A recharge is not a pressure test —
// hpt.js keeps those apart because a test can condemn the cylinder — so
// receiving the unit back sets it Active, records the day it was received,
// and moves the next refill date. dateOfNextHPT is left where it is: a unit
// whose test is still overdue stays overdue.
//
// The next refill date has to move. isToBeRefilled treats an Active unit with
// a past dateOfNextRefill as due again, so a return that only flipped the
// status put the cylinder straight back on To Be Refilled, which is the list
// it had just left the building to get off.
// ─────────────────────────────────────────────────────────────────────────────
import { STATUS } from './constants'
import { toDate } from './extinguisherLogic'
import { isFutureDate } from '../../../shared/lib/dates'
import { refillDefectsOf } from './defectClosure'
import { HPT_RESULT, validateHpt } from './hpt'

/**
 * Dates for "Refilled & closed".
 *
 * Both have to fall after today. A next-refill date of today or earlier puts
 * an Active unit straight back on To Be Refilled — the list it just left —
 * and a next-HPT date that is not in the future leaves the hydrostatic defect
 * open while the success toast says the dates were updated. The form used to
 * accept any non-empty string.
 */
export function validateRefilledClosed({ dateOfNextRefill, dateOfNextHPT } = {}, today) {
  const refill = typeof dateOfNextRefill === 'string' ? dateOfNextRefill : ''
  const hpt = typeof dateOfNextHPT === 'string' ? dateOfNextHPT : ''
  if (!toDate(refill) || !toDate(hpt)) return 'Enter both new due dates'
  if (!isFutureDate(refill, today) || !isFutureDate(hpt, today)) {
    return 'The new due dates must be after today'
  }
  return ''
}

/** True when the close is not claiming a different hydrostatic due date. */
export function hptDateUnchanged(stored, next) {
  return String(stored || '').trim() === String(next || '').trim()
}

/**
 * A new hydrostatic date on Refilled & closed is a passed test.
 *
 * The button's job is to bring a refilled unit back. Recording a later
 * hydrostatic date in the same step is a claim that the cylinder was tested,
 * and that claim is what Submit HPT exists to evidence. Leaving the stored
 * date where it is needs nothing extra. Changing it needs the certificate,
 * the agency, and a test date — the same facts a passed test records — and
 * the certificate's next-due date is the date being written.
 */
export function validateRefilledHpt(storedDate, { dateOfNextHPT, certificate } = {}) {
  if (hptDateUnchanged(storedDate, dateOfNextHPT)) return ''
  const fileName = String(certificate?.fileName || '').trim()
  const hasFile = Boolean(certificate?.fileData || certificate?.fileUrl || certificate?.filePath)
  if (!fileName || !hasFile) {
    return 'Attach the hydrostatic-test certificate for the new due date'
  }
  return validateHpt({
    testedOn: certificate?.testedOn,
    result: HPT_RESULT.PASS,
    nextDueOn: dateOfNextHPT,
    vendor: certificate?.vendor,
  })
}

export function validateReceive({ receivedOn, dateOfNextRefill } = {}) {
  if (!toDate(receivedOn)) return 'Enter the date the extinguisher was received back'
  if (isFutureDate(receivedOn)) return 'The received date is in the future'
  if (!toDate(dateOfNextRefill)) return 'Enter the new next refill date'
  if (String(dateOfNextRefill) <= String(receivedOn)) {
    return 'The next refill must fall due after the received date'
  }
  return ''
}

/**
 * The extinguisher fields a receive writes, or an error string when it must not.
 * `clearedDefects` is what the closure log records in the same commit.
 */
export function receiveFromVendorUpdate(ext, input = {}) {
  if (!ext) return { error: 'Extinguisher not found', updates: null, clearedDefects: [] }
  if (ext.deletedAt) {
    return { error: 'That unit is in Recently deleted.', updates: null, clearedDefects: [] }
  }
  if (ext.status !== STATUS.IN_PROCESS_REFILLING) {
    return {
      error: 'Only a unit that is with the vendor can be marked received.',
      updates: null,
      clearedDefects: [],
    }
  }
  const error = validateReceive(input)
  if (error) return { error, updates: null, clearedDefects: [] }

  const clearedDefects = refillDefectsOf(ext)
  const current = Array.isArray(ext.physicalDefects) ? ext.physicalDefects : []
  return {
    error: '',
    clearedDefects,
    updates: {
      status: STATUS.ACTIVE,
      receivedAt: input.receivedOn,
      lastRefilledAt: input.receivedOn,
      dateOfNextRefill: input.dateOfNextRefill,
      physicalDefects: current.filter((k) => !clearedDefects.includes(k)),
      quotation: null,
    },
  }
}

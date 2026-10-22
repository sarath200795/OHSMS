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

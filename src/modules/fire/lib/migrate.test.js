import { describe, it, expect } from 'vitest'
import { statusFromLabel, defectsFromCondition } from './exporter'
import { STATUS } from './constants'

describe('statusFromLabel', () => {
  it('round-trips every exported status label', () => {
    expect(statusFromLabel('Active')).toBe(STATUS.ACTIVE)
    expect(statusFromLabel('To Be Refilled')).toBe(STATUS.TO_BE_REFILLED)
    expect(statusFromLabel('In Process of Refilling')).toBe(STATUS.IN_PROCESS_REFILLING)
    expect(statusFromLabel('Refilled & Closed')).toBe(STATUS.CLOSED)
  })

  it('ignores casing and padding from a spreadsheet cell', () => {
    expect(statusFromLabel('  to be refilled ')).toBe(STATUS.TO_BE_REFILLED)
  })

  it('defaults a blank or unknown status to active', () => {
    for (const v of ['', '   ', null, undefined, 'Something Else']) {
      expect(statusFromLabel(v)).toBe(STATUS.ACTIVE)
    }
  })
})

describe('defectsFromCondition', () => {
  it('maps a real defect label to its stored key', () => {
    expect(defectsFromCondition('Empty')).toEqual(['empty'])
    expect(defectsFromCondition('Over Pressurized')).toEqual(['over_pressurized'])
    expect(defectsFromCondition('PIN')).toEqual(['pin'])
    expect(defectsFromCondition('Hose Pipe Damage')).toEqual(['hose_pipe'])
  })

  it('treats Healthy as no defects', () => {
    expect(defectsFromCondition('Healthy')).toEqual([])
  })

  it('ignores conditions derived from dates rather than stored', () => {
    // These are recomputed from the dates that migrate across; storing them as
    // defects would double-count and wrongly mark a unit physically damaged.
    for (const v of ['HPT Overdue', 'Refill Overdue', 'HPT Due Soon', 'Refill Due Soon']) {
      expect(defectsFromCondition(v), v).toEqual([])
    }
  })

  it('ignores workflow states that are statuses, not defects', () => {
    expect(defectsFromCondition('In Process of Refilling')).toEqual([])
    expect(defectsFromCondition('Refilled & Closed')).toEqual([])
  })

  it('returns nothing for blanks', () => {
    for (const v of ['', '  ', null, undefined]) expect(defectsFromCondition(v)).toEqual([])
  })

  it('ignores casing', () => {
    expect(defectsFromCondition('  empty ')).toEqual(['empty'])
  })
})

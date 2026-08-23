import { describe, it, expect } from 'vitest'
import {
  isHptDue, nextHptDate, hasHpt, validateHpt, hptUpdate, hptSummary, requiredStep, WORKFLOW_STEP,
  HPT_RESULT, HPT_INTERVAL_YEARS,
} from './hpt'

const TODAY = new Date('2026-06-15T00:00:00Z')
const iso = (d) => d.toISOString().slice(0, 10)
const inDays = (n) => iso(new Date(TODAY.getTime() + n * 86400000))

describe('knowing an HPT is what put the unit on the list', () => {
  it('is due when the date has passed, or falls inside the 30-day window', () => {
    expect(isHptDue({ dateOfNextHPT: inDays(-1) }, TODAY)).toBe(true)
    expect(isHptDue({ dateOfNextHPT: iso(TODAY) }, TODAY)).toBe(true)
    expect(isHptDue({ dateOfNextHPT: inDays(30) }, TODAY)).toBe(true)
  })

  it('is not due beyond that window', () => {
    expect(isHptDue({ dateOfNextHPT: inDays(31) }, TODAY)).toBe(false)
  })

  // A unit with no date is a data problem, flagged elsewhere as a date issue.
  // Claiming its HPT is due would put a made-up test on a real cylinder.
  it('says nothing about a unit with no date at all', () => {
    expect(isHptDue({}, TODAY)).toBe(false)
    expect(isHptDue({ dateOfNextHPT: '' }, TODAY)).toBe(false)
    expect(isHptDue(null, TODAY)).toBe(false)
  })
})

describe('the next test date', () => {
  it('defaults to the cycle after the test', () => {
    expect(nextHptDate('2026-06-15')).toBe(`${2026 + HPT_INTERVAL_YEARS}-06-15`)
  })

  it('accepts a different interval', () => {
    expect(nextHptDate('2026-06-15', 10)).toBe('2036-06-15')
  })

  it('returns nothing for a date it cannot read', () => {
    expect(nextHptDate('')).toBe('')
    expect(nextHptDate('not a date')).toBe('')
  })
})

describe('validating a submission', () => {
  const good = {
    testedOn: '2026-06-01',
    result: HPT_RESULT.PASS,
    nextDueOn: '2031-06-01',
    vendor: 'Acme Testing',
  }

  it('accepts a complete pass', () => {
    expect(validateHpt(good)).toBe('')
  })

  it('accepts a failure without a next date, because there is no next', () => {
    expect(validateHpt({ ...good, result: HPT_RESULT.FAIL, nextDueOn: '' })).toBe('')
  })

  it('needs a readable test date, and refuses one in the future', () => {
    expect(validateHpt({ ...good, testedOn: '' })).toMatch(/date the test was carried out/i)
    expect(validateHpt({ ...good, testedOn: '2099-01-01' })).toMatch(/future/i)
  })

  it('needs the agency named', () => {
    expect(validateHpt({ ...good, vendor: '   ' })).toMatch(/agency/i)
  })

  it('needs an explicit verdict — not a blank that reads as a pass', () => {
    expect(validateHpt({ ...good, result: '' })).toMatch(/passed or failed/i)
    expect(validateHpt({ ...good, result: 'maybe' })).toMatch(/passed or failed/i)
  })

  // Without this a pass could be filed with no next date, leaving the unit due
  // forever while the record says it was handled.
  it('needs a pass to say when the next one falls due, and to be after this one', () => {
    expect(validateHpt({ ...good, nextDueOn: '' })).toMatch(/next test falls due/i)
    expect(validateHpt({ ...good, nextDueOn: '2020-01-01' })).toMatch(/after the test date/i)
  })

  it('does not throw on nothing at all', () => {
    expect(validateHpt()).toBeTruthy()
  })
})

// The reason this module exists rather than a couple of lines in the modal.
describe('what a submission changes on the cylinder', () => {
  it('moves the next-due date on a pass', () => {
    expect(hptUpdate({ testedOn: '2026-06-01', result: HPT_RESULT.PASS, nextDueOn: '2031-06-01' }))
      .toEqual({ dateOfNextHPT: '2031-06-01' })
  })

  // A failed hydrostatic test condemns the cylinder. Advancing the date would
  // drop a condemned unit off the due list and let it read as compliant for
  // another five years — the single worst thing this feature could do.
  it('leaves the date alone on a failure, so the unit stays on the list', () => {
    expect(hptUpdate({ testedOn: '2026-06-01', result: HPT_RESULT.FAIL, nextDueOn: '2031-06-01' }))
      .toEqual({})
  })

  it('says plainly in the trail which of the two happened', () => {
    expect(hptSummary({ testedOn: '2026-06-01', result: HPT_RESULT.PASS, vendor: 'Acme' }))
      .toBe('HPT passed on 2026-06-01 · Acme')
    expect(hptSummary({ testedOn: '2026-06-01', result: HPT_RESULT.FAIL, vendor: 'Acme' }))
      .toContain('FAILED')
  })
})

describe('whether a test has been recorded', () => {
  it('is true only once it has actually been submitted', () => {
    expect(hasHpt({})).toBe(false)
    expect(hasHpt({ hpt: {} })).toBe(false)
    expect(hasHpt({ hpt: { submittedAt: '2026-06-01' } })).toBe(true)
  })
})

// The rule three pages disagreed about. RefillDue asked an HPT-due unit for the
// test; Physical Defects and the Repository asked the same unit for a vendor
// quotation, because each decided for itself. These pin the order so a fourth
// list cannot quietly invent a fourth answer.
describe('what the workflow asks a unit for next', () => {
  const quoted = { quotation: { submittedAt: '2026-06-01' } }

  it('asks for the TEST when the hydrostatic test is due', () => {
    expect(requiredStep({ dateOfNextHPT: inDays(-40) }, TODAY)).toBe(WORKFLOW_STEP.HPT)
    expect(requiredStep({ dateOfNextHPT: iso(TODAY) }, TODAY)).toBe(WORKFLOW_STEP.HPT)
  })

  it('asks for a quotation when no test is due and none has been submitted', () => {
    expect(requiredStep({ dateOfNextHPT: inDays(400) }, TODAY)).toBe(WORKFLOW_STEP.QUOTATION)
    expect(requiredStep({}, TODAY)).toBe(WORKFLOW_STEP.QUOTATION)
  })

  it('asks for nothing once a quotation is in and no test is due', () => {
    expect(requiredStep({ dateOfNextHPT: inDays(400), ...quoted }, TODAY)).toBe(WORKFLOW_STEP.NONE)
  })

  // The whole point. A cylinder that may be condemned must not have money spent
  // on repairing it, and a quotation already on file must not let it past.
  it('still asks for the TEST even when a quotation has already been submitted', () => {
    expect(requiredStep({ dateOfNextHPT: inDays(-1), ...quoted }, TODAY)).toBe(WORKFLOW_STEP.HPT)
  })

  it('uses the same window as the list itself, so no row disagrees with its own reason', () => {
    // DUE_SOON_DAYS is 30: inside it the test is asked for, outside it is not.
    expect(requiredStep({ dateOfNextHPT: inDays(30) }, TODAY)).toBe(WORKFLOW_STEP.HPT)
    expect(requiredStep({ dateOfNextHPT: inDays(31) }, TODAY)).toBe(WORKFLOW_STEP.QUOTATION)
  })

  it('a unit with no HPT date recorded is not treated as due', () => {
    expect(requiredStep({ dateOfNextHPT: '' }, TODAY)).toBe(WORKFLOW_STEP.QUOTATION)
    expect(requiredStep(null, TODAY)).toBe(WORKFLOW_STEP.QUOTATION)
  })
})

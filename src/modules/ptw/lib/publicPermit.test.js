import { describe, it, expect } from 'vitest'
import {
  crewSummary, withdrawnFields, liveFields, mirrorDisplayFields, isTerminal, TERMINAL_STATUSES,
} from './publicPermit'
import { STATUS } from './permitStatus'

const approved = { status: 'approved', by: 'x', at: '2026-01-01' }

// A live permit: both teams approved, inside its window.
const live = {
  permitNo: 'PTW-9',
  typeOfWork: 'Hot Work',
  jobLocation: 'Bay C',
  jobDescription: 'Weld the guard rail',
  issuedToName: 'R. Osei',
  issuingDepartment: 'Maintenance',
  hazards: ['Fire'],
  ppe: ['Face shield'],
  engineering: approved,
  operations: approved,
  validFrom: '2020-01-01T00:00:00.000Z',
  validTo: '2099-01-01T00:00:00.000Z',
  participants: [
    { name: 'A. Smith', company: 'Contractor Ltd', type: 'contractor' },
    { name: 'B. Jones', company: 'Contractor Ltd', type: 'contractor' },
  ],
  fireWatchers: [{ name: 'C. Watch' }],
  confinedWatcher: { name: 'D. Confined' },
  createdByName: 'E. Planner',
}

const NAMES = ['A. Smith', 'B. Jones', 'C. Watch', 'D. Confined', 'E. Planner', 'Contractor Ltd']

describe('the crew is published as a count, never a roster', () => {
  it('counts participants, fire watchers and the confined-space watcher', () => {
    expect(crewSummary(live)).toEqual({
      participantCount: 2, fireWatcherCount: 1, hasConfinedWatcher: true,
    })
  })

  it('copes with a permit carrying none of them', () => {
    expect(crewSummary({})).toEqual({
      participantCount: 0, fireWatcherCount: 0, hasConfinedWatcher: false,
    })
    expect(() => crewSummary()).not.toThrow()
  })

  it('does not trust the shape it is given', () => {
    expect(crewSummary({ participants: 'nonsense', fireWatchers: null }).participantCount).toBe(0)
  })
})

// The test this file exists for. Anything naming a person on an unauthenticated
// URL is a privacy incident, and the count is the safety-relevant fact anyway:
// "four people are meant to be in there" is what a rescue needs.
describe('no name reaches the public mirror', () => {
  it('publishes none of the crew, in the live half', () => {
    const wire = JSON.stringify(liveFields(live))
    for (const name of NAMES) expect(wire, name).not.toContain(name)
    expect(wire).not.toContain('createdByName')
    expect(wire).not.toContain('participants')
    expect(wire).not.toContain('fireWatchers')
  })

  // The one name that does work on a public page: challenging the job means
  // asking whether the person in front of you is who it was issued to.
  it('keeps the permit holder, who the physical permit names anyway', () => {
    expect(liveFields(live).issuedToName).toBe('R. Osei')
  })

  it('still carries what somebody at the barrier needs', () => {
    expect(liveFields(live)).toMatchObject({
      typeOfWork: 'Hot Work',
      jobLocation: 'Bay C',
      jobDescription: 'Weld the guard rail',
      hazards: ['Fire'],
      ppe: ['Face shield'],
      participantCount: 2,
      withdrawn: false,
    })
  })
})

describe('the job detail is withdrawn when the job is over', () => {
  it('names closed and closed-for-non-compliance as terminal, and nothing else', () => {
    expect(TERMINAL_STATUSES).toEqual([STATUS.CLOSED, STATUS.CLOSED_NONCOMPLIANCE])
    expect(isTerminal(STATUS.IN_PROGRESS)).toBe(false)
    // Expired is NOT terminal here: an expired permit that was never closed is
    // exactly the one somebody should still be able to read and challenge.
    expect(isTerminal(STATUS.NOT_CLOSED)).toBe(false)
  })

  it('blanks every describing field, and says so', () => {
    const w = withdrawnFields()
    expect(w.withdrawn).toBe(true)
    expect(w.jobDescription).toBe('')
    expect(w.issuedToName).toBe('')
    expect(w.hazards).toEqual([])
    expect(w.participantCount).toBe(0)
  })

  // Blanked, not deleted: the mirror is merged into from a path that has no
  // orgId, and a full replace would fail the security rule.
  it('blanks rather than omits, so a merge actually clears the old values', () => {
    const w = withdrawnFields()
    for (const k of ['jobDescription', 'jobLocation', 'issuedToName', 'hazards', 'ppe', 'jsa']) {
      expect(Object.prototype.hasOwnProperty.call(w, k), k).toBe(true)
    }
  })

  it('withdraws a closed permit and leaves a live one alone', () => {
    const closed = {
      ...live,
      closure: { engineering: approved, operations: approved },
    }
    expect(mirrorDisplayFields(closed).withdrawn).toBe(true)
    expect(mirrorDisplayFields(closed).jobDescription).toBe('')
    expect(mirrorDisplayFields(live).withdrawn).toBe(false)
    expect(mirrorDisplayFields(live).jobDescription).toBe('Weld the guard rail')
  })

  it('withdraws one closed for non-compliance', () => {
    expect(mirrorDisplayFields({ ...live, closedDueToObservation: { at: 'now' } }).withdrawn).toBe(true)
  })

  it('leaks no name in the withdrawn half either', () => {
    const closed = { ...live, closure: { engineering: approved, operations: approved } }
    const wire = JSON.stringify(mirrorDisplayFields(closed))
    for (const name of NAMES) expect(wire, name).not.toContain(name)
    expect(wire).not.toContain('R. Osei')
  })
})

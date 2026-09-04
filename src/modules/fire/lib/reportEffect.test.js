import { describe, it, expect } from 'vitest'
import { reportEffect } from './reportEffect'
import { STATUS, REFILL_DEFECT_KEYS } from './constants'

const REFILL = REFILL_DEFECT_KEYS[0]

describe('a defect report', () => {
  it('adds the defect', () => {
    const u = reportEffect({ physicalDefects: [] }, { kind: 'defect', defectType: 'dented' })
    expect(u.physicalDefects).toEqual(['dented'])
  })

  it('KEEPS a defect another approver added a moment ago', () => {
    // The whole reason this is computed from the just-read document. Two people
    // clearing the pending queue used to each write their own version of this
    // array, and one reported fault vanished.
    const u = reportEffect({ physicalDefects: ['hose-perished'] }, { kind: 'defect', defectType: 'dented' })
    expect(u.physicalDefects).toEqual(['hose-perished', 'dented'])
  })

  it('does not duplicate a defect already recorded', () => {
    const u = reportEffect({ physicalDefects: ['dented'] }, { kind: 'defect', defectType: 'dented' })
    expect(u.physicalDefects).toEqual(['dented'])
  })

  it('survives a unit with no defects field at all', () => {
    const u = reportEffect({}, { kind: 'defect', defectType: 'dented' })
    expect(u.physicalDefects).toEqual(['dented'])
  })

  it('sends the unit for refill when the defect calls for one', () => {
    const u = reportEffect({ status: STATUS.ACTIVE }, { kind: 'defect', defectType: REFILL })
    expect(u.status).toBe(STATUS.TO_BE_REFILLED)
  })

  it('leaves the status alone for a defect that does not call for a refill', () => {
    const u = reportEffect({ status: STATUS.ACTIVE }, { kind: 'defect', defectType: 'dented' })
    expect(u.status).toBeUndefined()
  })

  it('does NOT re-queue a unit that has already been refilled and closed', () => {
    // Approving a stale defect on a unit back in service would put a working
    // extinguisher into the refill queue.
    const u = reportEffect({ status: STATUS.CLOSED }, { kind: 'defect', defectType: REFILL })
    expect(u.status).toBeUndefined()
  })

  it('ignores a defect report that names no defect', () => {
    expect(reportEffect({ physicalDefects: [] }, { kind: 'defect' })).toEqual({})
  })
})

describe('a status change report', () => {
  it('sets the requested status', () => {
    const u = reportEffect({ status: STATUS.ACTIVE }, { kind: 'status_change', newStatus: STATUS.CLOSED })
    expect(u).toEqual({ status: STATUS.CLOSED })
  })

  it('touches no defects', () => {
    const u = reportEffect(
      { status: STATUS.ACTIVE, physicalDefects: ['dented'] },
      { kind: 'status_change', newStatus: STATUS.CLOSED },
    )
    expect(u.physicalDefects).toBeUndefined()
  })

  it('ignores one that names no status', () => {
    expect(reportEffect({ status: STATUS.ACTIVE }, { kind: 'status_change' })).toEqual({})
  })
})

describe('anything else', () => {
  it('changes nothing for an unknown kind', () => {
    expect(reportEffect({ status: STATUS.ACTIVE }, { kind: 'something_new' })).toEqual({})
  })

  it('returns an empty patch rather than throwing on missing arguments', () => {
    expect(reportEffect(null, null)).toEqual({})
    expect(reportEffect({}, undefined)).toEqual({})
  })
})

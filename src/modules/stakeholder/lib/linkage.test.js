import { describe, it, expect } from 'vitest'
import { legalByEscalation, withLegal, withEscalation, worstNotice, summarise, repeatMembers } from './linkage'

const esc = (o = {}) => ({ id: 'e1', status: 'open', members: [], ...o })
const leg = (o = {}) => ({ id: 'l1', status: 'open', noticeType: 'none', escalationId: '', ...o })

describe('legalByEscalation', () => {
  it('groups legal issues under the escalation they came from', () => {
    const map = legalByEscalation([leg({ escalationId: 'e1' }), leg({ id: 'l2', escalationId: 'e1' }), leg({ id: 'l3', escalationId: 'e2' })])
    expect(map.get('e1')).toHaveLength(2)
    expect(map.get('e2')).toHaveLength(1)
  })

  it('ignores legal issues that came from no complaint', () => {
    expect(legalByEscalation([leg(), leg({ escalationId: '  ' })]).size).toBe(0)
  })
})

describe('withLegal', () => {
  // A resolved complaint that produced an FIR is not resolved in any sense the
  // business cares about, and a status column alone would say it was.
  it('marks an escalation that became a regulatory matter', () => {
    const [row] = withLegal([esc({ status: 'resolved' })], [leg({ escalationId: 'e1', noticeType: 'fir' })])
    expect(row).toMatchObject({ escalated: true, legalCount: 1, openLegal: 1, worstNotice: 'fir' })
    expect(row.severeNotices).toEqual(['fir'])
  })

  it('leaves an ordinary escalation alone', () => {
    const [row] = withLegal([esc()], [])
    expect(row).toMatchObject({ escalated: false, legalCount: 0, worstNotice: null })
  })

  it('counts only legal issues still needing action as open', () => {
    const [row] = withLegal([esc()], [
      leg({ escalationId: 'e1', status: 'closed' }),
      leg({ id: 'l2', escalationId: 'e1', status: 'responded' }),
    ])
    expect(row).toMatchObject({ legalCount: 2, openLegal: 1 })
  })

  it('does not treat a routine inspection report as severe', () => {
    const [row] = withLegal([esc()], [leg({ escalationId: 'e1', noticeType: 'inspection_report' })])
    expect(row.severeNotices).toEqual([])
    expect(row.escalated).toBe(true)
  })
})

describe('worstNotice', () => {
  // Ranked by position in NOTICE_TYPES, so there is no second severity table.
  it('picks the most serious of a set', () => {
    expect(worstNotice(['none', 'show_cause', 'fir'])).toBe('fir')
    expect(worstNotice(['verbal', 'challan'])).toBe('challan')
    expect(worstNotice(['sealing', 'summons'])).toBe('sealing')
  })

  it('returns null for nothing', () => {
    expect(worstNotice([])).toBeNull()
    expect(worstNotice(['not-a-notice'])).toBeNull()
  })
})

describe('withEscalation', () => {
  it('attaches the originating complaint', () => {
    const [row] = withEscalation([leg({ escalationId: 'e1' })], [esc({ docId: 'CE-ACME_0001' })])
    expect(row.escalation).toMatchObject({ id: 'e1', docId: 'CE-ACME_0001' })
    expect(row.brokenLink).toBe(false)
  })

  it('leaves a standalone legal issue unlinked', () => {
    const [row] = withEscalation([leg()], [esc()])
    expect(row.escalation).toBeNull()
    expect(row.brokenLink).toBe(false)
  })

  // "No customer complaint" and "the complaint was deleted" are different facts.
  it('flags a link whose escalation no longer exists', () => {
    const [row] = withEscalation([leg({ escalationId: 'gone' })], [esc()])
    expect(row).toMatchObject({ escalation: null, brokenLink: true })
  })
})

describe('summarise', () => {
  it('counts both sides and the crossover', () => {
    const s = summarise(
      [esc(), esc({ id: 'e2', status: 'closed' }), esc({ id: 'e3', status: 'in_progress' })],
      [leg({ escalationId: 'e1', noticeType: 'fir' }), leg({ id: 'l2', status: 'closed', noticeType: 'none' })]
    )
    expect(s.escalations).toMatchObject({ total: 3, open: 2, escalatedToLegal: 1 })
    expect(s.legal).toMatchObject({ total: 2, open: 1, severe: 1, fromEscalation: 1 })
  })

  it('is all zeroes for an empty module', () => {
    const s = summarise()
    expect(s.escalations.total).toBe(0)
    expect(s.legal.total).toBe(0)
  })
})

describe('repeatMembers', () => {
  // A member raising their fourth complaint is a different conversation from
  // one raising their first, and no single record can show that.
  it('finds members appearing in more than one escalation', () => {
    const rows = repeatMembers([
      esc({ id: 'e1', members: [{ memberId: 'M-1', name: 'Ravi' }, { memberId: 'M-2', name: 'Priya' }] }),
      esc({ id: 'e2', members: [{ memberId: 'M-1', name: 'Ravi' }] }),
      esc({ id: 'e3', members: [{ memberId: 'M-1', name: 'Ravi' }] }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ memberId: 'M-1', name: 'Ravi', count: 3 })
    expect(rows[0].escalationIds).toEqual(['e1', 'e2', 'e3'])
  })

  it('falls back to the name when no member id was captured', () => {
    const rows = repeatMembers([
      esc({ id: 'e1', members: [{ name: 'Walk-in guest' }] }),
      esc({ id: 'e2', members: [{ name: 'Walk-in guest' }] }),
    ])
    expect(rows[0]).toMatchObject({ name: 'Walk-in guest', count: 2 })
  })

  it('ignores blank member rows', () => {
    expect(repeatMembers([esc({ members: [{}, { memberId: '  ' }] })])).toEqual([])
  })

  it('honours the minimum', () => {
    const two = [esc({ id: 'e1', members: [{ memberId: 'M-1' }] })]
    expect(repeatMembers(two)).toEqual([])
    expect(repeatMembers(two, 1)).toHaveLength(1)
  })
})

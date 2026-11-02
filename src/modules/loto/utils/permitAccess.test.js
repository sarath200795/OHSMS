import { describe, expect, it } from 'vitest'
import { isNamedOnPermit, otherApproverExists, reachesPermitSite } from './permitAccess'

const permit = { siteId: 's1', entity: 'Ent', requestedBy: 'req', personnelUids: ['crew'] }

describe('reachesPermitSite', () => {
  it('lets an unrestricted admin reach every permit', () => {
    expect(reachesPermitSite({ role: 'admin', status: 'approved' }, permit)).toBe(true)
  })

  it('lets an admin of the site or the entity, and not a region-only admin', () => {
    expect(reachesPermitSite({ role: 'admin', status: 'approved', siteId: 's1' }, permit)).toBe(true)
    expect(reachesPermitSite({ role: 'admin', status: 'approved', access: { sites: ['s1'] } }, permit)).toBe(true)
    expect(reachesPermitSite({ role: 'admin', status: 'approved', access: { entities: ['Ent'] } }, permit)).toBe(true)
    expect(reachesPermitSite({ role: 'admin', status: 'approved', siteId: 's2' }, permit)).toBe(false)
    expect(reachesPermitSite({ role: 'admin', status: 'approved', access: { regions: ['South'] } }, permit)).toBe(false)
  })

  it('does not treat a manager as an approver', () => {
    expect(reachesPermitSite({ role: 'manager', status: 'approved' }, permit)).toBe(false)
  })
})

describe('who is named', () => {
  it('counts the requester and the crew', () => {
    expect(isNamedOnPermit('req', permit)).toBe(true)
    expect(isNamedOnPermit('crew', permit)).toBe(true)
    expect(isNamedOnPermit('adm', permit)).toBe(false)
  })

  it('ignores a named colleague when asking whether anyone else can approve', () => {
    const users = [
      { uid: 'crew', role: 'admin', status: 'approved' },
      { uid: 'away', role: 'admin', status: 'approved', siteId: 's9' },
      { uid: 'here', role: 'admin', status: 'approved', siteId: 's1' },
    ]
    expect(otherApproverExists(users, permit)).toBe(true)
    expect(otherApproverExists(users.filter((u) => u.uid !== 'here'), permit)).toBe(false)
  })
})

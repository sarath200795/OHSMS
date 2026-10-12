import { describe, it, expect } from 'vitest'
import { isActiveMember, reachableSites } from './access.js'

const sites = [
  { id: 's1', name: 'A', region: 'South', entity: 'E1' },
  { id: 's2', name: 'B', region: 'North', entity: 'E1' },
  { id: 's3', name: 'C', region: 'North', entity: 'E2' },
]

describe('isActiveMember', () => {
  const ok = { orgId: 'o1', status: 'approved' }
  it('requires the org, approval and an own password', () => {
    expect(isActiveMember(ok, 'o1')).toBe(true)
    expect(isActiveMember(ok, 'o2')).toBe(false)
    expect(isActiveMember({ ...ok, status: 'suspended' }, 'o1')).toBe(false)
    expect(isActiveMember({ ...ok, status: 'pending' }, 'o1')).toBe(false)
    expect(isActiveMember({ orgId: 'o1' }, 'o1')).toBe(false)
    expect(isActiveMember({ ...ok, mustChangePassword: true }, 'o1')).toBe(false)
    expect(isActiveMember(null, 'o1')).toBe(false)
  })
})

describe('reachableSites', () => {
  const ids = (u) => reachableSites(u, sites).map((s) => s.id)
  it('gives admins every site', () => expect(ids({ role: 'admin' })).toEqual(['s1', 's2', 's3']))
  it('follows home site and site, region and entity grants', () => {
    expect(ids({ role: 'member', siteId: 's1' })).toEqual(['s1'])
    expect(ids({ role: 'manager', access: { sites: ['s3'] } })).toEqual(['s3'])
    expect(ids({ role: 'member', access: { regions: ['North'] } })).toEqual(['s2', 's3'])
    expect(ids({ role: 'auditor', access: { entities: ['E1'] } })).toEqual(['s1', 's2'])
  })
  it('gives nothing to a profile with no grant, and treats "" as no grant', () => {
    expect(ids({ role: 'member' })).toEqual([])
    expect(ids({ role: 'member', access: { regions: [''] } })).toEqual([])
  })
})

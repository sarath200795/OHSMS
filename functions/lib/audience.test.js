import { describe, it, expect } from 'vitest'
import {
  reachesScope,
  selectScopedAudience,
  selectActiveAudience,
  grantList,
  scopeFrom,
} from './audience.js'
import { user } from '../test-support/memoryDb.js'

const SCOPE = { siteId: 's1', region: 'South', entity: 'COCO' }

describe('reachesScope', () => {
  it('lets an org admin reach every scope, including one with no site', () => {
    expect(reachesScope(user('a', { role: 'admin' }), SCOPE)).toBe(true)
    expect(reachesScope(user('a', { role: 'admin' }), {})).toBe(true)
  })

  it('matches a posting, a site grant, a region grant and an entity grant', () => {
    expect(reachesScope(user('p', { siteId: 's1' }), SCOPE)).toBe(true)
    expect(reachesScope(user('s', { access: { sites: ['s1'] } }), SCOPE)).toBe(true)
    expect(reachesScope(user('r', { access: { regions: ['South'] } }), SCOPE)).toBe(true)
    expect(reachesScope(user('e', { access: { entities: ['COCO'] } }), SCOPE)).toBe(true)
  })

  it('does not treat a manager as elevated, and does not match an empty-string grant', () => {
    expect(reachesScope(user('m', { role: 'manager' }), SCOPE)).toBe(false)
    expect(
      reachesScope(user('b', { access: { regions: [''] } }), { siteId: 's1', region: '' })
    ).toBe(false)
    expect(reachesScope(user('b', { siteId: '' }), { siteId: 's1' })).toBe(false)
  })

  it('gives a record with no site, region or entity to admins only', () => {
    expect(reachesScope(user('m', { role: 'manager', access: { sites: ['s1'] } }), {})).toBe(false)
    expect(reachesScope(user('a', { role: 'admin' }), { siteId: '', region: '', entity: '' })).toBe(
      true
    )
  })

  it('fills region from the site document when the record only stored a site id', () => {
    const scope = scopeFrom(
      { siteId: 's1' },
      { id: 's1', region: 'South', entity: 'COCO', name: 'Plant' }
    )
    expect(scope).toMatchObject({
      siteId: 's1',
      region: 'South',
      entity: 'COCO',
      siteName: 'Plant',
    })
    expect(reachesScope(user('r', { access: { regions: ['South'] } }), scope)).toBe(true)
  })

  it('drops a sealed site name instead of copying the envelope into the scope', () => {
    const scope = scopeFrom({ centerName: 'enc:1:general:abc:ciphertext' }, null)
    expect(scope.siteName).toBe('')
    expect(grantList(['', '  ', 's1'])).toEqual(['s1'])
  })
})

describe('audiences', () => {
  const users = [
    user('admin', { role: 'admin', email: 'shared@example.com' }),
    user('dup', { role: 'member', email: 'shared@example.com', siteId: 's1' }),
    user('posted', { siteId: 's1' }),
    user('other', { siteId: 's9' }),
    user('pending', { siteId: 's1', status: 'pending' }),
    user('suspended', { role: 'admin', status: 'suspended', email: 'off@example.com' }),
    user('foreign', { orgId: 'orgB', role: 'admin', email: 'foreign@example.com' }),
    user('nope', { siteId: 's1', email: 'not-an-email' }),
  ]

  it('keeps admins and grants, drops everyone else, and dedupes a shared mailbox by uid', () => {
    const rows = selectScopedAudience(users, 'orgA', SCOPE)
    expect(rows.map((r) => r.uid)).toEqual(['admin', 'posted'])
  })

  it('includes every approved address in the org for the weather digest', () => {
    const rows = selectActiveAudience(users, 'orgA')
    expect(rows.map((r) => r.uid).sort()).toEqual(['admin', 'other', 'posted'])
  })
})

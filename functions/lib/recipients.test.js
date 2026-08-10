import { describe, it, expect } from 'vitest'
import { resolveRecipient, resolveRecipients, resolveByRole, limitToSite, isReachable } from './recipients.js'

const u = (over = {}) => ({ uid: 'u1', name: 'Ravi Kumar', email: 'ravi@acme.test', status: 'approved', role: 'user', ...over })

describe('isReachable', () => {
  it('requires an approved account with an address', () => {
    expect(isReachable(u())).toBe(true)
    expect(isReachable(u({ status: 'pending' }))).toBe(false)
    expect(isReachable(u({ email: '' }))).toBe(false)
  })

  it('honours an explicit opt-out but treats absence as consent', () => {
    expect(isReachable(u({ notificationsEnabled: false }))).toBe(false)
    expect(isReachable(u({ notificationsEnabled: undefined }))).toBe(true)
  })
})

describe('resolveRecipient', () => {
  const users = [u(), u({ uid: 'u2', name: 'Priya S', email: 'priya@acme.test' })]

  it('trusts a uid', () => {
    expect(resolveRecipient({ uid: 'u2' }, users)).toMatchObject({ uid: 'u2', confidence: 'uid' })
  })

  it('matches an email case-insensitively', () => {
    expect(resolveRecipient({ email: 'PRIYA@acme.test' }, users)).toMatchObject({ uid: 'u2' })
  })

  it('accepts a name that belongs to exactly one person', () => {
    expect(resolveRecipient({ name: '  ravi kumar ' }, users)).toMatchObject({ uid: 'u1', confidence: 'name' })
  })

  // The reason this module exists.
  it('sends nothing when a name is ambiguous', () => {
    const twoRavis = [...users, u({ uid: 'u3', email: 'ravi.k@acme.test' })]
    expect(resolveRecipient({ name: 'Ravi Kumar' }, twoRavis)).toBeNull()
  })

  it('sends nothing for an unknown name, rather than guessing the closest', () => {
    expect(resolveRecipient({ name: 'R. Kumar' }, users)).toBeNull()
    expect(resolveRecipient({ name: 'safety team' }, users)).toBeNull()
  })

  it('ignores unreachable people even on an exact uid hit', () => {
    expect(resolveRecipient({ uid: 'u1' }, [u({ status: 'pending' })])).toBeNull()
  })

  it('prefers a uid over a contradicting name', () => {
    expect(resolveRecipient({ uid: 'u2', name: 'Ravi Kumar' }, users)).toMatchObject({ uid: 'u2' })
  })

  it('survives empty and malformed input', () => {
    expect(resolveRecipient(null, users)).toBeNull()
    expect(resolveRecipient({}, users)).toBeNull()
    expect(resolveRecipient({ name: '   ' }, users)).toBeNull()
    expect(resolveRecipient({ uid: 'u1' }, [])).toBeNull()
  })
})

describe('resolveRecipients', () => {
  const users = [u(), u({ uid: 'u2', name: 'Priya S', email: 'priya@acme.test' })]

  it('de-duplicates the same person reached two ways', () => {
    const out = resolveRecipients([{ uid: 'u1' }, { name: 'Ravi Kumar' }, { email: 'ravi@acme.test' }], users)
    expect(out).toHaveLength(1)
  })

  it('keeps the resolvable ones when others are ambiguous', () => {
    const out = resolveRecipients([{ uid: 'u1' }, { name: 'nobody' }], users)
    expect(out.map((r) => r.uid)).toEqual(['u1'])
  })
})

describe('resolveByRole', () => {
  const users = [u({ role: 'admin' }), u({ uid: 'u2', role: 'user', email: 'a@b.test' }), u({ uid: 'u3', role: 'admin', email: 'c@d.test', status: 'pending' })]

  it('returns approved holders of the requested roles only', () => {
    expect(resolveByRole(users, ['admin']).map((r) => r.uid)).toEqual(['u1'])
  })

  it('accepts several roles', () => {
    expect(resolveByRole(users, ['admin', 'user']).map((r) => r.uid)).toEqual(['u1', 'u2'])
  })
})

describe('limitToSite', () => {
  const users = [
    u({ uid: 'admin', role: 'admin' }),
    u({ uid: 'onSite', role: 'user', siteId: 's1' }),
    u({ uid: 'granted', role: 'user', siteId: 's9', access: { sites: ['s1', 's2'] } }),
    u({ uid: 'elsewhere', role: 'user', siteId: 's9' }),
  ]
  const all = users.map((x) => ({ uid: x.uid, email: x.email, name: x.name }))

  it('keeps admins, home-site users and explicitly granted users', () => {
    expect(limitToSite(all, users, 's1').map((r) => r.uid)).toEqual(['admin', 'onSite', 'granted'])
  })

  // A notification is a read: telling someone an incident happened somewhere
  // they cannot see leaks that it happened at all.
  it('drops users with no access to the site', () => {
    expect(limitToSite(all, users, 's1').map((r) => r.uid)).not.toContain('elsewhere')
  })

  it('is a no-op when the record names no site', () => {
    expect(limitToSite(all, users, null)).toHaveLength(4)
  })
})

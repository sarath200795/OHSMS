import { describe, it, expect } from 'vitest'
import { claimsFor, claimsChanged, mergeClaims, isScoped, CLAIM_KEYS, revokesAccess, storageRights } from './claims.js'

const approved = { orgId: 'orgA', role: 'member', status: 'approved' }

describe('claimsFor', () => {
  it('gives an approved member their org and role', () => {
    expect(claimsFor(approved)).toEqual({ orgId: 'orgA', role: 'member' })
  })

  // The whole point. A pending joiner already has a /users doc naming an org —
  // that IS the waiting room — so minting a claim from it would let anyone sign
  // up naming a tenant and read its files immediately.
  it('gives a pending joiner nothing, even though their profile names an org', () => {
    expect(claimsFor({ ...approved, status: 'pending' })).toEqual({ orgId: null, role: null })
  })

  it('gives a rejected or suspended user nothing', () => {
    expect(claimsFor({ ...approved, status: 'rejected' })).toEqual({ orgId: null, role: null })
    expect(claimsFor({ ...approved, status: 'suspended' })).toEqual({ orgId: null, role: null })
  })

  // Deletion and absence must revoke, not leave the last good value in place.
  it('gives a missing profile nothing', () => {
    expect(claimsFor(null)).toEqual({ orgId: null, role: null })
    expect(claimsFor(undefined)).toEqual({ orgId: null, role: null })
    expect(claimsFor({})).toEqual({ orgId: null, role: null })
  })

  // Nulls rather than omitted keys: setCustomUserClaims replaces the object, so
  // an explicit null is what actually removes a claim.
  it('always returns every key, so a revoked claim is cleared rather than kept', () => {
    const revoked = claimsFor({ status: 'pending' })
    expect(Object.keys(revoked).sort()).toEqual([...CLAIM_KEYS].sort())
    CLAIM_KEYS.forEach((k) => expect(revoked[k]).toBeNull())
  })

  it('treats a blank or non-string orgId as no org', () => {
    expect(claimsFor({ ...approved, orgId: '   ' }).orgId).toBeNull()
    expect(claimsFor({ ...approved, orgId: 123 }).orgId).toBeNull()
    expect(claimsFor({ ...approved, orgId: null }).orgId).toBeNull()
  })

  it('trims a padded value rather than putting whitespace on the token', () => {
    expect(claimsFor({ ...approved, orgId: ' orgA ' }).orgId).toBe('orgA')
  })
})

describe('claimsChanged', () => {
  // Every write invalidates the client's token. The /users doc is written for
  // name edits and access requests too, and re-stamping identical claims would
  // churn every session in the org for nothing.
  it('is false when nothing this system owns has moved', () => {
    expect(claimsChanged({ orgId: 'orgA', role: 'member' }, { orgId: 'orgA', role: 'member' })).toBe(false)
  })

  it('ignores unrelated claims that happen to differ', () => {
    expect(claimsChanged(
      { orgId: 'orgA', role: 'member', somethingElse: 1 },
      { orgId: 'orgA', role: 'member' }
    )).toBe(false)
  })

  it('is true on a promotion', () => {
    expect(claimsChanged({ orgId: 'orgA', role: 'member' }, { orgId: 'orgA', role: 'admin' })).toBe(true)
  })

  it('is true on approval and on revocation', () => {
    expect(claimsChanged({}, { orgId: 'orgA', role: 'member' })).toBe(true)
    expect(claimsChanged({ orgId: 'orgA', role: 'member' }, { orgId: null, role: null })).toBe(true)
  })

  it('treats a missing key and an explicit null as the same', () => {
    expect(claimsChanged({ orgId: 'orgA' }, { orgId: 'orgA', role: null })).toBe(false)
    expect(claimsChanged(undefined, { orgId: null, role: null })).toBe(false)
  })
})

describe('mergeClaims', () => {
  // Claims are replaced wholesale, so anything another system put on the token
  // has to be carried across or this silently deletes it.
  it('keeps claims this system does not own', () => {
    expect(mergeClaims({ other: 'keep' }, { orgId: 'orgA', role: 'member' }))
      .toEqual({ other: 'keep', orgId: 'orgA', role: 'member' })
  })

  it('overwrites the keys it does own', () => {
    expect(mergeClaims({ orgId: 'old' }, { orgId: 'new', role: null }))
      .toEqual({ orgId: 'new', role: null })
  })

  it('copes with no existing claims', () => {
    expect(mergeClaims(null, { orgId: 'orgA' })).toEqual({ orgId: 'orgA' })
  })
})

describe('isScoped', () => {
  it('is true only with a real org on the token', () => {
    expect(isScoped({ orgId: 'orgA' })).toBe(true)
    expect(isScoped({ orgId: null })).toBe(false)
    expect(isScoped({ orgId: '  ' })).toBe(false)
    expect(isScoped(null)).toBe(false)
  })
})

// Firestore re-reads the profile on every evaluation, so revocation is instant
// there. Cloud Storage reads the TOKEN, which lives up to an hour — so a
// suspended, moved or demoted member keeps whatever their cached token claims
// unless the refresh tokens go with it.
describe('when a claim change has to end the session', () => {
  const c = (orgId, role) => ({ orgId, role })

  it('revokes when membership is withdrawn', () => {
    expect(revokesAccess(c('orgA', 'member'), c(null, null))).toBe(true)
  })

  // A stale token still names the OLD org, so until it expires the person can
  // reach the files of a tenant they have left.
  it('revokes when the member is moved to another tenant', () => {
    expect(revokesAccess(c('orgA', 'member'), c('orgB', 'member'))).toBe(true)
  })

  // storage.rules gates delete on admin/manager. A demotion that only bites at
  // the next refresh leaves an ex-manager able to destroy evidence meanwhile.
  it('revokes on a demotion out of the roles that can delete', () => {
    expect(revokesAccess(c('orgA', 'manager'), c('orgA', 'member'))).toBe(true)
    expect(revokesAccess(c('orgA', 'admin'), c('orgA', 'auditor'))).toBe(true)
  })

  // Interrupting somebody mid-task buys nothing when the change GRANTS access.
  it('does not revoke on approval or promotion', () => {
    expect(revokesAccess(c(null, null), c('orgA', 'member'))).toBe(false)
    expect(revokesAccess(c('orgA', 'member'), c('orgA', 'manager'))).toBe(false)
    expect(revokesAccess(c('orgA', 'manager'), c('orgA', 'admin'))).toBe(false)
  })

  it('does not revoke when nothing that matters moved', () => {
    expect(revokesAccess(c('orgA', 'member'), c('orgA', 'member'))).toBe(false)
    expect(revokesAccess(undefined, undefined)).toBe(false)
    expect(revokesAccess(null, c(null, null))).toBe(false)
  })

  // admin -> manager keeps the delete right, so there is nothing to close.
  it('does not revoke a demotion that keeps the same Storage rights', () => {
    expect(revokesAccess(c('orgA', 'admin'), c('orgA', 'manager'))).toBe(false)
  })

  // The gap the old ELEVATED-list version could not see. A member was never
  // elevated, so "were they admin/manager and are they no longer?" answered no
  // — while storage.rules had just stopped letting them upload. An auditor is
  // an outside party given a login to inspect the safety record, and this left
  // them able to write into the tenant for the rest of the token's hour.
  it('revokes when a member is demoted to auditor and loses the right to write', () => {
    expect(revokesAccess(c('orgA', 'member'), c('orgA', 'auditor'))).toBe(true)
  })

  // The mirror of it: an auditor promoted to member GAINS the write right, and
  // interrupting them buys nothing.
  it('does not revoke when an auditor is promoted into a writing role', () => {
    expect(revokesAccess(c('orgA', 'auditor'), c('orgA', 'member'))).toBe(false)
    expect(revokesAccess(c('orgA', 'auditor'), c('orgA', 'manager'))).toBe(false)
  })
})

// This mapping is the contract between two files that must never disagree about
// the same person. If storage.rules changes, these change with it.
describe('storageRights — what storage.rules grants a role', () => {
  it('lets everyone but the auditor write', () => {
    expect(storageRights('admin').write).toBe(true)
    expect(storageRights('manager').write).toBe(true)
    expect(storageRights('member').write).toBe(true)
    expect(storageRights('auditor').write).toBe(false)
  })

  it('lets only admin and manager delete and read medical records', () => {
    expect(storageRights('admin').remove).toBe(true)
    expect(storageRights('manager').remove).toBe(true)
    expect(storageRights('member').remove).toBe(false)
    expect(storageRights('auditor').remove).toBe(false)
  })

  // Mirrors the deployed rule rather than the intent: `myRole() != 'auditor'`
  // is TRUE for the empty string a pre-claims token yields. Modelling it as
  // false would be a nicer story and a lie about what is enforced.
  it('reports an absent role exactly as the deployed rule evaluates it', () => {
    expect(storageRights(null)).toEqual({ write: true, remove: false })
    expect(storageRights(undefined)).toEqual({ write: true, remove: false })
    expect(storageRights('')).toEqual({ write: true, remove: false })
  })
})

import { describe, it, expect } from 'vitest'
import { claimsFor, claimsChanged, mergeClaims, isScoped, CLAIM_KEYS } from './claims.js'

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

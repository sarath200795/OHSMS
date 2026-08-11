// ─────────────────────────────────────────────────────────────────────────────
// The staged tenant-isolated storage rules (storage.rules.next).
//
// These are NOT the rules currently deployed. They are the ones that replace
// storage.rules once every user carries an orgId claim, and this file is how we
// know they behave before that swap rather than after it — the swap is the step
// that locks an organization out of its own files if it is wrong.
//
// What makes this testable at all: the rules-unit-testing harness mints ID
// tokens with arbitrary custom claims, which is exactly what syncUserClaims
// puts on a real token. So the token shapes below are the real ones — an
// approved member's, a pending joiner's, a revoked member's — not stand-ins.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { ref, uploadBytes, getBytes, deleteObject } from 'firebase/storage'

const __dirname = dirname(fileURLToPath(import.meta.url))
const A = 'orgA'
const B = 'orgB'

let testEnv

const bytes = (n = 8) => new Uint8Array(n)
const p = (org, name = 'evidence.jpg') => `orgs/${org}/incidents/${name}`

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'ohsms-demo',
    storage: { rules: readFileSync(join(__dirname, '..', 'storage.rules.next'), 'utf8') },
  })
})

afterAll(async () => { await testEnv?.cleanup() })

beforeEach(async () => {
  await testEnv.clearStorage()
  // Seed one file per org, bypassing rules, so reads have something to find —
  // otherwise a 404 would be indistinguishable from a refusal.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await uploadBytes(ref(ctx.storage(), p(A)), bytes())
    await uploadBytes(ref(ctx.storage(), p(B)), bytes())
  })
})

// An approved member of org A, as syncUserClaims would stamp them.
const memberOfA = () => testEnv.authenticatedContext('alice', { orgId: A, role: 'member' }).storage()
const memberOfB = () => testEnv.authenticatedContext('bob', { orgId: B, role: 'member' }).storage()
// Signed in, but carrying no org — a pending joiner, a revoked member, or
// anyone whose claim has not been stamped yet.
const unstamped = () => testEnv.authenticatedContext('mallory').storage()
const anonymous = () => testEnv.unauthenticatedContext().storage()

describe('a member reaches their own org and nothing else', () => {
  it('reads their own org files', async () => {
    await assertSucceeds(getBytes(ref(memberOfA(), p(A))))
  })

  it('uploads into their own org', async () => {
    await assertSucceeds(uploadBytes(ref(memberOfA(), p(A, 'new.jpg')), bytes()))
  })

  it('deletes their own org files', async () => {
    await assertSucceeds(deleteObject(ref(memberOfA(), p(A))))
  })

  // The hole this whole exercise exists to close.
  it('CANNOT read another tenant files', async () => {
    await assertFails(getBytes(ref(memberOfA(), p(B))))
  })

  it('CANNOT delete another tenant files', async () => {
    await assertFails(deleteObject(ref(memberOfA(), p(B))))
  })

  it('CANNOT upload into another tenant prefix', async () => {
    await assertFails(uploadBytes(ref(memberOfA(), p(B, 'planted.jpg')), bytes()))
  })

  it('works symmetrically for the other tenant', async () => {
    await assertSucceeds(getBytes(ref(memberOfB(), p(B))))
    await assertFails(getBytes(ref(memberOfB(), p(A))))
  })
})

// The failure mode that makes the cutover order matter. Everyone looks like
// this until backfillClaims has run.
describe('a token with no orgId claim reaches nothing', () => {
  it('cannot read', async () => {
    await assertFails(getBytes(ref(unstamped(), p(A))))
  })

  it('cannot upload', async () => {
    await assertFails(uploadBytes(ref(unstamped(), p(A, 'x.jpg')), bytes()))
  })

  it('cannot delete', async () => {
    await assertFails(deleteObject(ref(unstamped(), p(A))))
  })

  // A claim naming an org that is not the one in the path is no better than
  // none — it is the comparison that authorises, not the presence of a claim.
  it('cannot use a claim for a different org', async () => {
    const wrong = testEnv.authenticatedContext('eve', { orgId: 'orgZ' }).storage()
    await assertFails(getBytes(ref(wrong, p(A))))
  })
})

describe('the unauthenticated public reaches nothing', () => {
  it('cannot read or write', async () => {
    await assertFails(getBytes(ref(anonymous(), p(A))))
    await assertFails(uploadBytes(ref(anonymous(), p(A, 'x.jpg')), bytes()))
  })
})

describe('the limits that survived from the permissive rules', () => {
  it('refuses an upload over 20 MB', async () => {
    await assertFails(uploadBytes(ref(memberOfA(), p(A, 'huge.bin')), bytes(21 * 1024 * 1024)))
  })

  it('allows one comfortably under it', async () => {
    await assertSucceeds(uploadBytes(ref(memberOfA(), p(A, 'small.bin')), bytes(1024)))
  })

  // Every upload lands on a random path, so nothing legitimately overwrites —
  // and denying it is what stops evidence being replaced in place.
  it('refuses overwriting a file that already exists', async () => {
    await assertFails(uploadBytes(ref(memberOfA(), p(A)), bytes(16)))
  })

  it('closes every path outside the org prefix', async () => {
    await assertFails(uploadBytes(ref(memberOfA(), 'loose/file.jpg'), bytes()))
    await assertFails(uploadBytes(ref(memberOfA(), `orgs/${A}/too/deep/nested.jpg`), bytes()))
  })
})

// Guards the cutover itself: if this file ever stops differing from the live
// ruleset, the staged copy has been swapped in and this suite is testing
// production rather than a proposal.
describe('staging', () => {
  it('is still staged — storage.rules has not been replaced yet', () => {
    const live = readFileSync(join(__dirname, '..', 'storage.rules'), 'utf8')
    const next = readFileSync(join(__dirname, '..', 'storage.rules.next'), 'utf8')
    if (live.includes('request.auth.token.orgId')) {
      // The swap has happened. Delete storage.rules.next and this block.
      expect(live).toContain('request.auth.token.orgId')
    } else {
      expect(next).toContain('request.auth.token.orgId')
      expect(live).not.toContain('request.auth.token.orgId')
    }
  })
})

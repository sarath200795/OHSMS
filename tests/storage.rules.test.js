// ─────────────────────────────────────────────────────────────────────────────
// Tenant isolation in Cloud Storage — the live rules.
//
// These were written and proved here BEFORE they were deployed, because the
// deploy is the step that locks an organization out of its own files if the
// rules are wrong. They are live now.
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
    storage: { rules: readFileSync(join(__dirname, '..', 'storage.rules'), 'utf8') },
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

  // Was `assertSucceeds`, and that assertion was the vulnerability written
  // down: Storage granted delete on org membership alone while Firestore
  // required a manager for the same act. Deletion now needs the same standing
  // in both places — see the role block at the foot of this file.
  it('CANNOT delete their own org files — that takes a manager', async () => {
    await assertFails(deleteObject(ref(memberOfA(), p(A))))
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

// ─────────────────────────────────────────────────────────────────────────────
// The role dimension, which this suite never exercised — every context above
// mints role:'member', which is why the two enforcement surfaces could disagree
// about the same person unnoticed.
//
// Firestore refuses an auditor every write and requires a manager to delete.
// Storage granted delete on org membership alone, so the read-only auditor —
// an outside party given a login to inspect the safety record — could destroy
// every incident photo, permit document and drill evidence file in the tenant.
// Unrecoverable, and invisible to an audit trail that only records what the app
// chose to write.
// ─────────────────────────────────────────────────────────────────────────────
const asRole = (uid, role) => testEnv.authenticatedContext(uid, { orgId: A, role }).storage()

describe('the auditor is read-only in Storage too, not only in Firestore', () => {
  it('reads the evidence, which is what the role exists for', async () => {
    await assertSucceeds(getBytes(ref(asRole('aud', 'auditor'), p(A))))
  })

  it('cannot delete it', async () => {
    await assertFails(deleteObject(ref(asRole('aud', 'auditor'), p(A))))
  })

  it('cannot upload either', async () => {
    await assertFails(uploadBytes(ref(asRole('aud', 'auditor'), `orgs/${A}/docs/new.pdf`), bytes()))
  })
})

describe('deleting a file needs the same standing Firestore asks for', () => {
  it('refuses an ordinary member, who can still upload', async () => {
    await assertFails(deleteObject(ref(asRole('mem', 'member'), p(A))))
    await assertSucceeds(uploadBytes(ref(asRole('mem', 'member'), `orgs/${A}/docs/mem.pdf`), bytes()))
  })

  it('allows a manager and an admin', async () => {
    await assertSucceeds(deleteObject(ref(asRole('mgr', 'manager'), p(A))))
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), p(A)), bytes())
    })
    await assertSucceeds(deleteObject(ref(asRole('adm', 'admin'), p(A))))
  })

  // A session stamped before role was a claim yields '' — not in the allowed
  // list, so it loses delete rather than keeping it, and gets it back on the
  // next sign-in. Failing closed is the right direction for an unrecoverable op.
  it('refuses a token carrying an org but no role at all', async () => {
    const stale = testEnv.authenticatedContext('stale', { orgId: A }).storage()
    await assertFails(deleteObject(ref(stale, p(A))))
    await assertSucceeds(uploadBytes(ref(stale, `orgs/${A}/docs/stale.pdf`), bytes()))
  })

  // Role must never substitute for tenancy: an admin is an admin of THEIR org.
  it('does not let an admin of another org delete anything here', async () => {
    const adminOfB = testEnv.authenticatedContext('badm', { orgId: B, role: 'admin' }).storage()
    await assertFails(deleteObject(ref(adminOfB, p(A))))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY.md S-19 — the hour after a revocation — is NOT closed here, and this
// note is where the next person finds out why before spending the afternoon.
//
// The obvious fix is a cross-service firestore.get() on the live /users profile
// in canDeleteFrom(). It was written, and reverted, because the STORAGE
// EMULATOR DOES NOT EVALUATE CROSS-SERVICE CALLS — it denies them outright
// instead of resolving them, so the rule cannot be exercised here at all.
//
// What made that dangerous rather than merely inconvenient: with the rule in
// place, every REFUSAL test below still passed, because everything was
// refusing. Only the two tests asserting a legitimate manager CAN delete
// failed. A suite full of green negatives is exactly how a rule that enforces
// nothing — or enforces everything — reaches production unnoticed. See S-17.
//
// A tempting variant to also avoid: keeping the rule and deleting the two
// positive tests to make the suite green. That does not test the control, it
// removes the only thing that noticed.
// ─────────────────────────────────────────────────────────────────────────────

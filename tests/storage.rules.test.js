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

// Deleting is no longer a client operation at all. It moved to the
// `deleteOrgFile` callable, which reads the caller's profile LIVE — see
// SECURITY.md S-19 and the block at the foot of this file. These tests exist to
// keep that door shut: if any of them starts passing, the callable has been
// bypassed and the stale-token window is open again.
describe('no client may delete, whatever their token claims', () => {
  it('refuses an ordinary member, who can still upload', async () => {
    await assertFails(deleteObject(ref(asRole('mem', 'member'), p(A))))
    await assertSucceeds(uploadBytes(ref(asRole('mem', 'member'), `orgs/${A}/docs/mem.pdf`), bytes()))
  })

  // These two used to be the ONLY ones allowed, on the strength of a claim that
  // could be an hour out of date. Now the bucket refuses them too and the
  // callable decides, against the database, at the moment of the request.
  it('refuses a manager and an admin — the callable decides, not the token', async () => {
    await assertFails(deleteObject(ref(asRole('mgr', 'manager'), p(A))))
    await assertFails(deleteObject(ref(asRole('adm', 'admin'), p(A))))
  })

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

  // Closing delete must not have closed anything else. Reads and uploads are
  // still the client's to do, and the auditor is still excluded from uploading.
  it('leaves reading and uploading exactly as they were', async () => {
    await assertSucceeds(getBytes(ref(asRole('mgr', 'manager'), p(A))))
    await assertSucceeds(uploadBytes(ref(asRole('mgr', 'manager'), `orgs/${A}/docs/m.pdf`), bytes()))
    await assertFails(uploadBytes(ref(asRole('aud', 'auditor'), `orgs/${A}/docs/a.pdf`), bytes()))
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

// ─────────────────────────────────────────────────────────────────────────────
// What may be stored, by declared type.
//
// The size cap was the only thing this file said about an upload's content, so
// any writer in a tenant could store text/html under the org prefix — and
// getDownloadURL() serves it INLINE, permanently, unauthenticated, from a
// Google-owned domain. A phishing page inside a customer's evidence store,
// answerable to no rule once the link is issued.
//
// The type an object is served as is the type it was stored with, so these
// pin the write.
// ─────────────────────────────────────────────────────────────────────────────
const upload = (db, name, contentType) =>
  uploadBytes(ref(db, p(A, name)), bytes(), contentType ? { contentType } : undefined)

describe('uploads are constrained by declared type', () => {
  it('accepts a photograph, which is most of the evidence in this product', async () => {
    await assertSucceeds(upload(memberOfA(), 'a.jpg', 'image/jpeg'))
  })

  it('accepts a PDF permit or certificate', async () => {
    await assertSucceeds(upload(memberOfA(), 'a.pdf', 'application/pdf'))
  })

  it('accepts training video and audio', async () => {
    await assertSucceeds(upload(memberOfA(), 'a.mp4', 'video/mp4'))
    await assertSucceeds(upload(memberOfA(), 'a.mp3', 'audio/mpeg'))
  })

  it('accepts the office formats training material arrives in', async () => {
    await assertSucceeds(upload(memberOfA(), 'a.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'))
    await assertSucceeds(upload(memberOfA(), 'a.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))
  })

  it('accepts CSV, which the bulk importers use', async () => {
    await assertSucceeds(upload(memberOfA(), 'a.csv', 'text/csv'))
  })

  it('accepts octet-stream, which is how a SEALED file is stored', async () => {
    // putFile uploads encrypted bytes under this type deliberately, so nothing
    // downstream interprets ciphertext as a PDF. Refusing it would break every
    // upload the moment encryption is switched on.
    await assertSucceeds(upload(memberOfA(), 'a.bin', 'application/octet-stream'))
  })

  it('REFUSES text/html — the hosted phishing page', async () => {
    await assertFails(upload(memberOfA(), 'a.html', 'text/html'))
  })

  it('REFUSES SVG, which is an image that runs script', async () => {
    // The one image type that turns a download link back into a hosted page.
    await assertFails(upload(memberOfA(), 'a.svg', 'image/svg+xml'))
  })

  it('refuses SVG however it is spelled', async () => {
    await assertFails(upload(memberOfA(), 'b.svg', 'IMAGE/SVG+XML'))
    await assertFails(upload(memberOfA(), 'c.svg', 'image/svg'))
  })

  it('REFUSES xhtml and xml, which render the same way', async () => {
    await assertFails(upload(memberOfA(), 'a.xhtml', 'application/xhtml+xml'))
    await assertFails(upload(memberOfA(), 'a.xml', 'text/xml'))
  })

  it('refuses a script or a stylesheet', async () => {
    await assertFails(upload(memberOfA(), 'a.js', 'text/javascript'))
    await assertFails(upload(memberOfA(), 'a.css', 'text/css'))
  })

  it('refuses plain text — nothing in the product uploads it', async () => {
    // Not dangerous in itself; refused because an allow-list names what has a
    // reason to be here, and text/plain does not.
    await assertFails(upload(memberOfA(), 'a.txt', 'text/plain'))
  })

  it('does not let the type stand in for membership', async () => {
    // The type check is a conjunct, not a replacement. A perfectly ordinary
    // JPEG is still refused across a tenant boundary.
    await assertFails(uploadBytes(ref(memberOfB(), p(A, 'x.jpg')), bytes(), { contentType: 'image/jpeg' }))
  })

  it('does not let the type stand in for role', async () => {
    const auditor = testEnv.authenticatedContext('aud', { orgId: A, role: 'auditor' }).storage()
    await assertFails(uploadBytes(ref(auditor, p(A, 'y.jpg')), bytes(), { contentType: 'image/jpeg' }))
  })
})

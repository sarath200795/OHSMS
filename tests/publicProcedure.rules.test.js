// ─────────────────────────────────────────────────────────────────────────────
// The public mirror a scanned LOTO procedure QR reads.
//
// This is the third deliberately-unauthenticated surface in the app, after /qr
// and /permitQr, and it fails the same two ways. `read` instead of `get` would
// let a stranger page every tenant's isolation procedures out of one wildcard.
// An unpinned update would let one org repoint another org's mirror at itself,
// which for LOTO means rewriting what a machine's own tag says about it.
//
// The reason a mirror exists at all is covered by src/modules/loto/utils/
// publicProcedure.test.js: rules cannot restrict which FIELDS a read returns,
// so the procedure document itself can never be the public surface.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, getDoc, getDocs, deleteDoc, collection } from 'firebase/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
let testEnv

const OWNER = 'orgOwner'
const OTHER = 'orgOther'

const mirror = (orgId) => ({
  orgId,
  procedureCode: 'ACME-PRESS',
  equipment: 'Hydraulic Press #4',
  site: 'Plant 2',
  status: 'approved',
  revision: 1,
  lockStatus: 'partial',
  lockedCount: 1,
  pointCount: 1,
  points: [{
    key: 'p1',
    energySource: 'electrical',
    rating: '480V',
    isolationDetails: 'Open DS-04.',
    hazard: 'Arc flash.',
    verification: 'Test dead.',
    device: 'breaker_lockout',
    devices: [],
    locked: true,
  }],
})

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'ohsms-demo',
    firestore: { rules: readFileSync(join(__dirname, '..', 'firestore.rules'), 'utf8') },
  })
})
afterAll(async () => { await testEnv?.cleanup() })

beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    for (const [org, uid] of [[OWNER, 'own'], [OTHER, 'mal']]) {
      await setDoc(doc(db, 'organizations', org), { name: org, createdBy: uid })
      await setDoc(doc(db, 'users', uid), {
        orgId: org, role: 'admin', status: 'approved', name: uid, email: `${uid}@t.co`,
      })
    }
    await setDoc(doc(db, 'users', 'aud'), {
      orgId: OWNER, role: 'auditor', status: 'approved', name: 'Aud', email: 'aud@t.co',
    })
    await setDoc(doc(db, 'procedureQr', 'proc-1'), mirror(OWNER))
    // The procedure the mirror stands in for, carrying the names it must not.
    await setDoc(doc(db, 'procedures', 'proc-1'), {
      orgId: OWNER,
      equipment: 'Hydraulic Press #4',
      primaryTech: { name: 'R. Osei' },
      isolationPoints: [{ key: 'p1', lockState: { locked: true, techName: 'R. Osei' } }],
    })
  })
})

const anon = () => testEnv.unauthenticatedContext().firestore()

describe('someone at the machine with no account', () => {
  it('reads the mirror by the id printed on the code', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'procedureQr', 'proc-1')))
  })

  // The whole point of the mirror. If this ever succeeds, worker names are
  // public and the mirror was pointless.
  it('still cannot read the procedure document itself', async () => {
    await assertFails(getDoc(doc(anon(), 'procedures', 'proc-1')))
  })

  // get, not read. An unfiltered list is how an unguessable id stops protecting
  // anything — no guessing required, just one query.
  it('cannot page the whole mirror collection', async () => {
    await assertFails(getDocs(collection(anon(), 'procedureQr')))
  })

  it('cannot write to the mirror', async () => {
    await assertFails(setDoc(doc(anon(), 'procedureQr', 'proc-2'), mirror(OWNER)))
    await assertFails(setDoc(doc(anon(), 'procedureQr', 'proc-1'), mirror(OWNER)))
    await assertFails(deleteDoc(doc(anon(), 'procedureQr', 'proc-1')))
  })
})

describe('the mirror belongs to its tenant', () => {
  const as = (uid) => testEnv.authenticatedContext(uid).firestore()

  it('lets an approved member of the owning org write and delete it', async () => {
    // proc-2 needs a procedure behind it: a mirror may only be created for a
    // procedure the writer's org actually owns (see the last block below).
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'procedures', 'proc-2'), { orgId: OWNER, equipment: 'Press' })
    })
    await assertSucceeds(setDoc(doc(as('own'), 'procedureQr', 'proc-2'), mirror(OWNER)))
    await assertSucceeds(setDoc(doc(as('own'), 'procedureQr', 'proc-1'), mirror(OWNER)))
    await assertSucceeds(deleteDoc(doc(as('own'), 'procedureQr', 'proc-1')))
  })

  // The capture that the /qr rule above it was already pinned against: rewrite
  // orgId to your own in one update and the mirror is yours. For LOTO that is
  // taking over what a machine's tag says about its isolation.
  it('refuses another org repointing it', async () => {
    await assertFails(setDoc(doc(as('mal'), 'procedureQr', 'proc-1'), mirror(OTHER)))
    await assertFails(setDoc(doc(as('mal'), 'procedureQr', 'proc-1'), mirror(OWNER)))
    await assertFails(deleteDoc(doc(as('mal'), 'procedureQr', 'proc-1')))
  })

  it('refuses another org planting a mirror for a procedure it does not own', async () => {
    await assertFails(setDoc(doc(as('mal'), 'procedureQr', 'proc-9'), mirror(OWNER)))
  })

  // isWriterOf, not isApprovedMemberOf — an auditor inspects the safety record
  // and must not be able to edit what the equipment itself reports.
  it('refuses an auditor', async () => {
    await assertFails(setDoc(doc(as('aud'), 'procedureQr', 'proc-1'), mirror(OWNER)))
    await assertFails(deleteDoc(doc(as('aud'), 'procedureQr', 'proc-1')))
    // …but reading is what an auditor is for, and this one is public anyway.
    await assertSucceeds(getDoc(doc(as('aud'), 'procedureQr', 'proc-1')))
  })
})

// The finding an ISO 27001 audit turned up hours after this shipped. The mirror
// ID is a procedure ID, so a rule that only checks the org in the PAYLOAD lets
// any tenant plant a mirror at another tenant's procedure — serving isolation
// instructions of their choosing at the URL printed on that machine, and
// locking the real owner out of ever correcting it.
describe('a mirror belongs to the procedure it speaks for', () => {
  const as = (uid) => testEnv.authenticatedContext(uid).firestore()

  it('refuses another tenant planting a mirror at this org\'s procedure id', async () => {
    // proc-2 belongs to OWNER; the attacker names their OWN org in the payload,
    // which is what the old rule checked and passed.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'procedures', 'proc-2'), { orgId: OWNER, equipment: 'Press' })
    })
    await assertFails(setDoc(doc(as('mal'), 'procedureQr', 'proc-2'), mirror(OTHER)))
  })

  it('refuses a mirror for a procedure that does not exist at all', async () => {
    await assertFails(setDoc(doc(as('own'), 'procedureQr', 'no-such-procedure'), mirror(OWNER)))
  })

  it('still lets the owning org publish its own procedure', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'procedures', 'proc-3'), { orgId: OWNER, equipment: 'Press' })
    })
    await assertSucceeds(setDoc(doc(as('own'), 'procedureQr', 'proc-3'), mirror(OWNER)))
  })

  // The squatter's other prize was permanent denial of service: the owner's
  // backfill could never overwrite the planted document.
  it('leaves the owner able to overwrite its own mirror', async () => {
    await assertSucceeds(setDoc(doc(as('own'), 'procedureQr', 'proc-1'), mirror(OWNER)))
  })
})

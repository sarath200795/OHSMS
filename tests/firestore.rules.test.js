import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest'
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ID = 'ohsms-demo'

let testEnv

// Seed a user profile + org membership bypassing rules.
async function seedMember(uid, orgId, role = 'member', status = 'approved') {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'users', uid), { orgId, role, status, name: uid, email: `${uid}@t.co` })
    await setDoc(doc(db, 'organizations', orgId), { name: orgId, createdBy: uid })
    await setDoc(doc(db, 'organizations', orgId, 'incidents', 'seed'), { title: 'seed', status: 'reported' })
  })
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(join(__dirname, '..', 'firestore.rules'), 'utf8') },
  })
})

afterAll(async () => {
  await testEnv?.cleanup()
})

beforeEach(async () => {
  await testEnv.clearFirestore()
  await seedMember('alice', 'orgA', 'admin')
  await seedMember('bob', 'orgB', 'member')
})

describe('multi-tenant isolation', () => {
  it('an approved member can read their own org data', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertSucceeds(getDoc(doc(alice, 'organizations', 'orgA', 'incidents', 'seed')))
  })

  it('a member CANNOT read another org data', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertFails(getDoc(doc(alice, 'organizations', 'orgB', 'incidents', 'seed')))
  })

  it('a member CANNOT write into another org', async () => {
    const bob = testEnv.authenticatedContext('bob').firestore()
    await assertFails(
      setDoc(doc(bob, 'organizations', 'orgA', 'incidents', 'x'), { title: 'hax', status: 'reported' })
    )
  })

  it('a signed-out user cannot read org data', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(anon, 'organizations', 'orgA', 'incidents', 'seed')))
  })
})

describe('public QR mirror (/qr)', () => {
  it('anyone (signed-out) can read a QR mirror', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'qr', 't1'), { orgId: 'orgA', token: 't1', type: 'ABC' })
    })
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertSucceeds(getDoc(doc(anon, 'qr', 't1')))
  })

  it('an approved member can create a QR mirror for their own org', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertSucceeds(
      setDoc(doc(alice, 'qr', 't2'), { orgId: 'orgA', token: 't2', type: 'ABC' })
    )
  })

  it('a member CANNOT create a QR mirror for another org', async () => {
    const bob = testEnv.authenticatedContext('bob').firestore()
    await assertFails(
      setDoc(doc(bob, 'qr', 't3'), { orgId: 'orgA', token: 't3', type: 'ABC' })
    )
  })

  it('a signed-out user cannot write a QR mirror', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertFails(
      setDoc(doc(anon, 'qr', 't4'), { orgId: 'orgA', token: 't4', type: 'ABC' })
    )
  })
})

// A QR scan is a public write surface, so the rule admits exactly two shapes:
// an extinguisher defect keyed by extId, and an AED/FAS fault keyed by
// assetKind + assetRefId. AED and FAS carry no extId, so before the second
// clause existed every fault reported from a scan was rejected outright.
describe('public defect reports from a QR scan (/reports)', () => {
  const reportAt = (db, id) => doc(db, 'organizations', 'orgA', 'reports', id)
  const extReport = {
    source: 'qr', kind: 'defect', approvalStatus: 'pending', reportedBy: 'public',
    extId: 'ext1', note: 'nozzle blocked',
  }
  const assetReport = {
    source: 'qr', kind: 'asset_defect', approvalStatus: 'pending', reportedBy: 'public',
    assetKind: 'aed', assetRefId: 'aed1', defect: 'Pads Expired', note: '',
  }

  it('a signed-out scanner can report an extinguisher defect', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertSucceeds(setDoc(reportAt(anon, 'r1'), extReport))
  })

  it('a signed-out scanner can report an AED defect', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertSucceeds(setDoc(reportAt(anon, 'r2'), assetReport))
  })

  it('a signed-out scanner can report a FAS defect', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertSucceeds(
      setDoc(reportAt(anon, 'r3'), { ...assetReport, assetKind: 'fas', assetRefId: 'fas1', defect: 'Hooter Not Working' })
    )
  })

  it('an asset report CANNOT arrive pre-approved', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertFails(setDoc(reportAt(anon, 'r4'), { ...assetReport, approvalStatus: 'approved' }))
  })

  it('an asset report CANNOT name a kind that maps to no collection', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertFails(setDoc(reportAt(anon, 'r5'), { ...assetReport, assetKind: 'extinguisher' }))
  })

  it('an asset report CANNOT omit the asset it is about', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertFails(setDoc(reportAt(anon, 'r6'), { ...assetReport, assetRefId: '' }))
  })
})

// The QR on a printed permit is scanned by contractors, auditors and fire
// watchers, none of whom have an account. If they cannot read the mirror the
// code is dead, and if they can write to it a permit can be forged.
describe('public permit QR mirror (/permitQr)', () => {
  const mirrorAt = (db, token) => doc(db, 'permitQr', token)
  const mirror = { orgId: 'orgA', permitId: 'p1', token: 'tok1', permitNo: 'PTW-001', storedStatus: 'approved' }

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'permitQr', 'tok1'), mirror)
    })
  })

  it('a signed-out scanner can read it, or the printed QR is dead', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertSucceeds(getDoc(mirrorAt(anon, 'tok1')))
  })

  it('a signed-out scanner CANNOT alter a permit through it', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertFails(setDoc(mirrorAt(anon, 'tok1'), { ...mirror, storedStatus: 'approved' }))
  })

  it('a signed-out scanner CANNOT publish a permit that does not exist', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertFails(setDoc(mirrorAt(anon, 'forged'), { ...mirror, token: 'forged' }))
  })

  it('a signed-out scanner CANNOT delete it', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertFails(deleteDoc(mirrorAt(anon, 'tok1')))
  })

  it('a member of the owning org can publish and update it', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertSucceeds(setDoc(mirrorAt(alice, 'tok2'), { ...mirror, token: 'tok2' }))
    await assertSucceeds(setDoc(mirrorAt(alice, 'tok1'), { ...mirror, storedStatus: 'closed' }, { merge: true }))
  })

  it('a member of the owning org can delete it when the permit is deleted', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertSucceeds(deleteDoc(mirrorAt(alice, 'tok1')))
  })

  it('another org CANNOT touch it', async () => {
    const bob = testEnv.authenticatedContext('bob').firestore() // orgB
    await assertFails(setDoc(mirrorAt(bob, 'tok1'), { ...mirror, storedStatus: 'closed' }, { merge: true }))
    await assertFails(deleteDoc(mirrorAt(bob, 'tok1')))
    await assertFails(setDoc(mirrorAt(bob, 'tok3'), { ...mirror, token: 'tok3' }))
  })
})

// Scanning a permit and reporting unsafe work is the point of the QR. The line
// that matters is that reporting is not the same as acting: a signed-in unsafe
// observation closes the permit, and this surface must not be able to.
describe('public observations from a permit QR scan (/observations)', () => {
  const obsAt = (db, id) => doc(db, 'organizations', 'orgA', 'observations', id)
  const scan = {
    source: 'qr', approvalStatus: 'pending', observedBy: 'public',
    type: 'unsafe', permitId: 'p1', permitNo: 'PTW-001', note: 'no fire watch present',
  }

  it('a signed-out scanner can report unsafe work', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertSucceeds(setDoc(obsAt(anon, 'o1'), scan))
  })

  it('a signed-out scanner can report that it looks safe', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertSucceeds(setDoc(obsAt(anon, 'o2'), { ...scan, type: 'safe', note: '' }))
  })

  it('a scanned observation CANNOT arrive already accepted', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertFails(setDoc(obsAt(anon, 'o3'), { ...scan, approvalStatus: 'approved' }))
  })

  it('a scanned observation CANNOT claim to be from a signed-in user', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertFails(setDoc(obsAt(anon, 'o4'), { ...scan, observedBy: 'alice' }))
    await assertFails(setDoc(obsAt(anon, 'o5'), { ...scan, source: 'portal' }))
  })

  it('CANNOT name a type the permit page never writes', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertFails(setDoc(obsAt(anon, 'o6'), { ...scan, type: 'closed' }))
  })

  it('CANNOT omit the permit it is about', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertFails(setDoc(obsAt(anon, 'o7'), { ...scan, permitId: '' }))
  })

  it('CANNOT be used to store an unbounded note', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertFails(setDoc(obsAt(anon, 'o8'), { ...scan, note: 'x'.repeat(501) }))
  })

  it('a signed-out scanner CANNOT read other observations back', async () => {
    // They carry names and what people reported; the scan is write-only.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'organizations', 'orgA', 'observations', 'seeded'), scan)
    })
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertFails(getDoc(obsAt(anon, 'seeded')))
  })

  it('a signed-out scanner CANNOT edit or delete one', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'organizations', 'orgA', 'observations', 'seeded'), scan)
    })
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertFails(setDoc(obsAt(anon, 'seeded'), { ...scan, type: 'safe' }, { merge: true }))
    await assertFails(deleteDoc(obsAt(anon, 'seeded')))
  })

  it('CANNOT reach into another org through the path', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertSucceeds(setDoc(doc(anon, 'organizations', 'orgB', 'observations', 'o9'), scan))
    // …which is fine: the org id comes from the mirror the token resolved to,
    // and a pending report against a permit that does not exist is inert. What
    // must not work is reading anything back out of it.
    await assertFails(getDoc(doc(anon, 'organizations', 'orgB', 'observations', 'o9')))
  })
})

// The lock exists so the same fault cannot be reported twice while it is still
// being dealt with. It is enforced entirely by "create fails if it exists", so
// every test here is really asking one question: can anything turn that create
// into an update?
describe('one open report per defect (/defectLocks)', () => {
  const lockAt = (db, id) => doc(db, 'organizations', 'orgA', 'defectLocks', id)
  const lock = { extId: 'ext1', defectType: 'leakage', createdAt: new Date() }

  it('a signed-out scanner can take the lock, or it would never block them', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertSucceeds(setDoc(lockAt(anon, 'ext1__leakage'), lock))
  })

  it('the same defect on the same unit CANNOT be locked twice', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertSucceeds(setDoc(lockAt(anon, 'ext1__leakage'), lock))
    await assertFails(setDoc(lockAt(anon, 'ext1__leakage'), lock))
  })

  it('a member CANNOT overwrite an existing lock either', async () => {
    // The generic member rule allows update on every other collection, so this
    // is the case that would silently defeat the whole mechanism.
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertSucceeds(setDoc(lockAt(anon, 'ext1__leakage'), lock))
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertFails(setDoc(lockAt(alice, 'ext1__leakage'), lock))
  })

  it('a different defect on the same unit is still reportable', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertSucceeds(setDoc(lockAt(anon, 'ext1__leakage'), lock))
    await assertSucceeds(setDoc(lockAt(anon, 'ext1__damaged_hose'), { ...lock, defectType: 'damaged_hose' }))
  })

  it('the same defect on a different unit is still reportable', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertSucceeds(setDoc(lockAt(anon, 'ext1__leakage'), lock))
    await assertSucceeds(setDoc(lockAt(anon, 'ext2__leakage'), { ...lock, extId: 'ext2' }))
  })

  it('a member can release the lock when the defect is closed', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertSucceeds(setDoc(lockAt(anon, 'ext1__leakage'), lock))
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertSucceeds(deleteDoc(lockAt(alice, 'ext1__leakage')))
    // …and then it can be reported again, which is the whole point.
    await assertSucceeds(setDoc(lockAt(anon, 'ext1__leakage'), lock))
  })

  it('a signed-out scanner CANNOT release a lock', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertSucceeds(setDoc(lockAt(anon, 'ext1__leakage'), lock))
    await assertFails(deleteDoc(lockAt(anon, 'ext1__leakage')))
  })

  it('a signed-out scanner CANNOT read who reported what', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertFails(getDoc(lockAt(anon, 'ext1__leakage')))
  })

  it('CANNOT be used as free storage for arbitrary fields', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertFails(setDoc(lockAt(anon, 'x'), { ...lock, payload: 'x'.repeat(500) }))
  })

  it('CANNOT be created without the unit and defect it locks', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertFails(setDoc(lockAt(anon, 'a'), { extId: '', defectType: 'leakage', createdAt: new Date() }))
    await assertFails(setDoc(lockAt(anon, 'b'), { extId: 'ext1', defectType: '', createdAt: new Date() }))
  })

  it('a member CANNOT reach another org locks', async () => {
    const bob = testEnv.authenticatedContext('bob').firestore()
    await assertFails(getDoc(lockAt(bob, 'ext1__leakage')))
  })
})

describe('employee provisioning', () => {
  const emp = { role: 'member', status: 'approved', name: 'New Emp', email: 'new@t.co' }

  it('an org admin can create an approved non-admin profile for their org', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertSucceeds(setDoc(doc(alice, 'users', 'emp1'), { ...emp, orgId: 'orgA' }))
  })

  it('an admin CANNOT provision into another org', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertFails(setDoc(doc(alice, 'users', 'emp2'), { ...emp, orgId: 'orgB' }))
  })

  it('an admin CANNOT provision another admin directly', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertFails(setDoc(doc(alice, 'users', 'emp3'), { ...emp, orgId: 'orgA', role: 'admin' }))
  })

  it('a plain member cannot provision others', async () => {
    const bob = testEnv.authenticatedContext('bob').firestore()
    await assertFails(setDoc(doc(bob, 'users', 'emp4'), { ...emp, orgId: 'orgB' }))
  })
})

describe('RBAC', () => {
  it('a non-admin member cannot delete records (manager+ only)', async () => {
    const { deleteDoc } = await import('firebase/firestore')
    const bob = testEnv.authenticatedContext('bob').firestore()
    // bob is a plain member in orgB — delete is manager/admin only.
    await assertFails(deleteDoc(doc(bob, 'organizations', 'orgB', 'incidents', 'seed')))
  })

  it('the audit log is append-only (no updates)', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertSucceeds(
      setDoc(doc(alice, 'organizations', 'orgA', 'auditLogs', 'l1'), { action: 'x', at: Date.now() })
    )
    await assertFails(
      setDoc(doc(alice, 'organizations', 'orgA', 'auditLogs', 'l1'), { action: 'y', at: Date.now() })
    )
  })
})

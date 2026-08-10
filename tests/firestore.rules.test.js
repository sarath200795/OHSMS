import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest'
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, getDocs, collection, query, where, setDoc, deleteDoc, writeBatch } from 'firebase/firestore'

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

// The registration escape hatch: creating your own profile as an approved
// admin is allowed ONLY inside the batch that creates the organization itself.
// Without the getAfter pin, the public orgIndex hands any signed-up stranger an
// orgId, and one lone write makes them that org's admin.
describe('admin self-create is pinned to org registration', () => {
  it('a stranger CANNOT write themselves in as admin of an existing org', async () => {
    const mallory = testEnv.authenticatedContext('mallory').firestore()
    await assertFails(setDoc(doc(mallory, 'users', 'mallory'), {
      orgId: 'orgA', role: 'admin', status: 'approved', name: 'Mallory', email: 'm@x.co',
    }))
  })

  it('registering a NEW org as its admin still works, batched', async () => {
    const founder = testEnv.authenticatedContext('founder').firestore()
    const batch = writeBatch(founder)
    batch.set(doc(founder, 'organizations', 'orgNew'), { name: 'New Org', createdBy: 'founder' })
    batch.set(doc(founder, 'users', 'founder'), {
      orgId: 'orgNew', role: 'admin', status: 'approved', name: 'Founder', email: 'f@x.co',
    })
    batch.set(doc(founder, 'orgIndex', 'new org'), { orgId: 'orgNew', name: 'New Org' })
    await assertSucceeds(batch.commit())
  })

  it('the batch trick does not work against someone else\'s org either', async () => {
    // Batching a user doc with a WRITE to the existing org cannot help: the org
    // create is refused (doc exists / not the creator), so the batch dies whole.
    const mallory = testEnv.authenticatedContext('mallory').firestore()
    const batch = writeBatch(mallory)
    batch.set(doc(mallory, 'organizations', 'orgA'), { name: 'orgA', createdBy: 'mallory' })
    batch.set(doc(mallory, 'users', 'mallory'), {
      orgId: 'orgA', role: 'admin', status: 'approved', name: 'Mallory', email: 'm@x.co',
    })
    await assertFails(batch.commit())
  })

  it('joining as a pending member still works', async () => {
    const newbie = testEnv.authenticatedContext('newbie').firestore()
    await assertSucceeds(setDoc(doc(newbie, 'users', 'newbie'), {
      orgId: 'orgA', role: 'member', status: 'pending', name: 'Newbie', email: 'n@x.co',
    }))
  })
})

// Joining an org is self-service, so "has a profile naming this org" is not a
// trust signal — anyone can create one as pending against any public orgId.
// Reading the directory has to require approval, not mere existence.
describe('an unapproved joiner cannot read the org directory', () => {
  const seedPending = (uid, orgId) =>
    testEnv.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), 'users', uid), {
        orgId, role: 'member', status: 'pending', name: 'Mallory', email: 'm@x.co',
      })
    )

  it('a pending joiner CANNOT read another member of that org', async () => {
    await seedPending('mallory', 'orgA')
    const mallory = testEnv.authenticatedContext('mallory').firestore()
    await assertFails(getDoc(doc(mallory, 'users', 'alice')))
  })

  it('a pending joiner CAN still read their own profile', async () => {
    await seedPending('mallory', 'orgA')
    const mallory = testEnv.authenticatedContext('mallory').firestore()
    await assertSucceeds(getDoc(doc(mallory, 'users', 'mallory')))
  })

  it('an approved member still reads their colleagues', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertSucceeds(getDoc(doc(alice, 'users', 'alice')))
  })

  it('an admin can still see a pending joiner in order to approve them', async () => {
    await seedPending('mallory', 'orgA')
    const alice = testEnv.authenticatedContext('alice').firestore() // approved admin of orgA
    await assertSucceeds(getDoc(doc(alice, 'users', 'mallory')))
  })
})

// The /users update rule is two OR'd branches. Only the self branch pinned
// orgId, so an admin editing their own document took the other branch — which
// pinned nothing — and could rewrite orgId to any value. Creating an org is
// open to anyone, which made this a complete cross-tenant takeover.
describe('orgId is immutable on /users, on BOTH update branches', () => {
  it('an admin CANNOT move themselves into another org', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore() // admin of orgA
    await assertFails(setDoc(doc(alice, 'users', 'alice'), {
      orgId: 'orgB', role: 'admin', status: 'approved', name: 'Alice', email: 'a@x.co',
    }))
  })

  it('an admin CANNOT move one of their members into another org', async () => {
    await testEnv.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), 'users', 'carol'), {
        orgId: 'orgA', role: 'member', status: 'approved', name: 'Carol', email: 'c@x.co',
      })
    )
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertFails(setDoc(doc(alice, 'users', 'carol'), {
      orgId: 'orgB', role: 'member', status: 'approved', name: 'Carol', email: 'c@x.co',
    }))
  })

  it('a member cannot change their own orgId either', async () => {
    const bob = testEnv.authenticatedContext('bob').firestore()
    await assertFails(setDoc(doc(bob, 'users', 'bob'), {
      orgId: 'orgA', role: 'member', status: 'approved', name: 'Bob', email: 'b@x.co',
    }))
  })

  it('an admin CAN still manage a member inside their own org', async () => {
    await testEnv.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), 'users', 'dave'), {
        orgId: 'orgA', role: 'member', status: 'pending', name: 'Dave', email: 'd@x.co',
      })
    )
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertSucceeds(setDoc(doc(alice, 'users', 'dave'), {
      orgId: 'orgA', role: 'manager', status: 'approved', name: 'Dave', email: 'd@x.co',
    }))
  })

  it('a user can still edit their own harmless fields', async () => {
    const bob = testEnv.authenticatedContext('bob').firestore()
    await assertSucceeds(setDoc(doc(bob, 'users', 'bob'), {
      orgId: 'orgB', role: 'member', status: 'approved', name: 'Bobby', email: 'b@x.co',
    }))
  })
})

// `read` in Firestore rules means `get` OR `list`. Every existing test on these
// public mirrors used getDoc, so a whole verb went untested — and `allow read:
// if true` on a wildcard match had been granting unauthenticated collection
// listing of every tenant's mirrors the entire time. Confirmed against
// production before the fix: 842 documents, no credential.
describe('public QR mirrors are readable by token but NOT listable', () => {
  const seedMirrors = () =>
    testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      await setDoc(doc(db, 'qr', 'tokA'), { orgId: 'orgA', serialNo: 'FE-1', centerName: 'Site A' })
      await setDoc(doc(db, 'qr', 'tokB'), { orgId: 'orgB', serialNo: 'FE-2', centerName: 'Site B' })
      await setDoc(doc(db, 'permitQr', 'ptokA'), { orgId: 'orgA', issuedToName: 'Alice', jobLocation: 'Bay 3' })
      await setDoc(doc(db, 'permitQr', 'ptokB'), { orgId: 'orgB', issuedToName: 'Carol', jobLocation: 'Roof' })
    })

  it('an anonymous scanner CAN still read a mirror by its exact token', async () => {
    await seedMirrors()
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertSucceeds(getDoc(doc(anon, 'qr', 'tokA')))
    await assertSucceeds(getDoc(doc(anon, 'permitQr', 'ptokA')))
  })

  it('an anonymous stranger CANNOT list the equipment mirrors', async () => {
    await seedMirrors()
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertFails(getDocs(collection(anon, 'qr')))
  })

  it('an anonymous stranger CANNOT list the permit mirrors', async () => {
    await seedMirrors()
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertFails(getDocs(collection(anon, 'permitQr')))
  })

  // Signing up is free, so "signed in" is not a meaningful barrier here.
  it('a signed-in member of another org cannot list them either', async () => {
    await seedMirrors()
    const bob = testEnv.authenticatedContext('bob').firestore() // member of orgB
    await assertFails(getDocs(collection(bob, 'qr')))
    await assertFails(getDocs(collection(bob, 'permitQr')))
  })

  it('a query with a filter is still a list, and is still refused', async () => {
    await seedMirrors()
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertFails(getDocs(query(collection(anon, 'qr'), where('orgId', '==', 'orgA'))))
  })
})

// The orgIndex is how signup answers "which org is this?" before the user
// belongs to anything, so it is world-readable. It was also world-WRITEABLE to
// any signed-in account, which turned it into a tenant-hijack primitive:
// repoint an org's entry, and every employee who signs up by name afterwards is
// enrolled into the attacker's org instead.
describe('orgIndex cannot be repointed at another org', () => {
  const seedIndex = (orgId, key, name) =>
    testEnv.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), 'orgIndex', key), { orgId, name })
    )

  it('a signed-in stranger CANNOT repoint an existing org at their own', async () => {
    await seedIndex('orgA', 'acme corp', 'Acme Corp')
    const mallory = testEnv.authenticatedContext('mallory').firestore()
    await assertFails(
      setDoc(doc(mallory, 'orgIndex', 'acme corp'), { orgId: 'orgEvil', name: 'Acme Corp' })
    )
  })

  it('even a member of another real org cannot repoint it', async () => {
    await seedIndex('orgA', 'acme corp', 'Acme Corp')
    const bob = testEnv.authenticatedContext('bob').firestore() // approved member of orgB
    await assertFails(
      setDoc(doc(bob, 'orgIndex', 'acme corp'), { orgId: 'orgB', name: 'Acme Corp' })
    )
  })

  it('a stranger cannot squat a name by pointing a NEW entry at their own org', async () => {
    // No profile written in the same batch, so the getAfter pin refuses it.
    const mallory = testEnv.authenticatedContext('mallory').firestore()
    await assertFails(
      setDoc(doc(mallory, 'orgIndex', 'acme corp'), { orgId: 'orgEvil', name: 'Acme Corp' })
    )
  })

  it("a member of the org CAN correct its own entry's name", async () => {
    await seedIndex('orgA', 'acme corp', 'Acme Corp')
    const alice = testEnv.authenticatedContext('alice').firestore() // admin of orgA
    await assertSucceeds(
      setDoc(doc(alice, 'orgIndex', 'acme corp'), { orgId: 'orgA', name: 'Acme Corporation' })
    )
  })

  it('but cannot smuggle a different orgId into that correction', async () => {
    await seedIndex('orgA', 'acme corp', 'Acme Corp')
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertFails(
      setDoc(doc(alice, 'orgIndex', 'acme corp'), { orgId: 'orgEvil', name: 'Acme Corp' })
    )
  })

  it('nobody can delete an entry to free the name for squatting', async () => {
    await seedIndex('orgA', 'acme corp', 'Acme Corp')
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertFails(deleteDoc(doc(alice, 'orgIndex', 'acme corp')))
  })

  it('the self-heal backfill for a pre-index org still works', async () => {
    // ensureOrgIndex(): an approved member creates the missing entry for their
    // own org. No batch, but the getAfter pin is satisfied by their existing
    // profile already naming that orgId.
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertSucceeds(
      setDoc(doc(alice, 'orgIndex', 'acme corp'), { orgId: 'orgA', name: 'Acme Corp' })
    )
  })
})

// A document id ends up printed on a permit and quoted in the audit trail, so
// two records sharing one is the failure the whole scheme exists to prevent.
// The transaction in reserve.js stops two people colliding by accident; only
// this rule stops one person rewinding the counter on purpose.
describe('document-id counters are monotonic (/docSeq)', () => {
  const seqAt = (db, kind) => doc(db, 'organizations', 'orgA', 'docSeq', kind)

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'organizations', 'orgA', 'docSeq', 'incidents'), { n: 42 })
    })
  })

  it('a member can move a counter forward — reserving an id is a normal write', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertSucceeds(setDoc(seqAt(alice, 'incidents'), { n: 43 }))
  })

  it('a member CANNOT rewind a counter', async () => {
    // The attack: set it back, then create records that reuse issued numbers.
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertFails(setDoc(seqAt(alice, 'incidents'), { n: 1 }))
  })

  it('a member CANNOT rewrite a counter to its current value', async () => {
    // Strictly greater, so a replayed write cannot re-issue the same number.
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertFails(setDoc(seqAt(alice, 'incidents'), { n: 42 }))
  })

  it('a counter CANNOT be deleted, which would reset it to zero', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertFails(deleteDoc(seqAt(alice, 'incidents')))
  })

  it('a counter CANNOT be smuggled past the rule as a non-integer or extra field', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertFails(setDoc(seqAt(alice, 'incidents'), { n: 99.5 }))
    await assertFails(setDoc(seqAt(alice, 'incidents'), { n: '99' }))
    await assertFails(setDoc(seqAt(alice, 'incidents'), { n: 99, sneaky: true }))
  })

  it('a new kind starts at a positive number, never zero', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertFails(setDoc(seqAt(alice, 'permits'), { n: 0 }))
    await assertSucceeds(setDoc(seqAt(alice, 'permits'), { n: 1 }))
  })

  it('another org cannot touch these counters at all', async () => {
    const bob = testEnv.authenticatedContext('bob').firestore() // orgB
    await assertFails(setDoc(seqAt(bob, 'incidents'), { n: 999 }))
    await assertFails(getDoc(seqAt(bob, 'incidents')))
  })
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
  // A public report must now carry the token of the asset it is about, so each
  // of these scans a real mirror. Without one the write is refused, which is
  // what stops a stranger filing against equipment they have never seen.
  const extReport = {
    source: 'qr', kind: 'defect', approvalStatus: 'pending', reportedBy: 'public',
    extId: 'ext1', note: 'nozzle blocked', token: 'tok1',
  }
  const assetReport = {
    source: 'qr', kind: 'asset_defect', approvalStatus: 'pending', reportedBy: 'public',
    assetKind: 'aed', assetRefId: 'aed1', defect: 'Pads Expired', note: '', token: 'tokAed',
  }

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      await setDoc(doc(db, 'qr', 'tok1'), { orgId: 'orgA', extId: 'ext1', token: 'tok1' })
      await setDoc(doc(db, 'qr', 'tokAed'), { orgId: 'orgA', assetKind: 'aed', assetRefId: 'aed1', token: 'tokAed' })
      await setDoc(doc(db, 'qr', 'tokFas'), { orgId: 'orgA', assetKind: 'fas', assetRefId: 'fas1', token: 'tokFas' })
    })
  })

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
      setDoc(reportAt(anon, 'r3'), { ...assetReport, assetKind: 'fas', assetRefId: 'fas1', defect: 'Hooter Not Working', token: 'tokFas' })
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
  // As with reports, the scan now has to be provable: the token must exist and
  // name the permit being observed.
  const scan = {
    source: 'qr', approvalStatus: 'pending', observedBy: 'public',
    type: 'unsafe', permitId: 'p1', permitNo: 'PTW-001', note: 'no fire watch present',
    token: 'ptok1',
  }

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), 'permitQr', 'ptok1'), { orgId: 'orgA', permitId: 'p1', token: 'ptok1' })
    )
  })

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
    // This used to SUCCEED, and the test said so — orgId was just a path
    // segment, and the write was tolerated as inert. It is now refused
    // outright: the token resolves to orgA's mirror, so it cannot be used to
    // file into orgB no matter what path is typed.
    await assertFails(setDoc(doc(anon, 'organizations', 'orgB', 'observations', 'o9'), scan))
    await assertFails(getDoc(doc(anon, 'organizations', 'orgB', 'observations', 'o9')))
  })
})

// The lock exists so the same fault cannot be reported twice while it is still
// being dealt with. It is enforced entirely by "create fails if it exists", so
// every test here is really asking one question: can anything turn that create
// into an update?
// The public report and observation surfaces validated a few named fields but
// never the key SET, and never checked that the asset or permit being written
// about had anything to do with the writer. orgId was a path segment they chose.
describe('public writes must prove a scan and cannot carry junk', () => {
  const reportAt = (db, id) => doc(db, 'organizations', 'orgA', 'reports', id)
  const obsAt = (db, id) => doc(db, 'organizations', 'orgA', 'observations', id)

  const report = {
    kind: 'defect', extId: 'ext1', extLabel: 'FE-1', defectType: 'leakage',
    note: 'discharged', source: 'qr', token: 'tok1',
    reportedBy: 'public', reportedByName: 'QR Scan (Public)', reporterRole: 'visitor',
    approvalStatus: 'pending', reportedAt: new Date(),
  }
  const observation = {
    permitId: 'p1', permitNo: 'PTW-1', token: 'ptok1', type: 'unsafe',
    note: 'no fire watch', source: 'qr', observedBy: 'public',
    observedByName: 'QR Scan (Public)', observedByRole: 'visitor',
    approvalStatus: 'pending', at: new Date(),
  }

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      await setDoc(doc(db, 'qr', 'tok1'), { orgId: 'orgA', extId: 'ext1', token: 'tok1' })
      await setDoc(doc(db, 'qr', 'tok2'), { orgId: 'orgA', extId: 'ext2', token: 'tok2' })
      await setDoc(doc(db, 'qr', 'tokB'), { orgId: 'orgB', extId: 'extB', token: 'tokB' })
      await setDoc(doc(db, 'permitQr', 'ptok1'), { orgId: 'orgA', permitId: 'p1', token: 'ptok1' })
      await setDoc(doc(db, 'permitQr', 'ptokB'), { orgId: 'orgB', permitId: 'pB', token: 'ptokB' })
    })
  })

  it('a scanner can still report a defect on the unit they scanned', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertSucceeds(setDoc(reportAt(anon, 'r1'), report))
  })

  it('a stranger with no token cannot report at all', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    const { token, ...noToken } = report
    await assertFails(setDoc(reportAt(anon, 'r2'), noToken))
    await assertFails(setDoc(reportAt(anon, 'r3'), { ...report, token: 'made-up' }))
  })

  it('a token for one unit cannot report a defect on another', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertFails(setDoc(reportAt(anon, 'r4'), { ...report, extId: 'ext2' }))
  })

  it('a token from another org cannot file into this org queue', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertFails(setDoc(reportAt(anon, 'r5'), { ...report, extId: 'extB', token: 'tokB' }))
  })

  // ~1 MiB per document, unlimited documents, billed to the org.
  it('a report cannot smuggle extra fields', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertFails(setDoc(reportAt(anon, 'r6'), { ...report, payload: 'x'.repeat(2000) }))
    await assertFails(setDoc(reportAt(anon, 'r7'), { ...report, approvedBy: 'me' }))
  })

  it('a member can still create a report without scanning', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertSucceeds(setDoc(reportAt(alice, 'r8'), {
      kind: 'defect', extId: 'ext1', extLabel: 'FE-1', defectType: 'leakage',
      note: '', source: 'portal', reportedBy: 'alice', reportedByName: 'Alice',
      reporterRole: null, approvalStatus: 'pending', reportedAt: new Date(),
    }))
  })

  // Documents the real boundary rather than an imagined one. hasOnly binds the
  // ANONYMOUS branch only: /reports is also covered by the generic org
  // collection rule, and rules are a permissive union, so any constraint placed
  // on the member branch here is overridden by that rule granting the same
  // write. A member can already write arbitrary fields to every other
  // collection in their own org, so this is consistent — and it is worth a test
  // so nobody later "fixes" the public branch by hoisting hasOnly above both
  // and believes it now covers members too.
  it('a member CAN carry extra fields — hasOnly binds the public branch only', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertSucceeds(setDoc(reportAt(alice, 'r9'), { ...report, source: 'portal', junk: 1 }))
  })

  it('a scanner can still log an observation on the permit they scanned', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertSucceeds(setDoc(obsAt(anon, 'o1'), observation))
  })

  it('an observation needs a real permit token, for the permit it names', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    const { token, ...noToken } = observation
    await assertFails(setDoc(obsAt(anon, 'o2'), noToken))
    await assertFails(setDoc(obsAt(anon, 'o3'), { ...observation, permitId: 'someone-elses' }))
    await assertFails(setDoc(obsAt(anon, 'o4'), { ...observation, permitId: 'pB', token: 'ptokB' }))
  })

  it('an observation cannot smuggle extra fields', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertFails(setDoc(obsAt(anon, 'o5'), { ...observation, payload: 'x'.repeat(2000) }))
  })
})

describe('one open report per defect (/defectLocks)', () => {
  const lockAt = (db, id) => doc(db, 'organizations', 'orgA', 'defectLocks', id)
  // A public scanner now has to prove they were at the unit, so every anonymous
  // lock carries the token from the QR code they scanned.
  const lock = { extId: 'ext1', defectType: 'leakage', createdAt: new Date(), token: 'tok1' }

  // Two real assets in orgA, plus one in orgB to check the tenant binding.
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      await setDoc(doc(db, 'qr', 'tok1'), { orgId: 'orgA', extId: 'ext1', token: 'tok1' })
      await setDoc(doc(db, 'qr', 'tok2'), { orgId: 'orgA', extId: 'ext2', token: 'tok2' })
      await setDoc(doc(db, 'qr', 'tokB'), { orgId: 'orgB', extId: 'extB', token: 'tokB' })
    })
  })

  it('a scanner holding the unit token can take the lock, or it would never block them', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertSucceeds(setDoc(lockAt(anon, 'ext1__leakage'), lock))
  })

  // The denial-of-service this whole binding exists to stop: pre-created locks
  // made every genuine defect report fail, and told the reporter it was already
  // reported. Without a token there is now nothing to pre-create.
  it('a stranger with NO token cannot create a lock at all', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertFails(setDoc(lockAt(anon, 'ext1__leakage'), { extId: 'ext1', defectType: 'leakage', createdAt: new Date() }))
    await assertFails(setDoc(lockAt(anon, 'ext1__leakage'), { ...lock, token: '' }))
    await assertFails(setDoc(lockAt(anon, 'ext1__leakage'), { ...lock, token: 'not-a-real-token' }))
  })

  // Scanning one extinguisher must not let you lock the rest of the estate.
  it('a token for one unit cannot lock a different unit', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertFails(setDoc(lockAt(anon, 'ext2__leakage'), { ...lock, extId: 'ext2', token: 'tok1' }))
  })

  // The id IS the lock, so it has to agree with the payload — otherwise a valid
  // scan of your own unit could be used to block someone else's.
  it('the document id must match the unit and defect in the payload', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertFails(setDoc(lockAt(anon, 'ext2__leakage'), lock))
    await assertFails(setDoc(lockAt(anon, 'ext1__damaged_hose'), lock))
    await assertFails(setDoc(lockAt(anon, 'anything'), lock))
  })

  it('a token from another org cannot lock into this one', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertFails(setDoc(lockAt(anon, 'extB__leakage'), { extId: 'extB', defectType: 'leakage', createdAt: new Date(), token: 'tokB' }))
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

  it('a member can still take a lock without scanning anything', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertSucceeds(setDoc(lockAt(alice, 'ext1__leakage'), { extId: 'ext1', defectType: 'leakage', createdAt: new Date() }))
  })

  it('a different defect on the same unit is still reportable', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertSucceeds(setDoc(lockAt(anon, 'ext1__leakage'), lock))
    await assertSucceeds(setDoc(lockAt(anon, 'ext1__damaged_hose'), { ...lock, defectType: 'damaged_hose' }))
  })

  it('the same defect on a different unit is still reportable', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertSucceeds(setDoc(lockAt(anon, 'ext1__leakage'), lock))
    await assertSucceeds(setDoc(lockAt(anon, 'ext2__leakage'), { extId: 'ext2', defectType: 'leakage', createdAt: new Date(), token: 'tok2' }))
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
    await assertFails(setDoc(lockAt(anon, 'ext1__leakage'), { ...lock, payload: 'x'.repeat(500) }))
  })

  it('CANNOT be created without the unit and defect it locks', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertFails(setDoc(lockAt(anon, 'a'), { extId: '', defectType: 'leakage', createdAt: new Date(), token: 'tok1' }))
    await assertFails(setDoc(lockAt(anon, 'b'), { extId: 'ext1', defectType: '', createdAt: new Date(), token: 'tok1' }))
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
      setDoc(doc(alice, 'organizations', 'orgA', 'auditLogs', 'l1'), {
        action: 'x', at: Date.now(), actorUid: 'alice',
      })
    )
    await assertFails(
      setDoc(doc(alice, 'organizations', 'orgA', 'auditLogs', 'l1'), {
        action: 'y', at: Date.now(), actorUid: 'alice',
      })
    )
  })

  // An append-only trail is only evidence if the name on an entry is the person
  // who wrote it. Creation used to be unvalidated, so a member could attribute
  // anything to an admin — in the one record that would otherwise show them
  // doing it.
  it('a member CANNOT write an audit entry in someone else\'s name', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertFails(
      setDoc(doc(alice, 'organizations', 'orgA', 'auditLogs', 'forged'), {
        action: 'user.role', at: Date.now(), actorUid: 'someone-else', actorName: 'Admin',
      })
    )
  })

  it('an audit entry with no actor at all is refused', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertFails(
      setDoc(doc(alice, 'organizations', 'orgA', 'auditLogs', 'anon'), {
        action: 'x', at: Date.now(),
      })
    )
  })
})

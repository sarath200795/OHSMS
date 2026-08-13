import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, getDoc, getDocs, collection, query, where, setDoc, deleteDoc, addDoc } from 'firebase/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ID = 'ohsms-demo'
let testEnv

async function seedMember(uid, orgId, role = 'member', status = 'approved') {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'users', uid), { orgId, role, status, name: uid, email: `${uid}@t.co` })
    await setDoc(doc(db, 'organizations', orgId), { name: orgId, createdBy: uid })
  })
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(join(__dirname, '..', 'firestore.rules'), 'utf8') },
  })
})
afterAll(async () => { await testEnv?.cleanup() })
beforeEach(async () => {
  await testEnv.clearFirestore()
  await seedMember('alice', 'orgA', 'admin')
  await seedMember('bob', 'orgB', 'admin')
})

describe('PROBE orgIndex name squatting', () => {
  it('bob (admin of orgB) creates a NEW index entry under ANOTHER org name, pointed at orgB', async () => {
    const bob = testEnv.authenticatedContext('bob').firestore()
    // orgA exists but has no index entry yet (pre-index org / self-heal case)
    await assertSucceeds(setDoc(doc(bob, 'orgIndex', 'acme corp'), { orgId: 'orgB', name: 'Acme Corp' }))
  })
  it('and orgA can then never self-heal its own entry', async () => {
    const bob = testEnv.authenticatedContext('bob').firestore()
    await setDoc(doc(bob, 'orgIndex', 'acme corp'), { orgId: 'orgB', name: 'Acme Corp' })
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertFails(setDoc(doc(alice, 'orgIndex', 'acme corp'), { orgId: 'orgA', name: 'Acme Corp' }))
  })
  it('orgIndex is fully LISTABLE by an unauthenticated stranger', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'orgIndex', 'acme corp'), { orgId: 'orgA', name: 'Acme Corp' })
    })
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertSucceeds(getDocs(collection(anon, 'orgIndex')))
  })
})

describe('PROBE procedureQr mirror squatting', () => {
  it('bob pre-creates the public mirror for orgA procedure id P1', async () => {
    const bob = testEnv.authenticatedContext('bob').firestore()
    await assertSucceeds(setDoc(doc(bob, 'procedureQr', 'P1'), { orgId: 'orgB', title: 'SAFE TO WORK', points: [] }))
  })
  it('orgA can then never publish or correct its own mirror', async () => {
    const bob = testEnv.authenticatedContext('bob').firestore()
    await setDoc(doc(bob, 'procedureQr', 'P1'), { orgId: 'orgB', title: 'SAFE TO WORK', points: [] })
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertFails(setDoc(doc(alice, 'procedureQr', 'P1'), { orgId: 'orgA', title: 'Real', points: [] }))
    await assertFails(deleteDoc(doc(alice, 'procedureQr', 'P1')))
  })
})

describe('PROBE cross-tenant listing of LOTO top-level collections', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      await setDoc(doc(db, 'procedures', 'pa'), { orgId: 'orgA', title: 'A secret' })
      await setDoc(doc(db, 'procedures', 'pb'), { orgId: 'orgB', title: 'B' })
      await setDoc(doc(db, 'technicians', 'ta'), { orgId: 'orgA', name: 'A tech' })
    })
  })
  it('bob CANNOT list all procedures', async () => {
    const bob = testEnv.authenticatedContext('bob').firestore()
    await assertFails(getDocs(collection(bob, 'procedures')))
  })
  it('bob CANNOT get orgA procedure by id', async () => {
    const bob = testEnv.authenticatedContext('bob').firestore()
    await assertFails(getDoc(doc(bob, 'procedures', 'pa')))
  })
  it('bob CANNOT query procedures where orgId==orgA', async () => {
    const bob = testEnv.authenticatedContext('bob').firestore()
    await assertFails(getDocs(query(collection(bob, 'procedures'), where('orgId', '==', 'orgA'))))
  })
  it('bob CAN list his own filtered by orgId', async () => {
    const bob = testEnv.authenticatedContext('bob').firestore()
    await assertSucceeds(getDocs(query(collection(bob, 'procedures'), where('orgId', '==', 'orgB'))))
  })
})

describe('PROBE public surfaces', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      await setDoc(doc(db, 'qr', 'TOKENA'), { orgId: 'orgA', extId: 'E1', assetKind: 'aed', assetRefId: 'R1' })
      await setDoc(doc(db, 'permitQr', 'PTOKA'), { orgId: 'orgA', permitId: 'PERM1', holder: 'Ravi' })
    })
  })
  it('anon can GET a qr mirror but NOT list', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertSucceeds(getDoc(doc(anon, 'qr', 'TOKENA')))
    await assertFails(getDocs(collection(anon, 'qr')))
    await assertFails(getDocs(collection(anon, 'permitQr')))
    await assertFails(getDocs(collection(anon, 'procedureQr')))
  })
  it('anon CANNOT file a report into orgB using an orgA token', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertFails(addDoc(collection(anon, 'organizations', 'orgB', 'reports'), {
      source: 'qr', token: 'TOKENA', approvalStatus: 'pending', reportedBy: 'public',
      note: 'x', kind: 'defect', extId: 'E1',
    }))
  })
  it('anon CAN file a report into orgA with the orgA token', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertSucceeds(addDoc(collection(anon, 'organizations', 'orgA', 'reports'), {
      source: 'qr', token: 'TOKENA', approvalStatus: 'pending', reportedBy: 'public',
      note: 'x', kind: 'defect', extId: 'E1',
    }))
  })
  it('anon CANNOT read reports back', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertFails(getDocs(collection(anon, 'organizations', 'orgA', 'reports')))
  })
})

describe('PROBE cross-tenant org data', () => {
  it('bob cannot read orgA module data or users', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'organizations', 'orgA', 'incidents', 'i1'), { title: 'x' })
    })
    const bob = testEnv.authenticatedContext('bob').firestore()
    await assertFails(getDocs(collection(bob, 'organizations', 'orgA', 'incidents')))
    await assertFails(getDoc(doc(bob, 'organizations', 'orgA')))
    await assertFails(getDocs(query(collection(bob, 'users'), where('orgId', '==', 'orgA'))))
    await assertFails(getDocs(collection(bob, 'users')))
  })
  it('a PENDING member of orgA cannot read orgA users', async () => {
    await seedMember('pend', 'orgA', 'member', 'pending')
    const p = testEnv.authenticatedContext('pend').firestore()
    await assertFails(getDocs(query(collection(p, 'users'), where('orgId', '==', 'orgA'))))
  })
})

describe('PROBE documents site scoping', () => {
  beforeEach(async () => {
    await seedMember('carl', 'orgA', 'member')
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      await setDoc(doc(db, 'organizations', 'orgA', 'documents', 'd1'),
        { visibility: 'site', siteId: 'S1', siteRegion: '', siteEntity: '', title: 'restricted' })
      await setDoc(doc(db, 'organizations', 'orgA', 'documents', 'd2'),
        { visibility: 'all', siteId: '', siteRegion: '', siteEntity: '', title: 'open' })
      // a legacy document with NO visibility field at all
      await setDoc(doc(db, 'organizations', 'orgA', 'documents', 'd3'), { title: 'legacy' })
    })
  })
  it('carl (no site access) cannot get the site-scoped doc', async () => {
    const carl = testEnv.authenticatedContext('carl').firestore()
    await assertFails(getDoc(doc(carl, 'organizations', 'orgA', 'documents', 'd1')))
  })
  it('carl listing the library fails outright because of the unstamped doc', async () => {
    const carl = testEnv.authenticatedContext('carl').firestore()
    await assertFails(getDocs(collection(carl, 'organizations', 'orgA', 'documents')))
  })
  it('carl can still WRITE a site-scoped document he cannot read', async () => {
    const carl = testEnv.authenticatedContext('carl').firestore()
    await assertSucceeds(setDoc(doc(carl, 'organizations', 'orgA', 'documents', 'd1'),
      { visibility: 'site', siteId: 'S1', siteRegion: '', siteEntity: '', title: 'overwritten' }))
  })
})

describe('PROBE auditor write paths', () => {
  beforeEach(async () => { await seedMember('aud', 'orgA', 'auditor') })
  it('auditor cannot write module data', async () => {
    const aud = testEnv.authenticatedContext('aud').firestore()
    await assertFails(addDoc(collection(aud, 'organizations', 'orgA', 'incidents'), { title: 'x' }))
  })
  it('auditor CAN write an audit log entry', async () => {
    const aud = testEnv.authenticatedContext('aud').firestore()
    await assertSucceeds(addDoc(collection(aud, 'organizations', 'orgA', 'auditLogs'), { actorUid: 'aud', action: 'x' }))
  })
})

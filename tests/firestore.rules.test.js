import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest'
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'

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

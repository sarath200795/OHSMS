// organizations/{orgId}/alertReads/{uid} is one person's list of alert rows
// they have already opened. It is not a feed. The feed is the collections
// that already exist.
//
// The generic /{col}/{docId} grant is what would let any approved member
// overwrite a colleague's cursor, or store an arbitrary document here. The
// narrow match below cannot take that grant away — rules are a permissive
// union — so structuralOnly() excludes the collection, and this match is the
// only way in: your own uid, two fields, a bounded string.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest'
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing'
import {
  doc,
  getDoc,
  getDocs,
  collection,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ID = 'ohsms-demo'
const ORG = 'orgA'

let testEnv

const user = (uid, extra = {}) => ({
  orgId: ORG,
  role: 'member',
  status: 'approved',
  name: uid,
  email: `${uid}@t.co`,
  ...extra,
})

const own = (ids = 'defect:r1,incident:i1') => ({ ids, updatedAt: serverTimestamp() })

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
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'organizations', ORG), { name: ORG, createdBy: 'admin1' })
    await setDoc(doc(db, 'users', 'admin1'), user('admin1', { role: 'admin' }))
    await setDoc(doc(db, 'users', 'member1'), user('member1'))
    await setDoc(doc(db, 'users', 'auditor1'), user('auditor1', { role: 'auditor' }))
    await setDoc(doc(db, 'users', 'outsider'), user('outsider', { orgId: 'orgB' }))
    await setDoc(doc(db, 'organizations', ORG, 'alertReads', 'member1'), {
      ids: 'defect:kept',
      updatedAt: new Date(),
    })
  })
})

const as = (uid) => testEnv.authenticatedContext(uid).firestore()
const cursor = (db, uid = 'member1') => doc(db, 'organizations', ORG, 'alertReads', uid)

describe('alert read cursors', () => {
  it('lets a member read and replace only their own cursor', async () => {
    await assertSucceeds(getDoc(cursor(as('member1'))))
    await assertSucceeds(setDoc(cursor(as('member1')), own()))
    await assertSucceeds(
      setDoc(cursor(as('auditor1'), 'auditor1'), own('weather:s1:2026-10-24T12+0530:heat'))
    )
  })

  it('refuses another person, another org, a signed-out caller, and a delete', async () => {
    await assertFails(getDoc(cursor(as('admin1'))))
    await assertFails(setDoc(cursor(as('admin1')), own()))
    await assertFails(setDoc(cursor(as('outsider')), own()))
    await assertFails(getDoc(cursor(testEnv.unauthenticatedContext().firestore())))
    await assertFails(deleteDoc(cursor(as('member1'))))
  })

  it('refuses a payload the generic collection rule would otherwise have stored', async () => {
    await assertFails(
      setDoc(cursor(as('member1')), { note: 'not a cursor', updatedAt: serverTimestamp() })
    )
    await assertFails(
      setDoc(cursor(as('member1')), { ids: 'x'.repeat(4001), updatedAt: serverTimestamp() })
    )
    await assertFails(
      setDoc(cursor(as('member1')), { ids: 'javascript:alert(1)', updatedAt: serverTimestamp() })
    )
    await assertFails(
      setDoc(doc(as('member1'), 'organizations', ORG, 'alertReads', 'member1', 'extra', 'x'), {
        ids: 'defect:r1',
      })
    )
  })

  it('refuses to list the collection, which is how one read becomes every read', async () => {
    await assertFails(getDocs(collection(as('member1'), 'organizations', ORG, 'alertReads')))
  })
})

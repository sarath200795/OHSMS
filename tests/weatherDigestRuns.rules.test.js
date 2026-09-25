// organizations/{orgId}/weatherDigestRuns/{bucket} is the digest's scratch
// pad: readings already fetched this slot, and whether the mail has gone.
//
// The function writes it with the Admin SDK, which does not consult these
// rules. A client who can write it can set status to 'sent' and the rest of
// the slot never mails, or store a wind speed the provider did not send and
// have that number printed to every admin. The generic /{col}/{docId} grant
// is what would allow that. structuralOnly() has to exclude the collection;
// the narrow `if false` block does not, on its own, because rules are a
// permissive union.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest'
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing'
import { doc, getDoc, getDocs, collection, setDoc, updateDoc, deleteDoc } from 'firebase/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ID = 'ohsms-demo'
const ORG = 'orgA'
const BUCKET = '2026-09-26T00+0530'

let testEnv

const user = (uid, extra = {}) => ({
  orgId: ORG,
  role: 'member',
  status: 'approved',
  name: uid,
  email: `${uid}@t.co`,
  ...extra,
})

const ROW = {
  status: 'open',
  bucket: BUCKET,
  observations: [{ key: '17.44,78.39', obs: { windKph: 55 } }],
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
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'organizations', ORG), { name: ORG, createdBy: 'admin1' })
    await setDoc(doc(db, 'users', 'admin1'), user('admin1', { role: 'admin' }))
    await setDoc(doc(db, 'users', 'manager1'), user('manager1', { role: 'manager' }))
    await setDoc(doc(db, 'users', 'member1'), user('member1'))
    await setDoc(doc(db, 'organizations', ORG, 'weatherDigestRuns', BUCKET), ROW)
  })
})

const as = (uid) => testEnv.authenticatedContext(uid).firestore()
const run = (db) => doc(db, 'organizations', ORG, 'weatherDigestRuns', BUCKET)

// An admin is included on purpose. The role that receives the mail is the
// one with the most reason to suppress it.
const CALLERS = ['admin1', 'manager1', 'member1']

describe('clients cannot read or write a weather digest run', () => {
  it.each(CALLERS)('refuses a get and a list to %s', async (uid) => {
    await assertFails(getDoc(run(as(uid))))
    await assertFails(getDocs(collection(as(uid), 'organizations', ORG, 'weatherDigestRuns')))
  })

  it.each(CALLERS)('refuses create, update and delete to %s', async (uid) => {
    await assertFails(updateDoc(run(as(uid)), { status: 'sent' }))
    await assertFails(deleteDoc(run(as(uid))))
    await assertFails(
      setDoc(doc(as(uid), 'organizations', ORG, 'weatherDigestRuns', '2026-09-26T06+0530'), {
        status: 'sent',
      })
    )
  })

  it('refuses a nested document under the run', async () => {
    const nested = doc(
      as('admin1'),
      'organizations',
      ORG,
      'weatherDigestRuns',
      BUCKET,
      'notes',
      'n1'
    )
    await assertFails(getDoc(nested))
    await assertFails(setDoc(nested, { status: 'sent' }))
  })

  it('refuses an unauthenticated read', async () => {
    await assertFails(getDoc(run(testEnv.unauthenticatedContext().firestore())))
  })
})

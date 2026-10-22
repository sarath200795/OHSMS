// The WhatsApp lookup's collections are server-only: the Cloud Functions write
// them with the Admin SDK, and no client — not an org admin, not the person a
// row is about — may read or write any of them.
//
// Hostile cases, because those are the ones that matter:
//   • a member planting waLinks/{their phone} = { uid: an admin } would have
//     every site the admin reaches sent to their phone
//   • reading waLinkCodes is linking as somebody else
//   • editing waRate unblocks a guessing run; deleting waInbound replays a message
//   • waQueryLog is the record of who looked at what; its subject must not erase it
//   • waSiteSnapshots carries counts for sites a member does not reach
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest'
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing'
import {
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  setDoc,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ID = 'ohsms-demo'
const ORG = 'orgA'
const PHONE = '919000000001'

let testEnv

const user = (uid, extra = {}) => ({
  orgId: ORG,
  role: 'member',
  status: 'approved',
  name: uid,
  email: `${uid}@t.co`,
  ...extra,
})

const SEED = {
  waLinks: [PHONE, { uid: 'member1', orgId: ORG, last4: '0001' }],
  waLinkCodes: ['c'.repeat(64), { uid: 'admin1', orgId: ORG, expiresAtMs: Date.now() + 600000 }],
  waInbound: ['a'.repeat(64), { at: 1 }],
  waRate: ['b'.repeat(32), { hourCount: 30, linkBlockedUntilMs: Date.now() + 86400000 }],
  waQueryLog: ['log1', { orgId: ORG, uid: 'member1', siteId: 's1', outcome: 'ok' }],
  waSiteSnapshots: [ORG, { orgId: ORG, v: 1, sites: { s1: [1, 2, 3] } }],
  waSessions: [
    'd'.repeat(32),
    { uid: 'member1', orgId: ORG, choices: ['s1'], expiresAtMs: Date.now() + 900000 },
  ],
  // The on/off switch. A client write here would turn lookup off (or on) for
  // a tenant without the callable's admin check.
  waOrgSettings: [ORG, { enabled: false, updatedBy: 'admin1' }],
}
const COLLECTIONS = Object.keys(SEED)
const CALLERS = ['admin1', 'manager1', 'member1']

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
    for (const [col, [id, data]] of Object.entries(SEED)) await setDoc(doc(db, col, id), data)
  })
})

const as = (uid) => testEnv.authenticatedContext(uid).firestore()

describe.each(COLLECTIONS)('%s is server-only', (col) => {
  const [id] = SEED[col]

  it.each(CALLERS)('refuses get, list and a filtered query to %s', async (uid) => {
    const db = as(uid)
    await assertFails(getDoc(doc(db, col, id)))
    await assertFails(getDocs(collection(db, col)))
    await assertFails(getDocs(query(collection(db, col), where('uid', '==', uid))))
  })

  it.each(CALLERS)('refuses create, update and delete to %s', async (uid) => {
    const db = as(uid)
    await assertFails(setDoc(doc(db, col, `planted-${uid}`), { uid, orgId: ORG }))
    await assertFails(updateDoc(doc(db, col, id), { uid }))
    await assertFails(setDoc(doc(db, col, id), { uid, orgId: ORG }, { merge: true }))
    await assertFails(deleteDoc(doc(db, col, id)))
  })

  it('refuses an unauthenticated caller', async () => {
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(db, col, id)))
    await assertFails(setDoc(doc(db, col, 'anon'), { x: 1 }))
  })
})

describe('the attacks the denial exists for', () => {
  it('a member cannot bind their own phone to an admin', async () => {
    await assertFails(
      setDoc(doc(as('member1'), 'waLinks', '919999999999'), { uid: 'admin1', orgId: ORG })
    )
  })

  it('the person a link is about cannot read or delete it directly', async () => {
    await assertFails(getDoc(doc(as('member1'), 'waLinks', PHONE)))
    await assertFails(deleteDoc(doc(as('member1'), 'waLinks', PHONE)))
  })

  it('nobody can read a live link code', async () => {
    await assertFails(
      getDocs(query(collection(as('admin1'), 'waLinkCodes'), where('uid', '==', 'admin1')))
    )
  })

  it('a blocked number cannot be unblocked from the client', async () => {
    await assertFails(
      updateDoc(doc(as('member1'), 'waRate', SEED.waRate[0]), { linkBlockedUntilMs: 0 })
    )
  })

  it('a member cannot plant a pick-list pointing at a site outside their reach', async () => {
    await assertFails(
      setDoc(doc(as('member1'), 'waSessions', 'd'.repeat(32)), {
        uid: 'member1',
        orgId: ORG,
        choices: ['s9'],
        expiresAtMs: Date.now() + 900000,
      })
    )
  })

  it('the subject of a log row cannot erase it', async () => {
    await assertFails(deleteDoc(doc(as('member1'), 'waQueryLog', 'log1')))
  })

  it('an admin cannot read or flip the WhatsApp switch from the client', async () => {
    await assertFails(getDoc(doc(as('admin1'), 'waOrgSettings', ORG)))
    await assertFails(updateDoc(doc(as('admin1'), 'waOrgSettings', ORG), { enabled: true }))
    await assertFails(setDoc(doc(as('admin1'), 'waOrgSettings', 'orgB'), { enabled: true }))
  })
})

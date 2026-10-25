// siteAuditCache/{orgId}/sites/{siteId} is the last-audit extract the lookup
// bots read. The schedule writes it with the Admin SDK.
//
// A client who can write it can plant a score. A client who can read it
// gets warehouse observation text the bot only sends after a reach check.
// It is top-level on purpose. Putting it under organizations would add a
// conjunct to structuralOnly(), and that function is already at the
// 1000-expression ceiling: the extinguisher close that moves both dates
// was denied for exhausting the budget, not for breaking a rule.
//
// The legacy /{legacyCol}/{docId} wildcard matches the org document. It
// does not name this collection, so it must not grant the write either.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest'
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing'
import { doc, getDoc, getDocs, collection, setDoc, updateDoc, deleteDoc } from 'firebase/firestore'

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

const ROW = {
  none: false,
  date: '2026-03-02',
  scoreOnDay: 82,
  findingsKnown: true,
  openPoints: ['Fire: Exit route blocked'],
  openTotal: 1,
  openMore: 0,
  windowDays: 120,
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
    await setDoc(doc(db, 'users', 'auditor1'), user('auditor1', { role: 'auditor' }))
    await setDoc(doc(db, 'users', 'member1'), user('member1'))
    await setDoc(doc(db, 'siteAuditCache', ORG, 'sites', 's1'), ROW)
  })
})

const as = (uid) => testEnv.authenticatedContext(uid).firestore()
const row = (db) => doc(db, 'siteAuditCache', ORG, 'sites', 's1')

// An admin and an auditor are included on purpose. The admin is who would
// "correct" a score, and the auditor is the outside reader the generic rule
// already lets into ordinary collections.
const CALLERS = ['admin1', 'manager1', 'auditor1', 'member1']

describe('clients cannot read or write a site audit cache', () => {
  it.each(CALLERS)('refuses a get and a list to %s', async (uid) => {
    await assertFails(getDoc(row(as(uid))))
    await assertFails(getDocs(collection(as(uid), 'siteAuditCache', ORG, 'sites')))
  })

  it.each(CALLERS)('refuses create, update and delete to %s', async (uid) => {
    await assertFails(updateDoc(row(as(uid)), { scoreOnDay: 100 }))
    await assertFails(deleteDoc(row(as(uid))))
    await assertFails(
      setDoc(doc(as(uid), 'siteAuditCache', ORG, 'sites', 's2'), { none: true, scoreOnDay: 100 })
    )
    // The two-segment path is what the legacy wildcard matches.
    await assertFails(setDoc(doc(as(uid), 'siteAuditCache', ORG), { scoreOnDay: 100 }))
  })

  it('refuses a nested document under the cache', async () => {
    const nested = doc(as('admin1'), 'siteAuditCache', ORG, 'sites', 's1', 'notes', 'n1')
    await assertFails(getDoc(nested))
    await assertFails(setDoc(nested, { scoreOnDay: 100 }))
  })

  it('refuses an unauthenticated read', async () => {
    await assertFails(getDoc(row(testEnv.unauthenticatedContext().firestore())))
  })
})

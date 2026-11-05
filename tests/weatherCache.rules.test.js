// weatherCache/{grid} is the reading fetchSiteWeather and the digest share.
//
// The function writes it with the Admin SDK, which does not consult these
// rules. A client who can write it can put a temperature on the home tile,
// the site page and the mail. isLegacyOrgCollection does not name this path,
// and the match below refuses it outright.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest'
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore'

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
    await setDoc(doc(db, 'weatherCache', 'om_17.44_78.39'), {
      slot: '2026-09-23T06+0530',
      obs: { tempC: 42, observedAt: '2026-09-23T05:30:00.000Z' },
    })
  })
})

const as = (uid) => testEnv.authenticatedContext(uid).firestore()

describe('clients cannot read or write the shared weather reading', () => {
  it.each(['admin1', 'member1'])('refuses a get, a write and a delete to %s', async (uid) => {
    const ref = doc(as(uid), 'weatherCache', 'om_17.44_78.39')
    await assertFails(getDoc(ref))
    await assertFails(setDoc(ref, { slot: '2026-09-23T06+0530', obs: { tempC: 99 } }))
    await assertFails(deleteDoc(ref))
    await assertFails(
      setDoc(doc(as(uid), 'weatherCache', 'other'), { slot: 'x', obs: { tempC: 1 } })
    )
  })

  it('refuses an unauthenticated read', async () => {
    await assertFails(
      getDoc(doc(testEnv.unauthenticatedContext().firestore(), 'weatherCache', 'om_17.44_78.39'))
    )
  })
})

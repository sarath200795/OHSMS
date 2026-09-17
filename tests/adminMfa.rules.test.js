// ─────────────────────────────────────────────────────────────────────────────
// Admin MFA in firestore.rules is drafted and OFF.
//
// requireAdminMfa() returns false. Flipping it would lock every admin who has
// not enrolled TOTP (and signed in again) out of isAdminOf — member
// provisioning, role changes, the organization document. These tests pin that
// the lock is not live, and that an admin token carrying sign_in_second_factor
// still works so the helper is wired to the claim this app actually uses.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest'
import { initializeTestEnvironment, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc } from 'firebase/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ORG = 'orgOne'
let testEnv

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'ohsms-demo',
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
    await setDoc(doc(db, 'organizations', ORG), { name: 'One', createdBy: 'adm' })
    await setDoc(doc(db, 'users', 'adm'), {
      orgId: ORG,
      role: 'admin',
      status: 'approved',
      name: 'adm',
      email: 'adm@t.co',
    })
  })
})

describe('admin MFA lock is off', () => {
  it('an admin without sign_in_second_factor can still update the org', async () => {
    const db = testEnv.authenticatedContext('adm').firestore()
    await assertSucceeds(updateDoc(doc(db, 'organizations', ORG), { name: 'One renamed' }))
  })

  it('an admin whose token carries totp can still update the org', async () => {
    const db = testEnv
      .authenticatedContext('adm', {
        firebase: { sign_in_provider: 'password', sign_in_second_factor: 'totp' },
      })
      .firestore()
    await assertSucceeds(updateDoc(doc(db, 'organizations', ORG), { name: 'One with MFA' }))
  })
})

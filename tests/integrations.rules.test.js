// ─────────────────────────────────────────────────────────────────────────────
// organizations/{orgId}/integrations is reachable by administrators, and by
// nobody else.
//
// It holds third-party CREDENTIALS — today the Metabase API key ODIN queries
// the analytics warehouse with. That key is a bearer token for every question
// and every database the Metabase instance can reach, which is a far wider
// grant than anything else stored in a tenant: reading it does not expose one
// organization's safety data, it exposes whatever the warehouse holds.
//
// Two things are proved here, and the second is the one that would have hurt.
// Without the `col != 'integrations'` conjunct in structuralOnly(), the generic
// /{col}/{docId} rule grants BOTH:
//
//   · read to every approved member — and to the outside auditor, who is a
//     third party given a login to inspect the safety record. One getDoc.
//   · create/update to every writer. That is the sharper one: a member who can
//     write this document can repoint `baseUrl` at an instance they control
//     and collect the key the next admin types beside it, or simply swap the
//     key for their own and read whatever the dashboard then renders.
//
// The admin grant is asserted too, not just the denials. A test that only
// proved the refusals would pass just as well for the change that breaks the
// settings screen entirely.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, getDoc, getDocs, collection, setDoc, updateDoc, deleteDoc } from 'firebase/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ID = 'ohsms-demo'
const ORG = 'orgA'

let testEnv

const user = (uid, extra = {}) => ({
  orgId: ORG, role: 'member', status: 'approved', name: uid, email: `${uid}@t.co`, ...extra,
})

// The shape functions/lib/metabase.js normalizes. `apiKey` is the whole reason
// this file exists.
const CONFIG = {
  baseUrl: 'https://metabase.example.com',
  apiKey: 'mb_a_real_bearer_credential',
  cards: { findings: 41, audits: 42 },
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

    await setDoc(doc(db, 'organizations', 'orgB'), { name: 'orgB', createdBy: 'otherAdmin' })
    // An ADMIN of another tenant, deliberately: the role is not the boundary,
    // the organization is, and an admin is the strongest caller who must still
    // be refused here.
    await setDoc(doc(db, 'users', 'otherAdmin'), user('otherAdmin', { orgId: 'orgB', role: 'admin' }))

    await setDoc(doc(db, 'organizations', ORG, 'integrations', 'metabase'), CONFIG)
  })
})

const as = (uid) => testEnv.authenticatedContext(uid).firestore()
const config = (db) => doc(db, 'organizations', ORG, 'integrations', 'metabase')
const integrations = (db) => collection(db, 'organizations', ORG, 'integrations')

const NOT_ADMIN = ['manager1', 'auditor1', 'member1', 'otherAdmin']

describe('only an admin of this organization can read the credential', () => {
  it.each(NOT_ADMIN)('refuses a direct get to %s', async (uid) => {
    await assertFails(getDoc(config(as(uid))))
  })

  it.each(NOT_ADMIN)('refuses a list that would sweep it up to %s', async (uid) => {
    // The get and the list are separate grants and a rule can refuse one while
    // allowing the other. A list is the cheaper attack: one call, and no
    // document id to guess.
    await assertFails(getDocs(integrations(as(uid))))
  })

  it('refuses an unauthenticated read', async () => {
    await assertFails(getDoc(config(testEnv.unauthenticatedContext().firestore())))
  })

  it('lets this org’s admin read it', async () => {
    const snap = await assertSucceeds(getDoc(config(as('admin1'))))
    expect(snap.data().cards.findings).toBe(41)
  })
})

describe('only an admin of this organization can write the credential', () => {
  it.each(NOT_ADMIN)('refuses an overwrite by %s', async (uid) => {
    // The attack this closes: repoint baseUrl at an instance the writer
    // controls, and collect the key the next admin types beside it.
    await assertFails(setDoc(config(as(uid)), { ...CONFIG, baseUrl: 'https://evil.example.com' }))
  })

  it.each(NOT_ADMIN)('refuses a partial update by %s', async (uid) => {
    // A merge is the version that looks harmless. Changing one field is all
    // this particular attack needs.
    await assertFails(updateDoc(config(as(uid)), { baseUrl: 'https://evil.example.com' }))
  })

  it.each(NOT_ADMIN)('refuses a delete by %s', async (uid) => {
    await assertFails(deleteDoc(config(as(uid))))
  })

  it.each(NOT_ADMIN)('refuses a create where none exists yet, by %s', async (uid) => {
    // The organization that has not connected Metabase. A member who could
    // create this document would choose the instance their colleagues' ODIN
    // dashboard talks to.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await deleteDoc(doc(ctx.firestore(), 'organizations', ORG, 'integrations', 'metabase'))
    })
    await assertFails(setDoc(config(as(uid)), CONFIG))
  })

  it('lets this org’s admin save and change it', async () => {
    await assertSucceeds(updateDoc(config(as('admin1')), { 'cards.audits': 99 }))
    await assertSucceeds(deleteDoc(config(as('admin1'))))
    await assertSucceeds(setDoc(config(as('admin1')), CONFIG))
  })
})

describe('the exclusion holds for a collection nobody has invented yet', () => {
  it('refuses any other document under /integrations to a member', async () => {
    // The rule is written against the COLLECTION, not against the one document
    // in it today. A second credential — the next connector — must inherit the
    // same refusal without anyone remembering to add it.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'organizations', ORG, 'integrations', 'somethingElse'), { apiKey: 'k' })
    })
    const ref = doc(as('member1'), 'organizations', ORG, 'integrations', 'somethingElse')
    await assertFails(getDoc(ref))
    await assertFails(setDoc(ref, { apiKey: 'mine' }))
  })
})

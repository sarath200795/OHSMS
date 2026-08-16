// ─────────────────────────────────────────────────────────────────────────────
// organizations/{orgId}/meta/cryptoKeys is reachable by no client, at all.
//
// The keyset is the single point on which every encrypted field in a tenant
// depends. It is created and read only by the getDataKeys callable, which
// decides class by class what a caller's role entitles them to; a client that
// could touch this document directly would be going round that decision.
//
// Two things are being proved here, and the second is the one that would have
// hurt. Before the `notKeyset` conjunct, the generic /{col}/{docId} rule granted
// BOTH:
//
//   · read to every approved member, because 'meta' is not in its exclusion
//     list — an offline target consisting of every tenant's wrapped keys;
//   · create/update to every WRITER, because /meta is where meta/stats and the
//     reference-number counters live and members have to write those. One
//     setDoc would replace the keyset, and every value already sealed under the
//     replaced keys becomes permanently unreadable. Destroying a tenant's
//     health records is a worse outcome than reading one, and it was a single
//     call away from any member's browser console.
//
// The neighbouring /meta documents are asserted too, because the fix had to be
// docId-scoped rather than collection-scoped: excluding 'meta' outright would
// have stopped bumpStats and reserveRefNo, and nobody could file an incident.
// A test that only proved the denial would pass just as well for the change
// that breaks the app.
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

// The shape functions/lib/dataKeys.js stores. The wrapped values are opaque to
// every reader — that is the point of wrapping them — but the document must
// still be unreachable, because a wrapped key is an offline target and an
// overwritable key document is a delete button for the tenant's history.
const KEYSET = {
  version: 1,
  general: { keyId: 'general.1', wrappedKey: 'AAAA-wrapped-general' },
  medical: { keyId: 'medical.1', publicKey: 'AAAA-spki', wrappedPrivateKey: 'AAAA-wrapped-medical' },
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

    await setDoc(doc(db, 'organizations', 'orgB'), { name: 'orgB', createdBy: 'stranger' })
    await setDoc(doc(db, 'users', 'stranger'), user('stranger', { orgId: 'orgB' }))

    await setDoc(doc(db, 'organizations', ORG, 'meta', 'cryptoKeys'), KEYSET)
    // The neighbours that must keep working.
    await setDoc(doc(db, 'organizations', ORG, 'meta', 'stats'), { incidents: 3 })
    await setDoc(doc(db, 'organizations', ORG, 'meta', 'illness'), { seq: 7 })
  })
})

const as = (uid) => testEnv.authenticatedContext(uid).firestore()
const keyset = (db) => doc(db, 'organizations', ORG, 'meta', 'cryptoKeys')
const metaCol = (db) => collection(db, 'organizations', ORG, 'meta')

const EVERY_ROLE = ['admin1', 'manager1', 'auditor1', 'member1', 'stranger']

describe('nobody can read the keyset', () => {
  it.each(EVERY_ROLE)('refuses a direct get to %s', async (uid) => {
    // The administrator is on this list on purpose. An admin has every
    // application privilege there is and still has no business holding the
    // wrapped keys directly — they get what they are entitled to through the
    // callable, which unwraps only the halves grantsFor() allows.
    await assertFails(getDoc(keyset(as(uid))))
  })

  it.each(EVERY_ROLE)('refuses a list of /meta that would sweep it up to %s', async (uid) => {
    // The get and the list are separate grants and a rule can refuse one while
    // allowing the other. A list is the cheaper attack: one call, no document
    // id to guess.
    await assertFails(getDocs(metaCol(as(uid))))
  })

  it('refuses an unauthenticated read', async () => {
    await assertFails(getDoc(keyset(testEnv.unauthenticatedContext().firestore())))
  })
})

describe('nobody can destroy the keyset', () => {
  // Overwriting is the sharp edge: the keys stored here are wrapped and useless
  // to whoever reads them, but replacing them makes every value already sealed
  // under the old ones unreadable forever.
  it.each(EVERY_ROLE)('refuses an overwrite by %s', async (uid) => {
    await assertFails(setDoc(keyset(as(uid)), { version: 1, general: { keyId: 'general.1', wrappedKey: 'mine' } }))
  })

  it.each(EVERY_ROLE)('refuses a partial update by %s', async (uid) => {
    // A merge is the version that looks harmless. Replacing one class's key
    // still orphans every value sealed under it.
    await assertFails(updateDoc(keyset(as(uid)), { 'general.wrappedKey': 'mine' }))
  })

  it.each(EVERY_ROLE)('refuses a delete by %s', async (uid) => {
    await assertFails(deleteDoc(keyset(as(uid))))
  })

  it('refuses a create where none exists yet', async () => {
    // The organization that has never called getDataKeys. A member who could
    // create this document would choose the keys their tenant's data is sealed
    // under — and would hold the plaintext of every one of them.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await deleteDoc(doc(ctx.firestore(), 'organizations', ORG, 'meta', 'cryptoKeys'))
    })
    await assertFails(setDoc(keyset(as('admin1')), KEYSET))
    await assertFails(setDoc(keyset(as('member1')), KEYSET))
  })
})

describe('the rest of /meta still works', () => {
  // The reason the exclusion is on the document id and not the collection. If
  // these fail, nobody can file an incident: bumpStats writes meta/stats and
  // reserveRefNo writes the counters.
  it('lets a member read the stats document', async () => {
    await assertSucceeds(getDoc(doc(as('member1'), 'organizations', ORG, 'meta', 'stats')))
  })

  it('lets a member write the stats document', async () => {
    await assertSucceeds(setDoc(doc(as('member1'), 'organizations', ORG, 'meta', 'stats'), { incidents: 4 }))
  })

  it('lets a member write a reference-number counter', async () => {
    await assertSucceeds(updateDoc(doc(as('member1'), 'organizations', ORG, 'meta', 'illness'), { seq: 8 }))
  })

  it('still refuses the auditor a write, as everywhere else', async () => {
    await assertFails(setDoc(doc(as('auditor1'), 'organizations', ORG, 'meta', 'stats'), { incidents: 9 }))
  })
})

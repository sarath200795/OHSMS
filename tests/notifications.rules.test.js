// ─────────────────────────────────────────────────────────────────────────────
// The notification ledger.
//
// sendOnce() claims organizations/{orgId}/notifications/{hash} before every send
// and stores the recipient uid beside the SUBJECT LINE. A subject names a person
// and an event, so an injury or illness notification reprints the detail that
// the injuries/illnesses rules exist to keep away from ordinary members — and
// the ledger had no rule of its own, so it fell through to the generic
// approved-member read and handed all of it back.
//
// Nothing on the client reads this collection; the Admin SDK writes it and
// bypasses rules entirely. So the assertion here is the blunt one: NOBODY gets
// in, by any route. Lists as well as gets, per the S-17 lesson — a rule can
// refuse one document while an unfiltered query walks the whole collection, and
// the query is the shape that empties a mailbox in one request.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, getDoc, getDocs, collection, query, where, setDoc } from 'firebase/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ID = 'ohsms-demo'
const ORG = 'orgA'

let testEnv

const user = (uid, extra = {}) => ({
  orgId: ORG, role: 'member', status: 'approved', name: uid, email: `${uid}@t.co`, ...extra,
})

// The shape lib/notify.js actually writes, subject and all.
const LEDGER_ROW = {
  kind: 'injury.reported',
  key: ['orgA', 'injuries', 'inj-1', 'reported'],
  uid: 'member1',
  subject: 'Injury reported: R. Osei — laceration to left hand',
  status: 'sent',
  claimedAt: new Date('2026-01-04T09:00:00Z'),
  expiresAt: new Date('2026-02-03T09:00:00Z'),
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

    // Written the way the Admin SDK writes it — rules disabled, because rules
    // are not what stops or allows that write.
    await setDoc(doc(db, 'organizations', ORG, 'notifications', 'abc123'), LEDGER_ROW)
    // Nothing nests under a ledger row today. Seeded anyway, because the
    // recursive wildcard on the generic match would re-grant the whole subtree
    // the moment somebody did nest something.
    await setDoc(doc(db, 'organizations', ORG, 'notifications', 'abc123', 'attempts', 'a1'), {
      subject: LEDGER_ROW.subject, at: new Date('2026-01-04T09:00:01Z'),
    })

    // The neighbours, for proving the exclusion did not spill.
    await setDoc(doc(db, 'organizations', ORG, 'incidents', 'i1'), { title: 'Slip in bay 3' })
    await setDoc(doc(db, 'organizations', ORG, 'documents', 'orgDoc'), {
      title: 'HSE Policy', level: 'org', visibility: 'all', siteId: '',
    })
    await setDoc(doc(db, 'organizations', ORG, 'injuries', 'inj-1'), {
      personName: 'R. Osei', medication: 'co-codamol',
    })
  })
})

const as = (uid) => testEnv.authenticatedContext(uid).firestore()
const ledger = (db) => collection(db, 'organizations', ORG, 'notifications')
const row = (db) => doc(db, 'organizations', ORG, 'notifications', 'abc123')

describe('an approved member cannot read the notification ledger', () => {
  it('refuses a get of a single ledger document', async () => {
    await assertFails(getDoc(row(as('member1'))))
  })

  // The one that matters: one query, every subject in the tenant.
  it('refuses a list of the collection', async () => {
    await assertFails(getDocs(ledger(as('member1'))))
  })

  // No narrowing buys a way in — not even asking only for your own rows, which
  // is the query somebody would reach for first if they wanted a feature here.
  it('refuses a query narrowed to the caller own notifications', async () => {
    await assertFails(getDocs(query(ledger(as('member1')), where('uid', '==', 'member1'))))
  })

  it('refuses a get of an id that is not there, rather than confirming absence', async () => {
    await assertFails(getDoc(doc(as('member1'), 'organizations', ORG, 'notifications', 'no-such-id')))
  })
})

// Not a role gate. The Admin SDK bypasses rules, so no human account needs this
// collection and none of them get it — which is also what stops the fix being
// undone by handing an admin screen a read it appears to be owed.
describe('no role gets in either', () => {
  for (const uid of ['manager1', 'admin1', 'auditor1']) {
    it(`refuses ${uid} both by get and by list`, async () => {
      await assertFails(getDoc(row(as(uid))))
      await assertFails(getDocs(ledger(as(uid))))
    })
  }

  it('refuses another tenant and a signed-out caller', async () => {
    await assertFails(getDocs(ledger(as('stranger'))))
    await assertFails(getDocs(ledger(testEnv.unauthenticatedContext().firestore())))
  })
})

// The generic match carries a `{sub=**}` that also matches the parent document.
// If 'notifications' were excluded from the outer read and not the inner one,
// every test above would still pass while the subtree stayed wide open.
describe('nothing nested under a ledger row is readable', () => {
  it('refuses a subcollection document to a member and to an admin', async () => {
    for (const uid of ['member1', 'admin1']) {
      const attempt = doc(as(uid), 'organizations', ORG, 'notifications', 'abc123', 'attempts', 'a1')
      await assertFails(getDoc(attempt))
      await assertFails(getDocs(collection(as(uid), 'organizations', ORG, 'notifications', 'abc123', 'attempts')))
    }
  })
})

// A blanket lockout would pass every test above and break the product. These
// are the reads that must not have moved.
describe('the exclusion is surgical', () => {
  it('still lets a member get and list an ordinary module collection', async () => {
    await assertSucceeds(getDoc(doc(as('member1'), 'organizations', ORG, 'incidents', 'i1')))
    await assertSucceeds(getDocs(collection(as('member1'), 'organizations', ORG, 'incidents')))
  })

  it('still lets a member read an org-level document from the library', async () => {
    await assertSucceeds(getDoc(doc(as('member1'), 'organizations', ORG, 'documents', 'orgDoc')))
  })

  it('leaves the health records exactly where they were, manager yes member no', async () => {
    await assertSucceeds(getDoc(doc(as('manager1'), 'organizations', ORG, 'injuries', 'inj-1')))
    await assertFails(getDoc(doc(as('member1'), 'organizations', ORG, 'injuries', 'inj-1')))
  })

  it('still lets a member write an ordinary module collection', async () => {
    await assertSucceeds(
      setDoc(doc(as('member1'), 'organizations', ORG, 'incidents', 'i2'), { title: 'Near miss' })
    )
  })
})

// Only the read was narrowed. Writes still fall through to the generic rule,
// deliberately: a client write here creates a ledger row that suppresses a mail
// it can no longer read back, which is a nuisance rather than a disclosure, and
// closing it is a different change with a different blast radius.
describe('the write path is untouched', () => {
  it('a member can still create a row, and still cannot read one back', async () => {
    const db = as('member1')
    const mine = doc(db, 'organizations', ORG, 'notifications', 'written-by-client')
    await assertSucceeds(setDoc(mine, { kind: 'test', uid: 'member1', subject: 'x', status: 'sent' }))
    await assertFails(getDoc(mine))
  })
})

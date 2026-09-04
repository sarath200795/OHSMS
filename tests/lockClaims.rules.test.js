// ─────────────────────────────────────────────────────────────────────────────
// The padlock claim — one document per lock currently applied.
//
// The document ID IS the padlock (`${orgId}__${lockNo}`), which is the whole
// mechanism: two operators claiming lock 12 are two writes to one document, and
// Firestore serialises those. So the tests that matter are the ones that try to
// take a claim somebody already holds, and the one that tries to plant a claim
// at another tenant's address.
//
// That second attack is the sharper of the two and the reason the id prefix is
// pinned. Registering an organization is self-service, so an attacker can
// always satisfy isWriterOf for an org of their own; without the prefix check
// they could create lockClaims/VICTIM__12 carrying their OWN orgId. The victim
// then cannot read it (the read rule keys off the claim's orgId, which is the
// attacker's), so every setPointLock transaction that touches lock 12 fails
// permission-denied — and they cannot delete it either. Padlock 12 becomes
// permanently unusable in their isolation system, repeatable for every number.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc, getDoc, deleteDoc } from 'firebase/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
let testEnv

const VICTIM = 'orgVictim'
const ATTACKER = 'orgAttacker'

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'ohsms-demo',
    firestore: { rules: readFileSync(join(__dirname, '..', 'firestore.rules'), 'utf8') },
  })
})
afterAll(async () => { await testEnv?.cleanup() })

beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    for (const [org, uid] of [[VICTIM, 'vic'], [ATTACKER, 'mal']]) {
      await setDoc(doc(db, 'organizations', org), { name: org, createdBy: uid })
      await setDoc(doc(db, 'users', uid), {
        orgId: org, role: 'admin', status: 'approved', name: uid, email: `${uid}@t.co`,
      })
    }
    await setDoc(doc(db, 'users', 'mem'), {
      orgId: VICTIM, role: 'member', status: 'approved', name: 'Mem', email: 'mem@t.co',
    })
    await setDoc(doc(db, 'users', 'aud'), {
      orgId: VICTIM, role: 'auditor', status: 'approved', name: 'Aud', email: 'aud@t.co',
    })
    await setDoc(doc(db, 'users', 'pend'), {
      orgId: VICTIM, role: 'member', status: 'pending', name: 'Pend', email: 'pend@t.co',
    })
    // Lock 12 is already on the victim's Pump P-101.
    await setDoc(doc(db, 'lockClaims', `${VICTIM}__12`), {
      orgId: VICTIM, lockNo: '12', procedureId: 'proc-1', equipment: 'Pump P-101', holder: 'point',
    })
  })
})

const as = (uid) => testEnv.authenticatedContext(uid).firestore()
const anon = () => testEnv.unauthenticatedContext().firestore()
const claim = (db, org, no) => doc(db, 'lockClaims', `${org}__${no}`)
const body = (over = {}) => ({
  orgId: VICTIM, lockNo: '13', procedureId: 'proc-2', equipment: 'Press 4', holder: 'point', ...over,
})

describe('taking a padlock that is free', () => {
  it('lets a member of the org claim it', async () => {
    await assertSucceeds(setDoc(claim(as('mem'), VICTIM, '13'), body()))
  })

  it('lets a manager claim it', async () => {
    await assertSucceeds(setDoc(claim(as('vic'), VICTIM, '13'), body()))
  })

  it('refuses an auditor — read-only means the equipment too', async () => {
    await assertFails(setDoc(claim(as('aud'), VICTIM, '13'), body()))
  })

  it('refuses a member who has not been approved yet', async () => {
    await assertFails(setDoc(claim(as('pend'), VICTIM, '13'), body()))
  })

  it('refuses a stranger with no account', async () => {
    await assertFails(setDoc(claim(anon(), VICTIM, '13'), body()))
  })
})

describe('taking a padlock somebody else is already holding', () => {
  it('REFUSES a second procedure claiming lock 12', async () => {
    // The defect this collection exists for. Before it, both operators wrote
    // their own procedure document and neither transaction noticed the other.
    await assertFails(
      setDoc(claim(as('mem'), VICTIM, '12'), body({ lockNo: '12', procedureId: 'proc-9' })),
    )
  })

  it('refuses it for an admin too — seniority does not move a padlock', async () => {
    await assertFails(
      setDoc(claim(as('vic'), VICTIM, '12'), body({ lockNo: '12', procedureId: 'proc-9' })),
    )
  })

  it('refuses an update that repoints a live claim at another procedure', async () => {
    // The post-state branch, in the shape it would take here: authorise on what
    // the writer is asking to become and they supply the thing that authorises.
    await assertFails(
      updateDoc(claim(as('mem'), VICTIM, '12'), { procedureId: 'proc-9' }),
    )
  })

  it('ALLOWS the holder to re-assert its own claim', async () => {
    // A personal→department swap lands on the same number, and the holder has
    // not changed. Refusing this would break the swap for no gain.
    await assertSucceeds(
      updateDoc(claim(as('mem'), VICTIM, '12'), { holder: 'point', lockType: 'department' }),
    )
  })
})

describe('another tenant', () => {
  it('cannot read the victim’s claim', async () => {
    await assertFails(getDoc(claim(as('mal'), VICTIM, '12')))
  })

  it('cannot delete the victim’s claim', async () => {
    await assertFails(deleteDoc(claim(as('mal'), VICTIM, '12')))
  })

  it('cannot plant a claim at the victim’s address while naming its own org', async () => {
    // The squat. Without the id-prefix check this create succeeds, and lock 99
    // is permanently unusable in the victim's isolation system — they cannot
    // read the claim, so their own transaction fails, and they cannot delete it.
    await assertFails(
      setDoc(claim(as('mal'), VICTIM, '99'), body({ orgId: ATTACKER, lockNo: '99' })),
    )
  })

  it('cannot plant one by naming the victim’s org either', async () => {
    // The other half: the id is right, so the prefix check passes — and
    // isWriterOf(VICTIM) is what refuses, because the attacker is not in it.
    await assertFails(
      setDoc(claim(as('mal'), VICTIM, '99'), body({ lockNo: '99' })),
    )
  })

  it('can still claim the same lock NUMBER in its own organization', async () => {
    // Padlock 12 in one company has nothing to do with padlock 12 in another.
    // A uniqueness rule that crossed tenants would be a different bug.
    await assertSucceeds(
      setDoc(claim(as('mal'), ATTACKER, '12'), body({ orgId: ATTACKER, lockNo: '12' })),
    )
  })
})

describe('releasing a padlock', () => {
  it('lets any writer in the org release it', async () => {
    // A padlock outliving the person who applied it is routine — shift change,
    // someone off sick — and a claim nobody can clear strands the physical lock,
    // which is the failure that teaches people to work around the system.
    await assertSucceeds(deleteDoc(claim(as('mem'), VICTIM, '12')))
  })

  it('refuses an auditor', async () => {
    await assertFails(deleteDoc(claim(as('aud'), VICTIM, '12')))
  })

  it('refuses a stranger', async () => {
    await assertFails(deleteDoc(claim(anon(), VICTIM, '12')))
  })
})

describe('reading', () => {
  it('lets an approved member of the org see where a padlock is', async () => {
    await assertSucceeds(getDoc(claim(as('mem'), VICTIM, '12')))
  })

  it('lets an auditor read it — read-only is still read', async () => {
    await assertSucceeds(getDoc(claim(as('aud'), VICTIM, '12')))
  })

  it('refuses a stranger', async () => {
    await assertFails(getDoc(claim(anon(), VICTIM, '12')))
  })
})

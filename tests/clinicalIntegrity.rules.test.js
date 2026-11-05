// @vitest-environment node
// Clinical writes, the recycle-bin timestamp, and what an audit entry may say.
//
// A member reports an illness or an injury and cannot read it back. That write
// has to keep working. It must not also be a way to replace someone else's
// report, to queue it for the 30-day purge, or to publish the exposure in the
// audit log every approved member can read.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ID = 'ohsms-clinical'
const ORG = 'orgA'

let testEnv

const user = (uid, extra = {}) => ({
  orgId: ORG, role: 'member', status: 'approved', name: uid, email: `${uid}@t.co`, ...extra,
})

const illness = {
  docId: 'ILL-1',
  refNo: 'ILL-2026-0001',
  lifecycle: 'reporting',
  deletedAt: null,
  createdBy: 'member1',
  createdByName: 'member1',
  exposedToAgent: 'solvent',
  healthIssue: 'dermatitis',
  location: 'Bay 3',
  siteId: 'site-1',
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
    await setDoc(doc(db, 'users', 'member2'), user('member2'))
    await setDoc(doc(db, 'users', 'suspended1'), user('suspended1', { status: 'suspended' }))
    await setDoc(doc(db, 'organizations', 'orgB'), { name: 'orgB', createdBy: 'stranger' })
    await setDoc(doc(db, 'users', 'stranger'), user('stranger', { orgId: 'orgB', role: 'manager' }))
    await setDoc(doc(db, 'organizations', ORG, 'illnesses', 'ill-1'), illness)
    await setDoc(doc(db, 'organizations', ORG, 'incidents', 'i1'), {
      docId: 'INC-1', refNo: 'IRA-1', lifecycle: 'reporting', deletedAt: null, location: 'Bay 3',
    })
    await setDoc(doc(db, 'organizations', ORG, 'injuries', 'i1__p1'), {
      incidentId: 'i1', personId: 'p1', medication: 'analgesic', createdBy: 'member1',
      status: 'pending', deletedAt: null,
    })
  })
})

const as = (uid) => testEnv.authenticatedContext(uid).firestore()
const ill = (db, id = 'ill-1') => doc(db, 'organizations', ORG, 'illnesses', id)
const incident = (db, id = 'i1') => doc(db, 'organizations', ORG, 'incidents', id)
const injury = (db, id = 'i1__p1') => doc(db, 'organizations', ORG, 'injuries', id)

describe('occupational illness writes', () => {
  it('lets the author report one and keep editing it', async () => {
    const db = as('member1')
    await assertSucceeds(setDoc(ill(db, 'ill-new'), { ...illness, createdBy: 'member1', refNo: 'ILL-2' }))
    await assertSucceeds(updateDoc(ill(db), { healthIssue: 'updated by author' }))
  })

  it('refuses a colleague, an auditor, a suspended member, and another org', async () => {
    await assertFails(updateDoc(ill(as('member2')), { exposedToAgent: 'acid', healthIssue: 'burn' }))
    await assertFails(updateDoc(ill(as('auditor1')), { location: 'Bay 9' }))
    await assertFails(updateDoc(ill(as('suspended1')), { location: 'Bay 9' }))
    await assertFails(updateDoc(ill(as('stranger')), { exposedToAgent: 'acid' }))
    await assertFails(getDoc(ill(as('member1'))))
    await assertFails(getDoc(ill(as('auditor1'))))
  })

  it('lets a manager and an admin edit the clinical record', async () => {
    await assertSucceeds(updateDoc(ill(as('manager1')), { exposedToAgent: 'acid', healthIssue: 'reviewed' }))
    await assertSucceeds(updateDoc(ill(as('admin1')), { healthIssue: 'admin review' }))
    await assertSucceeds(getDoc(ill(as('manager1'))))
  })

  it('refuses a full replace that changes the exposure, and a closed record edited by its author', async () => {
    await assertFails(setDoc(ill(as('member2')), { ...illness, exposedToAgent: 'other' }))
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(ill(ctx.firestore()), { lifecycle: 'closed' })
    })
    await assertFails(updateDoc(ill(as('member1')), { healthIssue: 'after close' }))
    await assertSucceeds(updateDoc(ill(as('manager1')), { healthIssue: 'manager after close' }))
  })

  it('refuses every non-manager change of deletedAt, including a backdated stamp and an omission', async () => {
    await assertFails(updateDoc(ill(as('member1')), { deletedAt: serverTimestamp() }))
    await assertFails(updateDoc(ill(as('member1')), { deletedAt: new Date('2020-01-01') }))
    await assertFails(updateDoc(ill(as('auditor1')), { deletedAt: serverTimestamp() }))
    await assertFails(updateDoc(ill(as('suspended1')), { deletedAt: serverTimestamp() }))
    await assertSucceeds(updateDoc(ill(as('manager1')), { deletedAt: serverTimestamp(), deletedBy: 'manager1' }))
    const withoutStamp = { ...illness }
    delete withoutStamp.deletedAt
    await assertFails(setDoc(ill(as('member1')), withoutStamp))
    await assertFails(updateDoc(ill(as('manager1')), { deletedAt: new Date('2020-01-01') }))
    await assertSucceeds(updateDoc(ill(as('admin1')), { deletedAt: null, deletedBy: null }))
  })

  it('refuses a record born already deleted', async () => {
    await assertFails(setDoc(ill(as('member1'), 'ill-dead'), {
      ...illness, createdBy: 'member1', deletedAt: new Date('2020-01-01'),
    }))
    await assertFails(setDoc(ill(as('manager1'), 'ill-dead-2'), {
      ...illness, createdBy: 'manager1', deletedAt: new Date('2020-01-01'),
    }))
  })
})

describe('incident soft delete', () => {
  it('still lets a member correct the report', async () => {
    await assertSucceeds(updateDoc(incident(as('member1')), { location: 'Bay 4' }))
  })

  it('refuses a member, an auditor, and a suspended user the bin, including a past date', async () => {
    await assertFails(updateDoc(incident(as('member1')), { deletedAt: serverTimestamp() }))
    await assertFails(updateDoc(incident(as('member1')), { deletedAt: new Date('2020-01-01') }))
    await assertFails(updateDoc(incident(as('auditor1')), { deletedAt: serverTimestamp() }))
    await assertFails(updateDoc(incident(as('suspended1')), { deletedAt: null }))
    await assertSucceeds(updateDoc(incident(as('manager1')), { deletedAt: serverTimestamp() }))
    await assertFails(setDoc(incident(as('member2')), {
      docId: 'INC-1', refNo: 'IRA-1', lifecycle: 'reporting', location: 'Bay 3',
    }))
  })

  it('lets a manager stamp now and restore, and refuses a backdated stamp', async () => {
    await assertSucceeds(updateDoc(incident(as('manager1')), { deletedAt: serverTimestamp() }))
    await assertSucceeds(updateDoc(incident(as('admin1')), { deletedAt: null }))
    await assertFails(updateDoc(incident(as('manager1')), { deletedAt: new Date('2020-01-01') }))
  })
})

describe('injury clinical edits and medical-record uploads', () => {
  it('lets the author edit and refuses a colleague, a join-key move, and a verified report', async () => {
    await assertSucceeds(updateDoc(injury(as('member1')), { medication: 'reviewed dose' }))
    await assertFails(updateDoc(injury(as('member2')), { medication: 'replaced' }))
    await assertFails(updateDoc(injury(as('member1')), { personId: 'p-other' }))
    await assertFails(updateDoc(injury(as('manager1')), { personId: 'p-other', incidentId: 'i1' }))
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(injury(ctx.firestore()), { status: 'verified' })
    })
    await assertFails(updateDoc(injury(as('member1')), { medication: 'after verify' }))
    await assertSucceeds(updateDoc(injury(as('manager1')), { medication: 'manager after verify' }))
  })

  it('lets a member create the join-key stub a medical upload needs, and not the clinical fields', async () => {
    // addMedicalRecord writes this shape before the pointer, including when the
    // injury document does not exist yet. incidentId is the join key, not the
    // clinical content. Adding medication on that create is a parent report
    // and still has to name the author.
    const stub = doc(as('member1'), 'organizations', ORG, 'injuries', 'i9__p9')
    await assertSucceeds(setDoc(stub, {
      incidentId: 'i9', incidentRefNo: 'IRA-9', personId: 'p9', updatedAt: serverTimestamp(),
    }))
    await assertFails(setDoc(doc(as('member1'), 'organizations', ORG, 'injuries', 'i9__p8'), {
      incidentId: 'i9', personId: 'p8', medication: 'undisclosed',
    }))
    await assertSucceeds(setDoc(doc(as('member1'), 'organizations', ORG, 'injuries', 'i9__p7'), {
      incidentId: 'i9', personId: 'p7', medication: '', bodyParts: [], injuryType: '',
      createdBy: 'member1', deletedAt: null,
    }))
  })

  it('lets a member upload a medical record and not rewrite one', async () => {
    const rec = (db, id) => doc(db, 'organizations', ORG, 'injuries', 'i1__p1', 'records', id)
    await assertSucceeds(setDoc(rec(as('member1'), 'r1'), {
      name: 'gp-letter.pdf', caption: 'fit note', path: 'orgs/orgA/medical-records/r1',
    }))
    await assertFails(getDoc(rec(as('member1'), 'r1')))
    await assertSucceeds(getDoc(rec(as('manager1'), 'r1')))
    await assertFails(updateDoc(rec(as('member2'), 'r1'), { caption: 'rewritten' }))
    await assertFails(updateDoc(rec(as('member1'), 'r1'), { caption: 'rewritten by uploader' }))
  })

  it('refuses a cross-org manager and an inactive member', async () => {
    await assertFails(updateDoc(injury(as('stranger')), { medication: 'no' }))
    await assertFails(updateDoc(injury(as('suspended1')), { medication: 'no' }))
    await assertFails(updateDoc(injury(as('auditor1')), { medication: 'no' }))
  })
})

describe('audit entries do not carry the exposure', () => {
  const entry = (db, id, summary, extra = {}) => setDoc(
    doc(db, 'organizations', ORG, 'auditLogs', id),
    {
      action: 'illness.update',
      at: serverTimestamp(),
      actorUid: 'member1',
      actorName: 'member1',
      target: 'illness',
      targetId: 'ill-1',
      summary,
      ...extra,
    },
  )

  it('accepts a redacted mention and an ordinary summary', async () => {
    const db = as('member1')
    await assertSucceeds(entry(db, 'a1', 'exposedToAgent: changed'))
    await assertSucceeds(entry(db, 'a2', 'Illness ILL-2026-0001 created'))
    await assertSucceeds(entry(db, 'a3', 'location: Bay 3 → Bay 4; exposedToAgent: changed'))
  })

  it('refuses the value, under another actor name, and from someone else', async () => {
    await assertFails(entry(as('member1'), 'a4', 'exposedToAgent: solvent → acid'))
    await assertFails(entry(as('member1'), 'a5', 'exposedToAgent: solvent'))
    await assertFails(entry(as('member1'), 'a6', 'exposedToAgent: changed afterwards'))
    await assertFails(entry(as('member2'), 'a7', 'exposedToAgent: changed', { actorUid: 'member1' }))
  })
})

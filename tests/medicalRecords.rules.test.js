// ─────────────────────────────────────────────────────────────────────────────
// A medical record is manager-only — the pointer AND the file. Both surfaces.
//
// The injury/illness split confined the clinical FIELDS to /injuries and left
// the DOCUMENTS behind: uploads from Step 1a were filed into
// incidents/{id}/photos with kind:'medical_record', a subcollection the generic
// {sub=**} rule hands to every approved member and to the external auditor, by
// get and by list. A GP letter, a fit note, a discharge summary IS the record —
// confining the summary of it and publishing the scan achieves nothing. One
// getDocs over an incident's photos returned filename, caption and a download
// link for every medical document in the tenant.
//
// A `kind` field could not have closed it: rules cannot filter WHICH documents
// a list returns, so the collection itself had to differ. Pointers now live at
// organizations/{orgId}/injuries/{injuryId}/records/{recordId} and the bytes at
// orgs/{orgId}/medical-records/{file}.
//
// This file is in two halves because the fix is, and either half alone is a
// hole:
//   · Firestore — who may reach the pointer, by GET and by LIST separately. A
//     get-only suite passes against a rule that still leaks the whole
//     collection to a query, which is the failure mode this codebase has
//     already shipped once (see the direct-field-access comment in
//     firestore.rules).
//   · Storage — who may reach the bytes. A pointer nobody can read is worth
//     nothing while the file behind it is readable by any member of the org,
//     and until HIGH-1 the two surfaces disagreed about exactly that.
//
// Both rulesets are permissive unions, so every "refused" assertion here is
// really a claim about EXCLUSION — that no other match grants the same read
// back. Hence the last describe in each half: the accesses that must NOT have
// changed. A confinement that also broke scene photos would be a different
// outage, not a fix.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import {
  doc, getDoc, getDocs, collection, query, where, orderBy, limit, setDoc, deleteDoc,
} from 'firebase/firestore'
import { ref, uploadBytes, getBytes, deleteObject } from 'firebase/storage'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ID = 'ohsms-demo'
const ORG = 'orgA'
const OTHER = 'orgB'

let testEnv

const user = (uid, extra = {}) => ({
  orgId: ORG, role: 'member', status: 'approved', name: uid, email: `${uid}@t.co`, ...extra,
})

// The doc id is the join key injuries.js already computes: `${incidentId}__${personId}`.
// The PATH carries the person, which is the point — a personId field on the
// pointer was dropped silently for the whole life of the old shape.
const injuryDocId = (incidentId, personId) => `${incidentId}__${personId}`
const INJURY_1 = injuryDocId('i1', 'p-osei')
const INJURY_2 = injuryDocId('i2', 'p-lund')

// What a pointer holds now: a Storage path, and no `url`. getDownloadURL mints
// a permanent unauthenticated bearer link, so persisting one would make every
// rule below decorative for anyone who copied the string once.
const RECORD = {
  name: 'gp-letter.pdf',
  type: 'application/pdf',
  path: `orgs/${ORG}/medical-records/ab12cd34-gp-letter.pdf`,
  size: 48210,
  caption: 'GP letter, fit note attached',
  uploadedBy: 'member1',
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(join(__dirname, '..', 'firestore.rules'), 'utf8') },
    storage: { rules: readFileSync(join(__dirname, '..', 'storage.rules'), 'utf8') },
  })
})

afterAll(async () => { await testEnv?.cleanup() })

beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.clearStorage()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'organizations', ORG), { name: ORG, createdBy: 'admin1' })
    await setDoc(doc(db, 'users', 'admin1'), user('admin1', { role: 'admin' }))
    await setDoc(doc(db, 'users', 'manager1'), user('manager1', { role: 'manager' }))
    await setDoc(doc(db, 'users', 'auditor1'), user('auditor1', { role: 'auditor' }))
    await setDoc(doc(db, 'users', 'member1'), user('member1'))

    await setDoc(doc(db, 'organizations', OTHER), { name: OTHER, createdBy: 'stranger' })
    await setDoc(doc(db, 'users', 'stranger'), user('stranger', { orgId: OTHER, role: 'admin' }))

    await setDoc(doc(db, 'organizations', ORG, 'incidents', 'i1'), {
      docId: 'INC-0001', refNo: 'IRA-2026-0001', type: 'Injury', deletedAt: null,
    })
    // A scene photograph, which every member and the auditor are SUPPOSED to
    // read — the control against a fix that confines too much.
    await setDoc(doc(db, 'organizations', ORG, 'incidents', 'i1', 'photos', 'ph1'), {
      name: 'guard-rail.jpg', type: 'image/jpeg', kind: 'photo', caption: 'Bent guard rail',
    })

    await setDoc(doc(db, 'organizations', ORG, 'injuries', INJURY_1), {
      incidentId: 'i1', personId: 'p-osei', personName: 'R. Osei', injuryType: 'laceration',
    })
    await setDoc(doc(db, 'organizations', ORG, 'injuries', INJURY_2), {
      incidentId: 'i2', personId: 'p-lund', personName: 'A. Lund', injuryType: 'burn',
    })

    // Two records under one injury, and one under another. A list needs more
    // than one row to walk, and the second injury proves the refusal is not an
    // accident of a single path.
    await setDoc(doc(db, 'organizations', ORG, 'injuries', INJURY_1, 'records', 'r1'), RECORD)
    await setDoc(doc(db, 'organizations', ORG, 'injuries', INJURY_1, 'records', 'r2'), {
      ...RECORD, name: 'discharge-summary.pdf', caption: 'A&E discharge summary',
    })
    await setDoc(doc(db, 'organizations', ORG, 'injuries', INJURY_2, 'records', 'r3'), {
      ...RECORD, name: 'fit-note.pdf', uploadedBy: 'manager1',
    })
  })

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const st = ctx.storage()
    await uploadBytes(ref(st, MEDICAL(ORG)), bytes())
    await uploadBytes(ref(st, MEDICAL(OTHER)), bytes())
    await uploadBytes(ref(st, PHOTO(ORG)), bytes())
    // A prefix that merely LOOKS like the protected one. See the assertion.
    await uploadBytes(ref(st, `orgs/${ORG}/medical-records-legacy/old.pdf`), bytes())
  })
})

const as = (uid) => testEnv.authenticatedContext(uid).firestore()
const records = (db, injuryId = INJURY_1) =>
  collection(db, 'organizations', ORG, 'injuries', injuryId, 'records')
const record = (db, id = 'r1', injuryId = INJURY_1) =>
  doc(db, 'organizations', ORG, 'injuries', injuryId, 'records', id)

const bytes = (n = 8) => new Uint8Array(n)
const MEDICAL = (org, name = 'gp-letter.pdf') => `orgs/${org}/medical-records/${name}`
const PHOTO = (org, name = 'guard-rail.jpg') => `orgs/${org}/incident-photos/${name}`
// Storage reads the org and role off the ID TOKEN — Storage rules cannot query
// Firestore — so these mint what syncUserClaims stamps.
const stAs = (uid, role, org = ORG) =>
  testEnv.authenticatedContext(uid, { orgId: org, role }).storage()

// ─────────────────────────────────────────────────────────────────────────────
// Half one: the pointer.
// ─────────────────────────────────────────────────────────────────────────────
describe('the medical-record pointer is manager-only', () => {
  for (const uid of ['manager1', 'admin1']) {
    it(`lets ${uid} get one`, async () => {
      const snap = await assertSucceeds(getDoc(record(as(uid))))
      expect(snap.exists()).toBe(true)
      expect(snap.data().name).toBe('gp-letter.pdf')
    })

    it(`lets ${uid} list an injury's records`, async () => {
      const snap = await assertSucceeds(getDocs(records(as(uid))))
      expect(snap.size).toBe(2)
    })

    // The subscription the rebuilt Step 1a issues. A rule that permitted a bare
    // list but tripped on the ordered one leaves the panel empty, and an
    // onSnapshot error handler turns that into "no records" — which reads as
    // "nothing was ever uploaded", the most dangerous wrong answer here.
    it(`lets ${uid} run an ordered, limited query`, async () => {
      await assertSucceeds(
        getDocs(query(records(as(uid)), orderBy('name'), limit(500)))
      )
    })
  }

  // The two roles the gate exists to hold back. read = get + list, and the list
  // is the shape the finding was written about: one query, every medical
  // document attached to a person, in a single request.
  for (const [role, uid] of [['an ordinary member', 'member1'], ['the external auditor', 'auditor1']]) {
    it(`refuses ${role} by GET`, async () => {
      await assertFails(getDoc(record(as(uid))))
    })

    it(`refuses ${role} by LIST`, async () => {
      await assertFails(getDocs(records(as(uid))))
    })

    it(`refuses ${role} on a second person's injury too`, async () => {
      await assertFails(getDoc(record(as(uid), 'r3', INJURY_2)))
      await assertFails(getDocs(records(as(uid), INJURY_2)))
    })

    // No narrowing buys a way in. A refused collection stays refused however
    // the query is dressed.
    it(`refuses ${role} a narrowed or ordered query`, async () => {
      await assertFails(getDocs(query(records(as(uid)), where('uploadedBy', '==', 'member1'))))
      await assertFails(getDocs(query(records(as(uid)), orderBy('name'), limit(1))))
    })

    // Otherwise a refusal that only covers existing documents confirms which
    // ids are real — a weaker leak, but a leak, and it is free to close.
    it(`refuses ${role} an id that is not there, rather than confirming absence`, async () => {
      await assertFails(getDoc(record(as(uid), 'nope')))
      await assertFails(getDocs(records(as(uid), injuryDocId('i9', 'p-nobody'))))
    })
  }

  it('refuses another tenant admin and a signed-out caller', async () => {
    await assertFails(getDoc(record(as('stranger'))))
    await assertFails(getDocs(records(as('stranger'))))
    const out = testEnv.unauthenticatedContext().firestore()
    await assertFails(getDoc(record(out)))
    await assertFails(getDocs(records(out)))
  })

  // Reading an ABSENT field directly RAISES and a raising rule DENIES, which is
  // how a check meant to protect new documents locks every old one out. The
  // rule reads nothing off the pointer on purpose; this pins that, because the
  // tempting next change — "let people read records they uploaded" — is exactly
  // the one that would break here.
  it('reads a pointer written before any of these fields existed', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), 'organizations', ORG, 'injuries', INJURY_1, 'records', 'legacy'),
        { name: 'scan.pdf' }
      )
    })
    await assertSucceeds(getDoc(record(as('manager1'), 'legacy')))
    await assertSucceeds(getDocs(records(as('manager1'))))
    await assertFails(getDoc(record(as('member1'), 'legacy')))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The product still has to work. Step 1a is filled in by whoever is on shift,
// not by a manager, so the WRITE must stay open while the read is shut — the
// same asymmetry /injuries itself already has, and the reason the new panel
// must say "records are on file and not shown to you" rather than showing an
// empty gallery a member will read as a failed upload.
// ─────────────────────────────────────────────────────────────────────────────
describe('a member still files what they cannot read back', () => {
  it('creates a pointer, and is refused the read of it', async () => {
    const db = as('member1')
    const mine = record(db, 'mine')
    await assertSucceeds(setDoc(mine, { ...RECORD, name: 'x-ray.pdf' }))
    await assertFails(getDoc(mine))
  })

  // isWriterOf, inherited from the generic rule — the auditor is an outside
  // party and does not add to the evidence they are auditing.
  it('refuses the auditor the write as well as the read', async () => {
    await assertFails(setDoc(record(as('auditor1'), 'planted'), RECORD))
  })

  // Deleting is manager-only and mirrors canDeleteFrom in storage.rules, so a
  // record cannot be destroyed by the person who attached it.
  it('needs a manager to delete one', async () => {
    await assertFails(deleteDoc(record(as('member1'))))
    await assertSucceeds(deleteDoc(record(as('manager1'))))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// What must NOT have changed. Both rulesets are permissive unions, so the
// exclusion that makes the rule above worth anything is also the thing most
// likely to over-reach — 'injuries' is excluded from the generic read and from
// its recursive wildcard, and those exclusions are shared with every other
// collection in the file.
// ─────────────────────────────────────────────────────────────────────────────
describe('nothing else moved', () => {
  it('still lets a member and the auditor read the incident and its scene photos', async () => {
    for (const uid of ['member1', 'auditor1']) {
      const db = as(uid)
      await assertSucceeds(getDoc(doc(db, 'organizations', ORG, 'incidents', 'i1')))
      const photos = collection(db, 'organizations', ORG, 'incidents', 'i1', 'photos')
      await assertSucceeds(getDocs(photos))
      await assertSucceeds(getDoc(doc(photos, 'ph1')))
    }
  })

  it('still lets a member read an unrelated subcollection through the wildcard', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), 'organizations', ORG, 'permits', 'pt1', 'attachments', 'a1'),
        { name: 'method-statement.pdf' }
      )
    })
    const db = as('member1')
    const attachments = collection(db, 'organizations', ORG, 'permits', 'pt1', 'attachments')
    await assertSucceeds(getDocs(attachments))
    await assertSucceeds(getDoc(doc(attachments, 'a1')))
  })

  it('leaves the injury record itself exactly as it was', async () => {
    const injury = (db) => doc(db, 'organizations', ORG, 'injuries', INJURY_1)
    const all = (db) => collection(db, 'organizations', ORG, 'injuries')
    for (const uid of ['manager1', 'admin1']) {
      await assertSucceeds(getDoc(injury(as(uid))))
      await assertSucceeds(getDocs(all(as(uid))))
    }
    for (const uid of ['member1', 'auditor1']) {
      await assertFails(getDoc(injury(as(uid))))
      await assertFails(getDocs(all(as(uid))))
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Half two: the bytes.
// ─────────────────────────────────────────────────────────────────────────────
describe('the medical-record FILE is manager-only', () => {
  it('lets a manager and an admin read it', async () => {
    await assertSucceeds(getBytes(ref(stAs('mgr', 'manager'), MEDICAL(ORG))))
    await assertSucceeds(getBytes(ref(stAs('adm', 'admin'), MEDICAL(ORG))))
  })

  // The half that makes the Firestore rule worth having. Before the split of
  // prefixes these bytes sat under incident-photos, indistinguishable by path
  // from a photograph of a bent guard rail, so no rule could tell them apart.
  it('refuses an ordinary member and the auditor', async () => {
    await assertFails(getBytes(ref(stAs('mem', 'member'), MEDICAL(ORG))))
    await assertFails(getBytes(ref(stAs('aud', 'auditor'), MEDICAL(ORG))))
  })

  it('refuses another tenant admin, an unstamped token and the public', async () => {
    await assertFails(getBytes(ref(stAs('badm', 'admin', OTHER), MEDICAL(ORG))))
    await assertFails(getBytes(ref(testEnv.authenticatedContext('nostamp').storage(), MEDICAL(ORG))))
    await assertFails(getBytes(ref(testEnv.unauthenticatedContext().storage(), MEDICAL(ORG))))
  })

  // Role never substitutes for tenancy: a manager is a manager of THEIR org.
  it('refuses a manager of another org', async () => {
    await assertFails(getBytes(ref(stAs('bmgr', 'manager', OTHER), MEDICAL(ORG))))
    await assertSucceeds(getBytes(ref(stAs('bmgr', 'manager', OTHER), MEDICAL(OTHER))))
  })

  // The upload comes from Step 1a, filled in by whoever is on shift. Same
  // asymmetry as the pointer: write open, read shut.
  it('still lets a member upload one, and still refuses the auditor', async () => {
    await assertSucceeds(uploadBytes(ref(stAs('mem', 'member'), MEDICAL(ORG, 'new.pdf')), bytes()))
    await assertFails(uploadBytes(ref(stAs('aud', 'auditor'), MEDICAL(ORG, 'aud.pdf')), bytes()))
  })

  // Client deletes are closed everywhere now, including for the manager — they
  // go through the deleteOrgFile callable, which checks the LIVE profile rather
  // than an ID token that may be an hour out of date (SECURITY.md S-19). The
  // no-overwrite guard is unchanged and still the thing stopping evidence being
  // replaced in place.
  it('refuses every client delete on the new prefix, and still refuses overwrites', async () => {
    await assertFails(deleteObject(ref(stAs('mem', 'member'), MEDICAL(ORG))))
    await assertFails(uploadBytes(ref(stAs('mem', 'member'), MEDICAL(ORG)), bytes(16)))
    await assertFails(deleteObject(ref(stAs('mgr', 'manager'), MEDICAL(ORG))))
  })

  it('keeps the 20 MB cap on the new prefix', async () => {
    await assertFails(
      uploadBytes(ref(stAs('mem', 'member'), MEDICAL(ORG, 'huge.bin')), bytes(21 * 1024 * 1024))
    )
  })

  // The generic read is excluded by an exact segment comparison, which is what
  // makes it work at all — and also means it protects this prefix and no other.
  // Legacy objects already written under orgs/{org}/incident-photos/ are NOT
  // covered and cannot be: they are byte-identical in path to scene photos.
  // They have to be copied to the new prefix and the originals deleted, or
  // plain org-membership read still reaches them. Asserted rather than trusted.
  it('protects that exact prefix and nothing else, which is the migration debt', async () => {
    const mem = stAs('mem', 'member')
    await assertSucceeds(getBytes(ref(mem, PHOTO(ORG))))
    await assertSucceeds(getBytes(ref(mem, `orgs/${ORG}/medical-records-legacy/old.pdf`)))
  })
})

describe('no other storage prefix changed', () => {
  it('still lets a member and the auditor read ordinary evidence', async () => {
    for (const [uid, role] of [['mem', 'member'], ['aud', 'auditor']]) {
      await assertSucceeds(getBytes(ref(stAs(uid, role), PHOTO(ORG))))
    }
  })

  it('still refuses cross-tenant reads of ordinary evidence', async () => {
    await assertFails(getBytes(ref(stAs('mem', 'member'), PHOTO(OTHER))))
  })

  it('still lets a member upload evidence, and refuses every client delete', async () => {
    await assertSucceeds(uploadBytes(ref(stAs('mem', 'member'), PHOTO(ORG, 'new.jpg')), bytes()))
    await assertFails(deleteObject(ref(stAs('mem', 'member'), PHOTO(ORG))))
    await assertFails(deleteObject(ref(stAs('mgr', 'manager'), PHOTO(ORG))))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The clinical detail is confined to /injuries. Proved end to end.
//
// /injuries and /illnesses are gated with isManagerOf and NOT isElevatedOf,
// specifically so the external auditor cannot read what medication a named
// colleague is on. An ISO 27001 audit found that gate was decorative: the same
// fields were ALSO written onto the parent incident as injuryReports[], and an
// incident is readable by every approved member AND by the auditor through the
// generic /{col}/{docId} rule. One
// getDocs(collection(db, 'organizations', ORG, 'incidents')) returned bodyParts,
// injuryType, medication, firstAidDetail and daysToReturnToWork for every
// injured person in the tenant, in a single request, from any account.
//
// The fix moved the DATA, not the rule, because rules cannot restrict which
// FIELDS a read returns. So the assertions here are of two kinds and the file is
// worth nothing without both:
//   · rules — who reaches /injuries at all, by get AND by list;
//   · data  — what the app puts on an incident, read back through the emulator
//            by the two roles the gate exists to hold at arm's length.
//
// The second kind is why this file imports the app's own shaping helper instead
// of hand-writing a payload. A hand-written seed would only prove this test's
// opinion of the incident shape. incidentInjuryStubs() is the seam every write
// of injuryReports now passes through, so seeding with it means a clinical field
// reintroduced on that document turns this file red too, and MEDICAL_FIELDS
// being the app's list means a SEVENTH clinical field is covered the day it is
// added. The import loads shared/firebase, which builds a client and logs a line
// about emulator config; nothing here uses it — every read below goes through
// @firebase/rules-unit-testing.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, getDoc, getDocs, collection, query, where, orderBy, limit, setDoc } from 'firebase/firestore'
import {
  MEDICAL_FIELDS,
  INCIDENT_INJURY_FIELDS,
  incidentInjuryStubs,
} from '../src/modules/incidents/lib/injuries.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ID = 'ohsms-demo'
const ORG = 'orgA'

let testEnv

const user = (uid, extra = {}) => ({
  orgId: ORG, role: 'member', status: 'approved', name: uid, email: `${uid}@t.co`, ...extra,
})

// One person's Step 1a capture, in full. Everything below the join key is what
// the audit found on the incident document.
const CAPTURE = {
  personId: 'p-osei',
  personName: 'R. Osei',
  firstAidDone: true,
  bodyParts: ['left hand', 'left forearm'],
  injuryType: 'laceration',
  medication: 'co-codamol 30/500',
  firstAidDetail: 'Wound irrigated and dressed on site by the first aider',
  daysToReturnToWork: 3,
  recordFileIds: ['rec-1'],
}

// The injury document: the only copy there is.
const INJURY_DOC = {
  incidentId: 'i1',
  incidentRefNo: 'IRA-2026-0001',
  ...CAPTURE,
  incidentDate: '2026-01-04',
  incidentType: 'Injury',
  severity: 'Major',
  location: 'Bay 3',
  deletedAt: null,
  updatedAt: new Date('2026-01-04T09:05:00Z'),
}

const injuryDocId = (incidentId, personId) => `${incidentId}__${personId}`

// The incident, shaped by the app's own seam. Note the spread order: the full
// capture goes IN and the stub is what lands, which is the whole change.
const incidentDoc = (reports) => ({
  docId: 'INC-0001',
  refNo: 'IRA-2026-0001',
  lifecycle: 'reporting',
  incidentDate: '2026-01-04',
  type: 'Injury',
  severity: 'Major',
  location: 'Bay 3',
  narrative: 'Operator caught their hand on a burr while clearing a jam.',
  affectedPersonnel: [{ name: 'R. Osei', empId: 'E-114', department: 'Press shop' }],
  injuryReports: incidentInjuryStubs(reports),
  deletedAt: null,
})

/**
 * Every clinical field name found anywhere in a value, at any depth.
 *
 * Deep, rather than a look inside injuryReports[], because the defect was never
 * about one array — it was about anything clinical riding on a document with
 * this audience. The same fields reintroduced at the top level, or tucked into
 * affectedPersonnel[], leak exactly as far and would sail past a shallow check.
 *
 * Returns NAMES and never values, and the assertions below print only names. A
 * CI log is one more place this detail must not come to rest, which is the same
 * reason planMedicalStrip's report in functions/lib/incidentMedical.js carries
 * field names alone.
 */
function collectClinical(value, found) {
  if (Array.isArray(value)) {
    for (const v of value) collectClinical(v, found)
    return found
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (MEDICAL_FIELDS.includes(k)) found.add(k)
      collectClinical(v, found)
    }
  }
  return found
}
const clinicalFields = (value) => [...collectClinical(value, new Set())].sort()

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

    await setDoc(doc(db, 'organizations', ORG, 'incidents', 'i1'), incidentDoc([CAPTURE]))
    // A second injured person on a second incident, so a LIST has more than one
    // row to walk and the query is the org-wide one from the finding.
    await setDoc(doc(db, 'organizations', ORG, 'incidents', 'i2'), {
      ...incidentDoc([{ ...CAPTURE, personId: 'p-lund', personName: 'A. Lund', medication: 'ibuprofen' }]),
      docId: 'INC-0002',
      refNo: 'IRA-2026-0002',
    })

    await setDoc(doc(db, 'organizations', ORG, 'injuries', injuryDocId('i1', 'p-osei')), INJURY_DOC)
    await setDoc(doc(db, 'organizations', ORG, 'injuries', injuryDocId('i2', 'p-lund')), {
      ...INJURY_DOC, incidentId: 'i2', personId: 'p-lund', personName: 'A. Lund', medication: 'ibuprofen',
    })
  })
})

const as = (uid) => testEnv.authenticatedContext(uid).firestore()
const incidents = (db) => collection(db, 'organizations', ORG, 'incidents')
const incident = (db, id = 'i1') => doc(db, 'organizations', ORG, 'incidents', id)
const injuries = (db) => collection(db, 'organizations', ORG, 'injuries')
const injury = (db, id = injuryDocId('i1', 'p-osei')) => doc(db, 'organizations', ORG, 'injuries', id)

// ─────────────────────────────────────────────────────────────────────────────
// The two roles the manager-only gate exists to hold back. Neither is refused
// the incident — they are not supposed to be, an incident is the shared record
// of what happened — so the only thing standing between them and a colleague's
// medical record is that it is no longer written there.
//
// read = get + list, and the list is the shape the finding was written about:
// one unfiltered query over the collection, every injured person in the tenant.
// A rule can refuse a single document while a query walks the whole collection,
// so both are asserted for every role, everywhere in this file.
// ─────────────────────────────────────────────────────────────────────────────
for (const [role, uid] of [['a plain member', 'member1'], ['the external auditor', 'auditor1']]) {
  describe(`${role} reads incidents and gets no clinical detail`, () => {
    it('gets one incident and finds none on it', async () => {
      const snap = await assertSucceeds(getDoc(incident(as(uid))))
      expect(snap.exists()).toBe(true)
      expect(clinicalFields(snap.data())).toEqual([])
    })

    // The exact call from the audit finding.
    it('lists every incident in the tenant and finds none on any of them', async () => {
      const snap = await assertSucceeds(getDocs(incidents(as(uid))))
      expect(snap.size).toBe(2)
      const leaked = clinicalFields(snap.docs.map((d) => d.data()))
      expect(leaked).toEqual([])
    })

    // Narrowing does not help either: not a rules question here, but the query
    // somebody would reach for having noticed injuryReports[] exists at all.
    it('gets nothing more from a query narrowed to injured people', async () => {
      const snap = await assertSucceeds(
        getDocs(query(incidents(as(uid)), where('type', '==', 'Injury')))
      )
      expect(snap.empty).toBe(false)
      expect(clinicalFields(snap.docs.map((d) => d.data()))).toEqual([])
    })
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// The other half of the same sentence: a wizard save must still land, and what
// it lands must still be clean. Seeding with rules disabled proves the shape;
// this proves the write the app actually makes is accepted AND arrives narrowed.
// ─────────────────────────────────────────────────────────────────────────────
describe('a member filing an incident writes a stub, not a record', () => {
  it('is allowed the write, and the auditor reads back nothing clinical', async () => {
    const mine = doc(as('member1'), 'organizations', ORG, 'incidents', 'i3')
    await assertSucceeds(setDoc(mine, incidentDoc([CAPTURE])))
    const back = await assertSucceeds(getDoc(incident(as('auditor1'), 'i3')))
    expect(clinicalFields(back.data())).toEqual([])
  })

  // The allow-list, pinned. incidentInjuryStub() rebuilds by naming what may
  // stay rather than by removing what may not, so this is the assertion that
  // notices a seventh key being added to the stub — and a new key on this
  // document is a decision about audience, not a detail.
  it('keeps exactly the join key and nothing else', async () => {
    const snap = await getDoc(incident(as('member1')))
    const [stub] = snap.data().injuryReports
    expect(Object.keys(stub).sort()).toEqual([...INCIDENT_INJURY_FIELDS].sort())
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The gate itself. isManagerOf, not isElevatedOf — that helper includes
// 'auditor', and an outside reviewer confirming injuries are recorded and
// verified does not need to read what medication a named person is on.
// ─────────────────────────────────────────────────────────────────────────────
describe('/injuries stays manager-only', () => {
  for (const uid of ['manager1', 'admin1']) {
    it(`lets ${uid} read a record in full, by get`, async () => {
      const snap = await assertSucceeds(getDoc(injury(as(uid))))
      // "In full" checked field by field against MEDICAL_FIELDS rather than by
      // eyeballing two or three: narrowing the read must not have quietly cost
      // the people who are meant to have it any part of the record.
      for (const f of MEDICAL_FIELDS) {
        expect(snap.data()[f], `manager cannot see ${f}`).toEqual(CAPTURE[f])
      }
    })

    it(`lets ${uid} list the collection`, async () => {
      const snap = await assertSucceeds(getDocs(injuries(as(uid))))
      expect(snap.size).toBe(2)
    })

    // subscribeInjuries()'s exact query. A rule that permitted a bare list but
    // tripped on the ordered one would leave the Injuries page empty, and
    // onSnapshot's error handler turns that into cb([]) — an empty screen, not
    // an error anybody sees.
    it(`lets ${uid} run the query the Injuries page actually issues`, async () => {
      await assertSucceeds(
        getDocs(query(injuries(as(uid)), orderBy('updatedAt', 'desc'), limit(2000)))
      )
    })
  }

  for (const [role, uid] of [['an ordinary member', 'member1'], ['the auditor', 'auditor1']]) {
    it(`refuses ${role}, by get AND by list`, async () => {
      await assertFails(getDoc(injury(as(uid))))
      await assertFails(getDocs(injuries(as(uid))))
    })

    // No narrowing buys a way in. This one is not hypothetical: it is the query
    // syncIncidentInjuries() issues on every save, which is why that call sits
    // inside a try/catch and warns instead of failing.
    it(`refuses ${role} a query narrowed to one incident`, async () => {
      await assertFails(getDocs(query(injuries(as(uid)), where('incidentId', '==', 'i1'))))
    })

    it(`refuses ${role} an id that is not there, rather than confirming absence`, async () => {
      await assertFails(getDoc(injury(as(uid), 'i9__nobody')))
    })
  }

  it('refuses another tenant and a signed-out caller', async () => {
    await assertFails(getDocs(injuries(as('stranger'))))
    await assertFails(getDocs(injuries(testEnv.unauthenticatedContext().firestore())))
  })

  // Rules are a permissive union, and the generic match carries a {sub=**} that
  // also matches the parent document. If 'injuries' were excluded from the outer
  // read and not the inner one, every assertion above would still pass while the
  // subtree stayed open — so anything ever nested under an injury record would
  // be readable by exactly the people the collection is closed to.
  it('refuses the recursive wildcard under an injury record', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), 'organizations', ORG, 'injuries', injuryDocId('i1', 'p-osei'), 'notes', 'n1'),
        { medication: 'co-codamol 30/500', note: 'GP letter received' }
      )
    })
    for (const uid of ['member1', 'auditor1']) {
      const nested = collection(as(uid), 'organizations', ORG, 'injuries', injuryDocId('i1', 'p-osei'), 'notes')
      await assertFails(getDocs(nested))
      await assertFails(getDoc(doc(nested, 'n1')))
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The product still has to work. Reporting an injury is done by whoever is on
// shift, not by a manager, so the write must stay open even though the read is
// shut — and the join has to survive being split across two documents with two
// different audiences.
// ─────────────────────────────────────────────────────────────────────────────
describe('the split still joins', () => {
  it('lets a member FILE clinical detail they cannot read back', async () => {
    const db = as('member1')
    const id = injuryDocId('i4', 'p-new')
    await assertSucceeds(setDoc(doc(db, 'organizations', ORG, 'injuries', id), {
      incidentId: 'i4', personId: 'p-new', personName: 'T. Adeyemi',
      bodyParts: ['ankle'], injuryType: 'sprain', medication: '', firstAidDetail: 'Iced',
      daysToReturnToWork: 0, recordFileIds: [], deletedAt: null,
    }))
    await assertFails(getDoc(doc(db, 'organizations', ORG, 'injuries', id)))
  })

  // The key the incident keeps has to be enough, and has to be readable by the
  // people who work the incident. A member reads the join key; a manager follows
  // it. If personId were dropped from the stub as "one more identifier on a
  // widely-read document", this is the test that would say what it cost.
  it('a member reads the join key, and a manager follows it to the record', async () => {
    const seen = await assertSucceeds(getDoc(incident(as('member1'))))
    const [stub] = seen.data().injuryReports
    expect(stub.personId).toBe('p-osei')
    expect(stub.personName).toBe('R. Osei')
    expect(stub.firstAidDone).toBe(true)

    const followed = await assertSucceeds(
      getDoc(injury(as('manager1'), injuryDocId(seen.id, stub.personId)))
    )
    expect(followed.exists()).toBe(true)
    expect(followed.data().injuryType).toBe('laceration')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Documents written before the split.
//
// Reading an ABSENT field directly raises, and a rule that raises DENIES — which
// is how a check meant to protect newer documents locks every older one out.
// The /injuries rule reads nothing off the queried document on purpose; these
// pin that, because the tempting next change ("let people read their own") is
// exactly the one that would break here.
// ─────────────────────────────────────────────────────────────────────────────
describe('older documents still open', () => {
  it('an incident with no injuryReports key at all is still readable', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'organizations', ORG, 'incidents', 'old1'), {
        docId: 'INC-0000', refNo: 'IRA-2025-0099', narrative: 'Trip on a trailing lead',
      })
    })
    for (const uid of ['member1', 'auditor1']) {
      await assertSucceeds(getDoc(incident(as(uid), 'old1')))
      await assertSucceeds(getDocs(incidents(as(uid))))
    }
  })

  it('an injury record missing every field the app added later still reads', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'organizations', ORG, 'injuries', 'legacy'), {
        personName: 'Older Record',
      })
    })
    await assertSucceeds(getDoc(injury(as('manager1'), 'legacy')))
    await assertSucceeds(getDocs(injuries(as('manager1'))))
    await assertFails(getDoc(injury(as('auditor1'), 'legacy')))
  })

  // The uncomfortable one, and the reason it is here.
  //
  // Rules cannot restrict which fields a read returns, so nothing in
  // firestore.rules closed this — moving the data did, and only for documents
  // that have been moved. An incident still carrying the pre-split array hands
  // every clinical field to a plain member and to the auditor, today, exactly as
  // it always did. That is what stripIncidentMedicalDetail
  // (functions/index.js) is for, and this asserts it is still needed rather than
  // letting a green suite imply otherwise.
  //
  // The shape below is the employee portal's historical one — name/uid, no
  // personId — which is also the shape the migration REFUSES to strip, because
  // it cannot be joined to an injury record and the incident is the only copy
  // there is.
  it('an UNMIGRATED incident still hands everything over — the rules do not do this for us', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'organizations', ORG, 'incidents', 'unmigrated'), {
        docId: 'INC-0000', refNo: 'IRA-2025-0100', type: 'Injury',
        injuryReports: [{
          name: 'R. Osei', uid: 'p-osei',
          bodyParts: ['left hand'], injuryType: 'laceration', medication: 'co-codamol 30/500',
          firstAidDetail: 'Dressed on site', daysToReturnToWork: 3,
        }],
      })
    })
    for (const uid of ['member1', 'auditor1']) {
      const snap = await assertSucceeds(getDoc(incident(as(uid), 'unmigrated')))
      expect(clinicalFields(snap.data())).toEqual([
        'bodyParts', 'daysToReturnToWork', 'firstAidDetail', 'injuryType', 'medication',
      ])
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Where the confinement stops, stated rather than left to be discovered.
//
// Attachments filed as kind:'medical_record' live at incidents/{id}/photos and
// are reached by the generic rule's {sub=**}, so every approved member and the
// auditor can list them. Moving files is a rules change and a storage change,
// not this one. What must hold meanwhile is that the photo METADATA carries no
// clinical field of its own — a caption or a filename is not what this file is
// about, but a bodyParts key appearing here would reopen the finding in a new
// place, one collection along.
// ─────────────────────────────────────────────────────────────────────────────
describe('the medical-record attachment metadata carries no clinical field', () => {
  it('holds a kind and a caption, and nothing from MEDICAL_FIELDS', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'organizations', ORG, 'incidents', 'i1', 'photos', 'ph1'), {
        name: 'gp-letter.pdf', type: 'application/pdf', kind: 'medical_record',
        caption: 'GP letter', url: 'https://example.test/x', uploadedBy: 'member1',
      })
    })
    for (const uid of ['member1', 'auditor1']) {
      const snap = await assertSucceeds(getDoc(doc(as(uid), 'organizations', ORG, 'incidents', 'i1', 'photos', 'ph1')))
      expect(clinicalFields(snap.data())).toEqual([])
    }
  })
})

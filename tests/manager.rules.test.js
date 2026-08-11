// ─────────────────────────────────────────────────────────────────────────────
// SECURITY.md S-02 — manager-only actions, enforced in the rules.
//
// Approving a permit, deciding a defect report, verifying an injury, closing a
// finding: all of these were gated by can() in React and by nothing else, so
// the same write went straight through from the SDK. These tests send what a
// member with a browser console would send, not what the app sends.
//
// Two halves, and the second is the one that keeps this maintainable: every
// privileged transition is refused for a member AND allowed for a manager, and
// every ordinary write a member does today is proved still to work — including
// submitting something for approval, which is not a decision.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc, getDoc, addDoc, collection } from 'firebase/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ORG = 'orgOne'
let testEnv

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'ohsms-demo',
    firestore: { rules: readFileSync(join(__dirname, '..', 'firestore.rules'), 'utf8') },
  })
})
afterAll(async () => { await testEnv?.cleanup() })

const as = (uid) => testEnv.authenticatedContext(uid).firestore()
const anon = () => testEnv.unauthenticatedContext().firestore()
const rec = (uid, col, id) => doc(as(uid), 'organizations', ORG, col, id)

const pending = () => ({ status: 'pending', by: null, byName: '', at: null, note: '' })
const decided = (d) => ({ status: d, by: 'someone', byName: 'Someone', at: '2026-01-01', note: '' })

beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'organizations', ORG), { name: 'One', createdBy: 'adm' })
    for (const [uid, role] of [['adm', 'admin'], ['mgr', 'manager'], ['mem', 'member'], ['aud', 'auditor']]) {
      await setDoc(doc(db, 'users', uid), { orgId: ORG, role, status: 'approved', name: uid, email: `${uid}@t.co` })
    }
    const org = (col, id, data) => setDoc(doc(db, 'organizations', ORG, col, id), data)

    // A permit awaiting its two team approvals, and one already approved.
    await org('permits', 'p-draft', {
      permitNo: 'PTW-1', typeOfWork: 'Hot work',
      engineering: pending(), operations: pending(), closure: null, extension: null,
      storedStatus: 'draft', createdBy: 'mem',
    })
    await org('permits', 'p-live', {
      permitNo: 'PTW-2', typeOfWork: 'Height',
      engineering: decided('approved'), operations: decided('approved'),
      closure: null, extension: null, storedStatus: 'in_progress', createdBy: 'mem',
    })
    // …and one whose raiser has already asked for closure and for an extension.
    await org('permits', 'p-asked', {
      permitNo: 'PTW-3',
      engineering: decided('approved'), operations: decided('approved'),
      closure: { requestedBy: 'mem', engineering: pending(), operations: pending() },
      extension: { requestedBy: 'mem', newValidTo: '2026-02-02', engineering: pending(), operations: pending() },
      storedStatus: 'in_progress', createdBy: 'mem',
    })

    await org('reports', 'r-1', { extId: 'EXT-1', kind: 'defect', defectType: 'empty', approvalStatus: 'pending', source: 'qr' })
    await org('observations', 'o-1', { permitId: 'p-live', type: 'unsafe', approvalStatus: 'pending', source: 'qr' })
    await org('auditFindings', 'af-1', { docId: 'AF-1', status: 'Reported', findings: [] })
    await org('findings', 'f-1', { title: 'Guard missing', status: 'open' })
    await org('capas', 'c-1', { title: 'Fit guard', status: 'in_progress' })
    await org('injuries', 'inj-1', { personName: 'Sam', status: 'pending' })
    await org('incidents', 'i-1', { refNo: 'INC-1', lifecycle: 'capa' })
    await org('illnesses', 'ill-1', { refNo: 'ILL-1', lifecycle: 'investigation' })
    await org('erpRescuePlans', 'erp-1', { title: 'Fire', scenario: 'Fire', status: 'draft' })
    await org('trainingRequests', 'tr-1', { courseName: 'Working at height', employeeUid: 'mem', status: 'pending' })
    await org('documents', 'd-1', { title: 'SOP 12', status: 'draft', visibility: 'all', siteId: '', siteRegion: '', siteEntity: '' })
    await org('sites', 's-1', { name: 'Depot North', region: 'North', entity: '1P' })
    // Not a decision anywhere: the ordinary end of the fire refill workflow.
    await org('extinguishers', 'e-1', { extId: 'EXT-1', status: 'in_process_refilling' })

    // LOTO tenants by field on a top-level collection, not by path.
    await setDoc(doc(db, 'procedures', 'proc-1'), {
      orgId: ORG, title: 'Line 2 isolation', status: 'pending_approval',
    })
    // The public mirror a QR scan resolves.
    await setDoc(doc(db, 'qr', 'tok-1'), { orgId: ORG, extId: 'EXT-1', kind: 'extinguisher', status: 'active' })
  })
})

// ── The decisions themselves ──────────────────────────────────────────────────

describe('a member cannot approve a permit', () => {
  it('refuses recording a team decision on the permit', async () => {
    await assertFails(updateDoc(rec('mem', 'permits', 'p-draft'), { engineering: decided('approved') }))
    await assertFails(updateDoc(rec('mem', 'permits', 'p-draft'), { operations: decided('approved') }))
  })

  // Rejecting is a decision too — it sends the permit back to the raiser.
  it('refuses rejecting one', async () => {
    await assertFails(updateDoc(rec('mem', 'permits', 'p-draft'), { engineering: decided('rejected') }))
  })

  // The post state alone cannot authorise: the writer supplies it. So the way
  // OUT is closed as well, or a member could quietly wipe an approval and the
  // permit would read as if it had never been granted one.
  it('refuses clearing an approval already made', async () => {
    await assertFails(updateDoc(rec('mem', 'permits', 'p-live'), { engineering: pending() }))
  })

  it('refuses creating a permit that is already approved', async () => {
    await assertFails(setDoc(rec('mem', 'permits', 'p-new'), {
      permitNo: 'PTW-9', engineering: decided('approved'), operations: decided('approved'),
    }))
  })

  it('refuses deciding a closure request', async () => {
    await assertFails(updateDoc(rec('mem', 'permits', 'p-asked'), { 'closure.engineering.status': 'approved' }))
  })

  it('refuses deciding an extension request', async () => {
    await assertFails(updateDoc(rec('mem', 'permits', 'p-asked'), { 'extension.operations.status': 'approved' }))
  })

  it('lets a manager and an admin decide all three', async () => {
    await assertSucceeds(updateDoc(rec('mgr', 'permits', 'p-draft'), { engineering: decided('approved') }))
    await assertSucceeds(updateDoc(rec('mgr', 'permits', 'p-asked'), { 'closure.engineering.status': 'approved' }))
    await assertSucceeds(updateDoc(rec('adm', 'permits', 'p-asked'), { 'extension.operations.status': 'approved' }))
  })
})

describe('a member cannot decide a defect report', () => {
  it('refuses approving or rejecting one', async () => {
    await assertFails(updateDoc(rec('mem', 'reports', 'r-1'), { approvalStatus: 'approved', reviewedBy: 'Mem' }))
    await assertFails(updateDoc(rec('mem', 'reports', 'r-1'), { approvalStatus: 'rejected' }))
  })

  // The queue is the control. A report filed already-approved never sits in it.
  it('refuses filing one that is already approved', async () => {
    await assertFails(setDoc(rec('mem', 'reports', 'r-2'), {
      extId: 'EXT-1', kind: 'defect', defectType: 'empty', approvalStatus: 'approved', source: 'portal',
    }))
  })

  it('refuses deciding a permit observation', async () => {
    await assertFails(updateDoc(rec('mem', 'observations', 'o-1'), { approvalStatus: 'approved' }))
  })

  it('lets a manager decide', async () => {
    await assertSucceeds(updateDoc(rec('mgr', 'reports', 'r-1'), { approvalStatus: 'approved', reviewedBy: 'Mgr' }))
    await assertSucceeds(updateDoc(rec('mgr', 'observations', 'o-1'), { approvalStatus: 'rejected' }))
  })
})

describe('a member cannot close, verify or approve a record', () => {
  const refusals = [
    ['auditFindings', 'af-1', { status: 'Closed', closureDate: '2026-03-01' }],
    ['findings', 'f-1', { status: 'closed' }],
    ['capas', 'c-1', { status: 'verified' }],
    ['injuries', 'inj-1', { status: 'verified', verifiedByName: 'Mem' }],
    ['incidents', 'i-1', { lifecycle: 'closed', closedBy: 'Mem' }],
    ['illnesses', 'ill-1', { lifecycle: 'closed' }],
    ['erpRescuePlans', 'erp-1', { status: 'approved', approvedByName: 'Mem' }],
    ['trainingRequests', 'tr-1', { status: 'approved' }],
    ['documents', 'd-1', { status: 'active' }],
  ]

  for (const [col, id, patch] of refusals) {
    it(`refuses ${col} → ${JSON.stringify(patch)}`, async () => {
      await assertFails(updateDoc(rec('mem', col, id), patch))
    })
  }

  for (const [col, id, patch] of refusals) {
    it(`lets a manager do ${col} → ${JSON.stringify(patch)}`, async () => {
      await assertSucceeds(updateDoc(rec('mgr', col, id), patch))
    })
  }

  it('refuses re-opening a closed record too', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'organizations', ORG, 'incidents', 'i-2'), { refNo: 'INC-2', lifecycle: 'closed' })
    })
    await assertFails(updateDoc(rec('mem', 'incidents', 'i-2'), { lifecycle: 'capa' }))
    await assertSucceeds(updateDoc(rec('mgr', 'incidents', 'i-2'), { lifecycle: 'capa' }))
  })
})

// LOTO tenants by field on a top-level collection, so it is covered by a
// different match entirely — and a rule that only covered the org subcollections
// would have left the isolation procedures open.
describe('a member cannot approve a LOTO procedure', () => {
  it('refuses approving or rejecting it', async () => {
    await assertFails(updateDoc(doc(as('mem'), 'procedures', 'proc-1'), { status: 'approved', approvedByName: 'Mem' }))
    await assertFails(updateDoc(doc(as('mem'), 'procedures', 'proc-1'), { status: 'rejected' }))
  })

  it('lets a manager approve it', async () => {
    await assertSucceeds(updateDoc(doc(as('mgr'), 'procedures', 'proc-1'), { status: 'approved', approvedByName: 'Mgr' }))
  })
})

// The registry every module's site scoping resolves through, and the snapshot
// that decides who can read a site-level document. can() has had this at
// manager since the roles were unified.
describe('a member cannot manage the site registry', () => {
  it('refuses adding, renaming or re-regioning a site', async () => {
    await assertFails(setDoc(rec('mem', 'sites', 's-2'), { name: 'Depot South', region: 'South', entity: '1P' }))
    await assertFails(updateDoc(rec('mem', 'sites', 's-1'), { name: 'Renamed' }))
    await assertFails(updateDoc(rec('mem', 'sites', 's-1'), { region: 'South' }))
  })

  it('lets a manager manage it', async () => {
    await assertSucceeds(setDoc(rec('mgr', 'sites', 's-2'), { name: 'Depot South', region: 'South', entity: '1P' }))
    await assertSucceeds(updateDoc(rec('mgr', 'sites', 's-1'), { name: 'Renamed' }))
  })
})

// ── What must still work ──────────────────────────────────────────────────────

describe('a member still runs the day job', () => {
  it('creates ordinary records across the modules', async () => {
    const mk = (col, data) => addDoc(collection(as('mem'), 'organizations', ORG, col), data)
    await assertSucceeds(mk('incidents', { refNo: 'INC-3', lifecycle: 'reporting' }))
    await assertSucceeds(mk('assessments', { title: 'Welding bay', status: 'DRAFT' }))
    await assertSucceeds(mk('permits', { permitNo: 'PTW-4', engineering: pending(), operations: pending() }))
    await assertSucceeds(mk('extinguishers', { extId: 'EXT-2', status: 'active' }))
    await assertSucceeds(mk('mockDrills', { title: 'Evac', status: 'planned' }))
    await assertSucceeds(mk('inspectionRecords', { title: 'Monthly', status: 'Draft' }))
    await assertSucceeds(mk('documents', { title: 'SOP 13', status: 'draft', visibility: 'all', siteId: '', siteRegion: '', siteEntity: '' }))
  })

  it('edits them', async () => {
    await assertSucceeds(updateDoc(rec('mem', 'incidents', 'i-1'), { refNo: 'INC-1a' }))
    await assertSucceeds(updateDoc(rec('mem', 'documents', 'd-1'), { title: 'SOP 12 rev B' }))
    await assertSucceeds(updateDoc(rec('mem', 'auditFindings', 'af-1'), { findings: [{ id: 'x' }] }))
  })

  // Asking is not deciding. If this broke, the approval queues would empty and
  // the fix would read as working right up until nobody could request anything.
  it('submits things for approval', async () => {
    await assertSucceeds(updateDoc(doc(as('mem'), 'procedures', 'proc-1'), { status: 'pending_approval' }))
    await assertSucceeds(updateDoc(rec('mem', 'auditFindings', 'af-1'), { status: 'Submitted for Verification' }))
    await assertSucceeds(addDoc(collection(as('mem'), 'organizations', ORG, 'trainingRequests'), {
      courseName: 'Confined space', employeeUid: 'mem', status: 'pending',
    }))
    // The raiser asks for closure and for more time on an approved permit —
    // both write pending decision blocks onto a record that is already decided.
    await assertSucceeds(updateDoc(rec('mem', 'permits', 'p-live'), {
      closure: { requestedBy: 'mem', requestedByName: 'Mem', engineering: pending(), operations: pending() },
    }))
    await assertSucceeds(updateDoc(rec('mem', 'permits', 'p-live'), {
      extension: { requestedBy: 'mem', newValidTo: '2026-03-03', engineering: pending(), operations: pending() },
    }))
  })

  it('edits a decided record without touching the decision', async () => {
    await assertSucceeds(updateDoc(rec('mem', 'permits', 'p-live'), { typeOfWork: 'Height — revised' }))
    // storedStatus is derived and re-persisted by whoever opens the list. If it
    // were the gated field, browsing would deny.
    await assertSucceeds(updateDoc(rec('mem', 'permits', 'p-live'), { storedStatus: 'not_closed' }))
  })

  // The worst case the gate has to evaluate: a permit carrying all three
  // decision blocks, so every one of the six nested paths is walked, on both
  // matches. Rules are budgeted at 1000 expressions per request and an
  // exhausted budget reads as a denial, so headroom is a correctness property
  // here, not a performance one.
  it('edits a permit carrying every decision block', async () => {
    await assertSucceeds(updateDoc(rec('mem', 'permits', 'p-asked'), {
      typeOfWork: 'Hot work', location: 'Bay 4', participants: [{ name: 'A' }, { name: 'B' }],
      hazards: ['sparks'], storedStatus: 'in_progress',
    }))
    // …and one where the blocks are absent rather than filled, which is how the
    // permit form writes them.
    await assertSucceeds(updateDoc(rec('mem', 'permits', 'p-draft'), { location: 'Bay 5' }))
  })

  // Stopping unsafe work is not approving it. A rule that sent a member to find
  // a manager first would be a safety defect, not a control.
  it('closes a permit for an unsafe observation', async () => {
    await assertSucceeds(updateDoc(rec('mem', 'permits', 'p-live'), {
      closedDueToObservation: { observationId: 'o-1', by: 'mem', byName: 'Mem' },
      storedStatus: 'closed_noncompliance',
    }))
  })

  // 'closed' means refilled here — the ordinary end of the fire workflow,
  // recorded by whoever did the work. Naming a state privileged everywhere it
  // appears would have broken this.
  it('closes off an extinguisher refill', async () => {
    await assertSucceeds(updateDoc(rec('mem', 'extinguishers', 'e-1'), { status: 'closed' }))
  })

  it('writes subcollections under a gated record', async () => {
    await assertSucceeds(addDoc(collection(as('mem'), 'organizations', ORG, 'permits', 'p-live', 'documents'), {
      label: 'Method statement', fileName: 'ms.pdf',
    }))
    await assertSucceeds(addDoc(collection(as('mem'), 'organizations', ORG, 'incidents', 'i-1', 'photos'), {
      url: 'https://example.test/a.jpg',
    }))
  })
})

describe('a manager and an admin can still do everything', () => {
  it('creates, edits and decides', async () => {
    for (const uid of ['mgr', 'adm']) {
      await assertSucceeds(addDoc(collection(as(uid), 'organizations', ORG, 'incidents'), { refNo: `INC-${uid}` }))
      await assertSucceeds(updateDoc(rec(uid, 'documents', 'd-1'), { status: 'active' }))
      await assertSucceeds(updateDoc(rec(uid, 'injuries', 'inj-1'), { status: 'verified' }))
    }
  })
})

// isWriterOf covered the org subcollections. It did not cover the top-level
// collections LOTO tenants by field — where the adapter maps auditor onto
// `technician`, a role that carries loto.perform, so the buttons were there too.
describe('an auditor cannot write at all', () => {
  it('refuses an auditor writing an org record', async () => {
    await assertFails(updateDoc(rec('aud', 'incidents', 'i-1'), { refNo: 'edited' }))
    await assertFails(addDoc(collection(as('aud'), 'organizations', ORG, 'incidents'), { refNo: 'invented' }))
  })

  it('refuses an auditor writing a LOTO procedure or lock', async () => {
    await assertFails(updateDoc(doc(as('aud'), 'procedures', 'proc-1'), { title: 'edited' }))
    await assertFails(setDoc(doc(as('aud'), 'locks', 'lock-1'), { orgId: ORG, procedureId: 'proc-1' }))
  })

  // The mirror is what a stranger with a phone is shown. Rewriting it says a
  // faulty unit is ready for use, to the next person who scans it.
  it('refuses an auditor rewriting a public QR mirror', async () => {
    await assertFails(updateDoc(doc(as('aud'), 'qr', 'tok-1'), { status: 'active' }))
    await assertFails(setDoc(doc(as('aud'), 'permitQr', 'tok-2'), { orgId: ORG, permitId: 'p-live' }))
  })

  // Pre-creating a lock is how the defect-reporting DoS worked, and burning a
  // sequence number spends a reference that gets quoted to a regulator.
  it('refuses an auditor the id counters, and the defect locks as a signed-in writer', async () => {
    // No counter has a public branch: reserving an id is something only a
    // writer does, because only a writer creates the record it belongs to.
    await assertFails(setDoc(rec('aud', 'docSeq', 'incidents'), { n: 5 }))

    // A defect lock without a valid scanned token is a signed-in write, and an
    // auditor is not a writer.
    await assertFails(setDoc(rec('aud', 'defectLocks', 'EXT-2__empty'), {
      extId: 'EXT-2', defectType: 'empty', createdAt: '2026-01-01', token: 'no-such-token',
    }))
  })

  // The counterpart, and it is deliberate rather than a gap. /defectLocks has a
  // second branch for the person standing in front of the extinguisher with a
  // phone and no account at all. An auditor holding the same scanned token is
  // at least as entitled as that stranger, so proof of scan admits them too —
  // refusing an auditor something any passer-by can do would be incoherent, and
  // it is the token that authorises here, not the role.
  it('still lets an auditor report a defect they have physically scanned', async () => {
    await assertSucceeds(setDoc(rec('aud', 'defectLocks', 'EXT-1__empty'), {
      extId: 'EXT-1', defectType: 'empty', createdAt: '2026-01-01', token: 'tok-1',
    }))
  })

  it('still lets an auditor read what they are there to inspect', async () => {
    await assertSucceeds(getDoc(rec('aud', 'permits', 'p-live')))
    await assertSucceeds(getDoc(doc(as('aud'), 'procedures', 'proc-1')))
    await assertSucceeds(getDoc(rec('aud', 'defectLocks', 'EXT-1__empty')))
  })

  // …and none of that may cost the people who do the work.
  it('still lets a member do all of it', async () => {
    await assertSucceeds(updateDoc(doc(as('mem'), 'qr', 'tok-1'), { status: 'to_be_refilled' }))
    await assertSucceeds(setDoc(rec('mem', 'defectLocks', 'EXT-1__empty'), {
      extId: 'EXT-1', defectType: 'empty', createdAt: '2026-01-01', token: 'tok-1',
    }))
    await assertSucceeds(setDoc(rec('mem', 'docSeq', 'incidents'), { n: 5 }))
  })
})

// The person standing in front of the extinguisher has no account and never
// will. Nothing above may reach them.
describe('the public QR surfaces are untouched', () => {
  it('still accepts a pending defect report from a scan', async () => {
    await assertSucceeds(addDoc(collection(anon(), 'organizations', ORG, 'reports'), {
      extId: 'EXT-1', kind: 'defect', defectType: 'empty', source: 'qr', token: 'tok-1',
      approvalStatus: 'pending', reportedBy: 'public', reportedByName: 'QR Scan (Public)', note: '',
    }))
  })

  it('still refuses an anonymous report that files itself approved', async () => {
    await assertFails(addDoc(collection(anon(), 'organizations', ORG, 'reports'), {
      extId: 'EXT-1', kind: 'defect', defectType: 'empty', source: 'qr', token: 'tok-1',
      approvalStatus: 'approved', reportedBy: 'public', reportedByName: 'QR Scan (Public)', note: '',
    }))
  })

  it('still lets anyone read the mirror behind a printed label', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'qr', 'tok-1')))
  })
})

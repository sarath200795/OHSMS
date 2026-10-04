// ─────────────────────────────────────────────────────────────────────────────
// LOTO permits — organizations/{orgId}/lotoPermits.
//
// What these try to do is defeat the rules, not use them: file a permit under
// another plant's scope, take a number that is not the counter's, approve your
// own request, start work with a point unscanned, close a permit while its
// locks are still on, edit one that has already closed, and stamp or clear the
// procedure's `activePermit` marker by hand so the two documents disagree.
//
// The permit and its procedure are different documents in different places, so
// the start/return cases write both in one batch — that is the only shape the
// rules accept, and the tests for the half-writes are the point.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import {
  doc, setDoc, updateDoc, getDoc, deleteDoc, getDocs, collection, writeBatch,
  serverTimestamp, Timestamp,
} from 'firebase/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
let testEnv

const ORG = 'orgA'
const OTHER = 'orgB'
const YEAR = new Date().getUTCFullYear()
const NO = (n) => `LP-${YEAR}-${String(n).padStart(4, '0')}`
const H = 3600 * 1000
const ts = (offsetMs) => Timestamp.fromMillis(Date.now() + offsetMs)

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'ohsms-demo',
    firestore: { rules: readFileSync(join(__dirname, '..', 'firestore.rules'), 'utf8') },
  })
})
afterAll(async () => { await testEnv?.cleanup() })

const PROC = 'proc-1'
const point = (key, locked = false) => ({ key, energySource: 'electrical', lockState: { locked } })
const procBody = (over = {}) => ({
  orgId: ORG, status: 'approved', revision: 1, equipment: 'Pump A', site: 'Site 1',
  siteId: 's1', region: 'South', entity: 'Ent', procedureCode: 'ORG-S1-PUMP',
  isolationPoints: [point('k1'), point('k2')],
  lockSummary: { total: 2, lockedCount: 0, status: 'unlocked' },
  ...over,
})

beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    for (const org of [ORG, OTHER]) await setDoc(doc(db, 'organizations', org), { name: org })
    const users = {
      adm: { orgId: ORG, role: 'admin' },
      adm2: { orgId: ORG, role: 'admin' },
      mgr: { orgId: ORG, role: 'manager' },
      req: { orgId: ORG, role: 'member' },
      crew: { orgId: ORG, role: 'member' },
      by: { orgId: ORG, role: 'member' },
      aud: { orgId: ORG, role: 'auditor' },
      pend: { orgId: ORG, role: 'member', status: 'pending' },
      foe: { orgId: OTHER, role: 'admin' },
    }
    for (const [uid, u] of Object.entries(users)) {
      await setDoc(doc(db, 'users', uid), { status: 'approved', name: uid, email: `${uid}@t.co`, ...u })
    }
    await setDoc(doc(db, 'procedures', PROC), procBody())
  })
})

const as = (uid) => testEnv.authenticatedContext(uid).firestore()
const permitRef = (db, id = NO(1)) => doc(db, 'organizations', ORG, 'lotoPermits', id)
const seqRef = (db) => doc(db, 'organizations', ORG, 'docSeq', `lotoPermit-${YEAR}`)
const procRef = (db) => doc(db, 'procedures', PROC)
const eventsCol = (db, id = NO(1)) => collection(db, 'organizations', ORG, 'lotoPermits', id, 'events')

const newBody = (over = {}) => ({
  orgId: ORG, permitNo: NO(1), permitSeq: 1, status: 'requested', workType: 'machine_maintenance',
  reason: 'Replace the drive-end bearing on pump A', workOrder: 'WO-1', shift: 'A',
  windowStart: ts(-1 * H), windowEnd: ts(7 * H),
  requestedBy: 'req', requestedByName: 'req', requestedAt: serverTimestamp(),
  internalPersonnel: [{ uid: 'crew', name: 'crew' }], personnelUids: ['crew'], vendorWorkers: [],
  procedureId: PROC, procedureCode: 'ORG-S1-PUMP', procedureRevision: 1, equipment: 'Pump A',
  site: 'Site 1', siteId: 's1', region: 'South', entity: 'Ent',
  isolationPoints: [{ key: 'k1' }, { key: 'k2' }], pointKeys: ['k1', 'k2'], pointCount: 2, devices: [],
  locks: [{ pointKey: 'k1', lockNo: 'D-1' }, { pointKey: 'k2', lockNo: 'D-2' }],
  updatedAt: serverTimestamp(),
  ...over,
})

// Raise a permit the way the service does: counter and permit in one commit.
async function raise(db, over = {}, n = over.permitSeq ?? 1) {
  const b = writeBatch(db)
  b.set(seqRef(db), { n })
  b.set(permitRef(db, over.permitNo ?? NO(n)), newBody({ permitSeq: n, permitNo: NO(n), ...over }))
  return b.commit()
}

// An existing permit in a given state, bypassing the rules.
async function seed(status, over = {}) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    const stamp = Timestamp.fromMillis(Date.now())
    await setDoc(seqRef(db), { n: 1 })
    await setDoc(permitRef(db), {
      ...newBody({ requestedAt: stamp, updatedAt: stamp }), status, ...over,
    })
  })
}


describe('raising a permit', () => {
  it('lets a member raise one, with the counter in the same commit', async () => {
    await assertSucceeds(raise(as('req')))
  })

  it('lets an admin raise one too', async () => {
    await assertSucceeds(raise(as('adm'), { requestedBy: 'adm' }))
  })

  it('refuses an auditor, a pending member and a stranger', async () => {
    await assertFails(raise(as('aud'), { requestedBy: 'aud' }))
    await assertFails(raise(as('pend'), { requestedBy: 'pend' }))
    await assertFails(raise(testEnv.unauthenticatedContext().firestore()))
  })

  it("refuses another tenant's admin writing into this org's path", async () => {
    await assertFails(raise(as('foe'), { requestedBy: 'foe' }))
  })

  it('refuses a permit filed in someone else’s name', async () => {
    await assertFails(raise(as('req'), { requestedBy: 'adm' }))
  })

  it('refuses a permit that is born approved or active', async () => {
    await assertFails(raise(as('req'), { status: 'approved' }))
    await assertFails(raise(as('req'), { status: 'active' }))
  })

  it('refuses pre-seeded decision, isolation or server fields', async () => {
    await assertFails(raise(as('req'), { approval: { by: 'adm' } }))
    await assertFails(raise(as('req'), { isolation: { by: 'req' } }))
    await assertFails(raise(as('req'), { flags: { overdue: false } }))
    await assertFails(raise(as('req'), { closure: { by: 'req' } }))
  })

  it('refuses a number that is not the counter’s value', async () => {
    const db = as('req')
    const b = writeBatch(db)
    b.set(seqRef(db), { n: 5 })
    b.set(permitRef(db, NO(1)), newBody()) // counter says 5, permit says 1
    await assertFails(b.commit())
  })

  it('refuses a number without moving the counter in the same commit', async () => {
    await assertFails(setDoc(permitRef(as('req')), newBody()))
  })

  it('refuses a document id that is not the permit number', async () => {
    const db = as('req')
    const b = writeBatch(db)
    b.set(seqRef(db), { n: 1 })
    b.set(permitRef(db, 'whatever'), newBody())
    await assertFails(b.commit())
  })

  it('refuses a malformed or wrong-year number', async () => {
    const db = as('req')
    const b = writeBatch(db)
    b.set(seqRef(db), { n: 1 })
    b.set(permitRef(db, `LP-${YEAR - 1}-0001`), newBody({ permitNo: `LP-${YEAR - 1}-0001` }))
    await assertFails(b.commit())
  })

  it('refuses reusing a number: the counter cannot go backwards', async () => {
    await seed('requested')
    await assertFails(raise(as('req'), { permitSeq: 1 }, 1))
  })

  it('refuses a procedure that is not approved', async () => {
    for (const status of ['draft', 'pending_approval', 'rejected']) {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(procRef(ctx.firestore()), procBody({ status }))
      })
      await assertFails(raise(as('req')))
    }
  })

  it("refuses another org's procedure", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(procRef(ctx.firestore()), procBody({ orgId: OTHER }))
    })
    await assertFails(raise(as('req')))
  })

  it('refuses a procedure revised since it was copied', async () => {
    await assertFails(raise(as('req'), { procedureRevision: 0 }))
  })

  it('refuses a scope that does not come from the procedure', async () => {
    await assertFails(raise(as('req'), { siteId: 's9' }))
    await assertFails(raise(as('req'), { region: 'North' }))
    await assertFails(raise(as('req'), { entity: 'Other' }))
    await assertFails(raise(as('req'), { equipment: 'Press 4' }))
  })

  it('refuses maintenance or electrical work with no isolation points', async () => {
    for (const workType of ['machine_maintenance', 'electrical_work']) {
      await assertFails(raise(as('req'), {
        workType, procedureId: '', pointKeys: [], pointCount: 0, locks: [], isolationPoints: [],
      }))
    }
  })

  it('allows other work without a procedure', async () => {
    await assertSucceeds(raise(as('req'), {
      workType: 'other', procedureId: '', pointKeys: [], pointCount: 0, locks: [], isolationPoints: [],
    }))
  })

  it('refuses a point count that disagrees with the procedure', async () => {
    await assertFails(raise(as('req'), {
      pointKeys: ['k1'], pointCount: 1, locks: [{ pointKey: 'k1', lockNo: 'D-1' }], isolationPoints: [{ key: 'k1' }],
    }))
  })

  it('refuses a window that is longer than a day, ended, or back to front', async () => {
    await assertFails(raise(as('req'), { windowStart: ts(0), windowEnd: ts(25 * H) }))
    await assertFails(raise(as('req'), { windowStart: ts(-5 * H), windowEnd: ts(-1 * H) }))
    await assertFails(raise(as('req'), { windowStart: ts(5 * H), windowEnd: ts(1 * H) }))
  })

  it('refuses a permit that names nobody doing the work', async () => {
    await assertFails(raise(as('req'), { internalPersonnel: [], personnelUids: [], vendorWorkers: [] }))
  })

  it('accepts contractors recorded only as text', async () => {
    await assertSucceeds(raise(as('req'), {
      internalPersonnel: [], personnelUids: [], vendorWorkers: [{ name: 'V', company: 'ACME' }],
    }))
  })

  it('refuses an unbounded crew', async () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ name: `v${i}`, company: 'c' }))
    await assertFails(raise(as('req'), { vendorWorkers: many }))
  })

  it('refuses a backdated request time', async () => {
    await assertFails(raise(as('req'), { requestedAt: ts(-5 * H) }))
  })
})

describe('reading', () => {
  it('lets members of the org read, refuses other tenants and the unauthenticated', async () => {
    await seed('requested')
    await assertSucceeds(getDoc(permitRef(as('crew'))))
    await assertSucceeds(getDoc(permitRef(as('aud'))))
    await assertFails(getDoc(permitRef(as('foe'))))
    await assertFails(getDoc(permitRef(testEnv.unauthenticatedContext().firestore())))
  })

  it('lets a member list the org’s permits', async () => {
    await seed('requested')
    const snap = await assertSucceeds(getDocs(collection(as('crew'), 'organizations', ORG, 'lotoPermits')))
    if (snap.size !== 1) throw new Error(`expected 1 permit, saw ${snap.size}`)
  })

  it('refuses a read once an operator has switched the LOTO module off', async () => {
    await seed('requested')
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'moduleEntitlements', ORG), { modules: { loto: false } })
    })
    await assertFails(getDoc(permitRef(as('crew'))))
  })
})

describe('approval — Admin only, and not your own', () => {
  const approve = (db, by, extra = {}, status = 'approved') =>
    updateDoc(permitRef(db), {
      status, approval: { by, at: serverTimestamp(), ...extra }, updatedAt: serverTimestamp(),
      ...(status === 'rejected' ? { closedAt: serverTimestamp() } : {}),
    })

  beforeEach(() => seed('requested'))

  it('lets an admin other than the requester approve', async () => {
    await assertSucceeds(approve(as('adm'), 'adm'))
  })

  it('lets an admin reject', async () => {
    await assertSucceeds(approve(as('adm'), 'adm', { rejected: true }, 'rejected'))
  })

  it('refuses a member, a manager and an auditor', async () => {
    await assertFails(approve(as('crew'), 'crew'))
    await assertFails(approve(as('mgr'), 'mgr'))
    await assertFails(approve(as('aud'), 'aud'))
  })

  it('refuses the requester approving their own request', async () => {
    await assertFails(approve(as('req'), 'req'))
  })

  it('refuses an admin who raised it approving it without a stated reason', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(permitRef(ctx.firestore()), { requestedBy: 'adm' })
    })
    await assertFails(approve(as('adm'), 'adm'))
    await assertFails(approve(as('adm'), 'adm', { selfApproved: true }))
    await assertFails(approve(as('adm'), 'adm', { selfApproved: true, selfApprovalReason: '' }))
  })

  it('accepts a self-approval that says why nobody else could (the unavoidable case)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(permitRef(ctx.firestore()), { requestedBy: 'adm' })
    })
    await assertSucceeds(approve(as('adm'), 'adm', { selfApproved: true, selfApprovalReason: 'Only admin on site' }))
  })

  it('refuses an approval recorded under another admin’s name', async () => {
    await assertFails(approve(as('adm'), 'adm2'))
  })

  it('refuses an approval stamped with a client time', async () => {
    await assertFails(updateDoc(permitRef(as('adm')), {
      status: 'approved', approval: { by: 'adm', at: ts(-3 * H) }, updatedAt: serverTimestamp(),
    }))
  })

  it('refuses approving something that was never waiting', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(permitRef(ctx.firestore()), { status: 'approved' })
    })
    await assertFails(approve(as('adm'), 'adm'))
  })

  it('refuses a decision that also edits the permit', async () => {
    await assertFails(updateDoc(permitRef(as('adm')), {
      status: 'approved', approval: { by: 'adm', at: serverTimestamp() }, updatedAt: serverTimestamp(),
      windowEnd: ts(20 * H), pointKeys: ['k1'],
    }))
  })

  it('refuses skipping straight to active', async () => {
    await assertFails(updateDoc(permitRef(as('adm')), { status: 'active', updatedAt: serverTimestamp() }))
  })

  it('refuses a plain edit of any field by the requester', async () => {
    await assertFails(updateDoc(permitRef(as('req')), { reason: 'something else', updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(permitRef(as('req')), { windowEnd: ts(20 * H), updatedAt: serverTimestamp() }))
  })
})

describe('withdrawing', () => {
  const withdraw = (db, uid) => updateDoc(permitRef(db), {
    status: 'withdrawn', closure: { by: uid, reason: 'plans changed' }, closedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  it('lets the requester withdraw before it starts', async () => {
    await seed('requested')
    await assertSucceeds(withdraw(as('req'), 'req'))
  })

  it('lets an admin withdraw an approved permit', async () => {
    await seed('approved')
    await assertSucceeds(withdraw(as('adm'), 'adm'))
  })

  it('refuses a bystander, and withdrawing a permit that is already active', async () => {
    await seed('requested')
    await assertFails(withdraw(as('by'), 'by'))
    await seed('active')
    await assertFails(withdraw(as('req'), 'req'))
  })
})

describe('starting work — every point scanned, locked in the same commit', () => {
  const lockedPoints = [point('k1', true), point('k2', true)]
  const scans = (keys = ['k1', 'k2']) =>
    Object.fromEntries(keys.map((k) => [k, { at: serverTimestamp(), method: 'qr', by: 'req' }]))

  function start(db, { keys, uid = 'req', procPatch, skipProc = false, activeId = NO(1) } = {}) {
    const b = writeBatch(db)
    b.update(permitRef(db), {
      status: 'active', startedAt: serverTimestamp(), updatedAt: serverTimestamp(),
      isolation: { by: uid, at: serverTimestamp(), scans: scans(keys) },
    })
    if (!skipProc) {
      b.update(procRef(db), {
        activePermit: { id: activeId, permitNo: activeId },
        isolationPoints: lockedPoints,
        lockSummary: { total: 2, lockedCount: 2, status: 'locked' },
        ...procPatch,
      })
    }
    return b.commit()
  }

  beforeEach(() => seed('approved'))

  it('lets the requester start it, with the procedure stamped and every point locked', async () => {
    await assertSucceeds(start(as('req')))
  })

  it('lets a named crew member and an admin start it', async () => {
    await assertSucceeds(start(as('crew'), { uid: 'crew' }))
  })

  it('refuses a bystander', async () => {
    await assertFails(start(as('by'), { uid: 'by' }))
  })

  it('refuses a start with a point unscanned', async () => {
    await assertFails(start(as('req'), { keys: ['k1'] }))
  })

  it('refuses a start that does not touch the procedure at all', async () => {
    await assertFails(start(as('req'), { skipProc: true }))
  })

  it('refuses a start where the procedure is stamped for a different permit', async () => {
    await assertFails(start(as('req'), { activeId: NO(9) }))
  })

  it('refuses a start where not every point ended up locked', async () => {
    await assertFails(start(as('req'), {
      procPatch: { lockSummary: { total: 2, lockedCount: 1, status: 'partial' } },
    }))
  })

  it('refuses a start on a procedure another permit already holds', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(procRef(ctx.firestore()), { activePermit: { id: NO(7) } })
    })
    await assertFails(start(as('req')))
  })

  it('refuses a start after the window has closed', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(permitRef(ctx.firestore()), { windowEnd: ts(-1 * H) })
    })
    await assertFails(start(as('req')))
  })

  it('refuses the permit going active on its own', async () => {
    await assertFails(updateDoc(permitRef(as('req')), {
      status: 'active', startedAt: serverTimestamp(), updatedAt: serverTimestamp(),
      isolation: { by: 'req', at: serverTimestamp(), scans: scans() },
    }))
  })

  it('refuses stamping the procedure without the permit becoming active', async () => {
    await assertFails(updateDoc(procRef(as('req')), { activePermit: { id: NO(1) } }))
  })
})

describe('an active permit — extend, return, emergency removal', () => {
  const held = {
    activePermit: { id: NO(1), permitNo: NO(1) },
    isolationPoints: [point('k1', true), point('k2', true)],
    lockSummary: { total: 2, lockedCount: 2, status: 'locked' },
  }
  beforeEach(async () => {
    await seed('active', {
      isolation: { by: 'req', at: Timestamp.fromMillis(Date.now()), scans: { k1: { by: 'req' }, k2: { by: 'req' } } },
    })
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(procRef(ctx.firestore()), held)
    })
  })

  const released = {
    activePermit: null,
    isolationPoints: [point('k1'), point('k2')],
    lockSummary: { total: 2, lockedCount: 0, status: 'unlocked' },
  }
  const checks = { toolsRemoved: true, guardsReplaced: true, personnelClear: true, affectedNotified: true }
  const returns = { k1: { by: 'req', lockNo: 'D-1' }, k2: { by: 'req', lockNo: 'D-2' } }

  function doReturn(db, { uid = 'req', returnChecks = checks, ret = returns, procPatch = released, skipProc = false } = {}) {
    const b = writeBatch(db)
    b.update(permitRef(db), {
      status: 'returned', closedAt: serverTimestamp(), updatedAt: serverTimestamp(),
      closure: { by: uid }, returnChecks, returns: ret,
    })
    if (!skipProc) b.update(procRef(db), procPatch)
    return b.commit()
  }

  function emergency(db, { uid = 'adm', attest, procPatch = released, skipProc = false } = {}) {
    const b = writeBatch(db)
    b.update(permitRef(db), {
      status: 'emergency_removed', closedAt: serverTimestamp(), updatedAt: serverTimestamp(),
      emergency: {
        by: uid, reason: 'Lock owner is off site and the line must be cleared',
        attest: attest ?? { ownerUnavailable: true, equipmentInspected: true, ownerWillBeTold: true },
      },
    })
    if (!skipProc) b.update(procRef(db), procPatch)
    return b.commit()
  }

  describe('a procedure a permit holds', () => {
    it('cannot be revised or re-decided while the permit holds it', async () => {
      await assertFails(updateDoc(procRef(as('mgr')), { revision: 2 }))
      await assertFails(updateDoc(procRef(as('mgr')), { status: 'draft' }))
    })
    it('still takes edits that leave the revision and status alone', async () => {
      await assertSucceeds(updateDoc(procRef(as('mgr')), { notes: 'checked' }))
    })
    it('cannot be deleted while the permit holds it', async () => {
      await assertFails(deleteDoc(procRef(as('mgr'))))
      await assertFails(deleteDoc(procRef(as('adm'))))
    })
    it('can be deleted once the marker is gone', async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await updateDoc(procRef(ctx.firestore()), { activePermit: null })
      })
      await assertSucceeds(deleteDoc(procRef(as('mgr'))))
    })
  })

  describe('extend', () => {
    const extend = (db, uid, endOffset, extra = {}) => updateDoc(permitRef(db), {
      windowEnd: ts(endOffset), updatedAt: serverTimestamp(),
      extensions: [{ by: uid, reason: 'Bearing seized, more time needed', at: new Date().toISOString() }],
      ...extra,
    })

    it('lets an admin push the end later', async () => {
      await assertSucceeds(extend(as('adm'), 'adm', 10 * H))
    })
    it('refuses the requester, a manager and a crew member', async () => {
      await assertFails(extend(as('req'), 'req', 10 * H))
      await assertFails(extend(as('mgr'), 'mgr', 10 * H))
      await assertFails(extend(as('crew'), 'crew', 10 * H))
    })
    it('refuses an extension that shortens the window or jumps more than a day', async () => {
      await assertFails(extend(as('adm'), 'adm', 3 * H))
      await assertFails(extend(as('adm'), 'adm', 40 * H))
    })
    it('refuses an extension that edits anything else', async () => {
      await assertFails(extend(as('adm'), 'adm', 10 * H, { reason: 'rewritten job' }))
      await assertFails(extend(as('adm'), 'adm', 10 * H, { flags: { overdue: false } }))
    })
    it('refuses one that adds no record, or several', async () => {
      await assertFails(updateDoc(permitRef(as('adm')), { windowEnd: ts(10 * H), updatedAt: serverTimestamp() }))
      await assertFails(updateDoc(permitRef(as('adm')), {
        windowEnd: ts(10 * H), updatedAt: serverTimestamp(), extensions: [{ by: 'adm' }, { by: 'adm' }],
      }))
    })
  })

  describe('return', () => {
    it('lets the requester return it when every lock is confirmed and the procedure is released', async () => {
      await assertSucceeds(doReturn(as('req')))
    })
    it('lets a named crew member and an admin return it', async () => {
      await assertSucceeds(doReturn(as('crew'), { uid: 'crew' }))
    })
    it('refuses a bystander', async () => {
      await assertFails(doReturn(as('by'), { uid: 'by' }))
    })
    it('refuses a return with any pre-energise check missing', async () => {
      await assertFails(doReturn(as('req'), { returnChecks: { ...checks, personnelClear: false } }))
      await assertFails(doReturn(as('req'), { returnChecks: { toolsRemoved: true } }))
    })
    it('refuses a return that confirms only some locks', async () => {
      await assertFails(doReturn(as('req'), { ret: { k1: returns.k1 } }))
    })
    it('refuses closing the permit while the procedure still holds the locks', async () => {
      await assertFails(doReturn(as('req'), { skipProc: true }))
      await assertFails(doReturn(as('req'), { procPatch: { ...released, lockSummary: { total: 2, lockedCount: 1 } } }))
    })
    it('refuses clearing the procedure while the permit stays active', async () => {
      await assertFails(updateDoc(procRef(as('req')), released))
    })
    it('refuses the procedure being unlocked (count falling) while the marker stays', async () => {
      await assertFails(updateDoc(procRef(as('req')), {
        lockSummary: { total: 2, lockedCount: 1, status: 'partial' },
      }))
    })
    it('still lets an edit that keeps the locks, the marker, the revision and the status through', async () => {
      await assertSucceeds(updateDoc(procRef(as('mgr')), { title: 'reworded title' }))
    })
  })

  describe('emergency removal — Admin only, with a reason and attestation', () => {
    it('lets an admin do it', async () => {
      await assertSucceeds(emergency(as('adm')))
    })
    it('refuses a manager, the requester and a crew member', async () => {
      await assertFails(emergency(as('mgr'), { uid: 'mgr' }))
      await assertFails(emergency(as('req'), { uid: 'req' }))
      await assertFails(emergency(as('crew'), { uid: 'crew' }))
    })
    it('refuses it without every attestation', async () => {
      await assertFails(emergency(as('adm'), { attest: { ownerUnavailable: true, equipmentInspected: true } }))
      await assertFails(emergency(as('adm'), {
        attest: { ownerUnavailable: true, equipmentInspected: false, ownerWillBeTold: true },
      }))
    })
    it('refuses it in another admin’s name', async () => {
      await assertFails(emergency(as('adm'), { uid: 'adm2' }))
    })
    it('refuses closing the permit without releasing the procedure', async () => {
      await assertFails(emergency(as('adm'), { skipProc: true }))
    })
    it('is not available on a permit that is not active', async () => {
      await seed('approved')
      await assertFails(emergency(as('adm'), { skipProc: true }))
    })
  })

  describe('flags belong to the server', () => {
    it('refuses a client writing them, even an admin', async () => {
      await assertFails(updateDoc(permitRef(as('adm')), { flags: { state: 'ok' }, updatedAt: serverTimestamp() }))
    })
  })
})

describe('a closed permit is immutable', () => {
  for (const status of ['returned', 'rejected', 'withdrawn', 'emergency_removed']) {
    it(`refuses every write to a ${status} permit, admin included`, async () => {
      await seed(status)
      await assertFails(updateDoc(permitRef(as('adm')), { reason: 'rewrite history', updatedAt: serverTimestamp() }))
      await assertFails(updateDoc(permitRef(as('adm')), { status: 'active', updatedAt: serverTimestamp() }))
      await assertFails(updateDoc(permitRef(as('adm')), {
        windowEnd: ts(10 * H), updatedAt: serverTimestamp(), extensions: [{ by: 'adm' }],
      }))
      await assertFails(deleteDoc(permitRef(as('adm'))))
    })
  }

  it('refuses deleting an open permit from a client', async () => {
    await seed('requested')
    await assertFails(deleteDoc(permitRef(as('adm'))))
    await assertFails(deleteDoc(permitRef(as('req'))))
  })
})

describe('the timeline (events) is append-only', () => {
  const ev = (over = {}) => ({ type: 'approved', by: 'adm', at: serverTimestamp(), ...over })

  it('lets a writer append an event stamped by the server', async () => {
    await seed('requested')
    await assertSucceeds(setDoc(doc(eventsCol(as('adm'))), ev()))
  })

  it('refuses an event attributed to someone else, backdated, or of an unknown type', async () => {
    await seed('requested')
    await assertFails(setDoc(doc(eventsCol(as('adm'))), ev({ by: 'adm2' })))
    await assertFails(setDoc(doc(eventsCol(as('adm'))), ev({ at: ts(-5 * H) })))
    await assertFails(setDoc(doc(eventsCol(as('adm'))), ev({ type: 'made-up' })))
  })

  it('refuses an auditor and another tenant', async () => {
    await seed('requested')
    await assertFails(setDoc(doc(eventsCol(as('aud'))), ev({ by: 'aud' })))
    await assertFails(setDoc(doc(eventsCol(as('foe'))), ev({ by: 'foe' })))
  })

  it('refuses an event on a closed permit', async () => {
    await seed('returned')
    await assertFails(setDoc(doc(eventsCol(as('adm'))), ev()))
  })

  it('refuses editing or deleting an event', async () => {
    await seed('requested')
    const id = 'e1'
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(eventsCol(ctx.firestore()), id), { type: 'requested', by: 'req', at: Timestamp.fromMillis(Date.now()) })
    })
    await assertFails(updateDoc(doc(eventsCol(as('adm')), id), { type: 'approved' }))
    await assertFails(deleteDoc(doc(eventsCol(as('adm')), id)))
  })

  it('lets members read the timeline', async () => {
    await seed('requested')
    await assertSucceeds(getDocs(eventsCol(as('crew'))))
    await assertFails(getDocs(eventsCol(as('foe'))))
  })
})

describe('the generic collection rule does not reopen anything', () => {
  it('refuses an unlisted subcollection under a permit', async () => {
    await seed('requested')
    await assertFails(setDoc(doc(as('adm'), 'organizations', ORG, 'lotoPermits', NO(1), 'notes', 'n1'), { x: 1 }))
  })

  it('refuses the generic path to write a permit that never went through the counter', async () => {
    await assertFails(setDoc(permitRef(as('adm'), NO(3)), { status: 'active', orgId: ORG }))
  })
})

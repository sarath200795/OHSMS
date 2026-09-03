// ─────────────────────────────────────────────────────────────────────────────
// The write-boundary fixes from the security audit, pinned.
//
// Every one of these was a rule that read the POST state, or a privilege the
// app gated only in React. They share a shape: the existing tests all sent
// well-behaved payloads, so the hole sat under a green suite. These send the
// payload an attacker would.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc, getDoc, deleteDoc, collection, addDoc, writeBatch } from 'firebase/firestore'

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
    // A plain member and an auditor in the victim org.
    await setDoc(doc(db, 'users', 'mem'), {
      orgId: VICTIM, role: 'member', status: 'approved', name: 'Mem', email: 'mem@t.co',
      siteId: 'site-1', access: { sites: ['site-1'], regions: [], entities: [] },
    })
    await setDoc(doc(db, 'users', 'aud'), {
      orgId: VICTIM, role: 'auditor', status: 'approved', name: 'Aud', email: 'aud@t.co',
    })
    // The victim's public QR mirrors.
    await setDoc(doc(db, 'qr', 'tok-ext'), {
      orgId: VICTIM, orgName: 'Victim Ltd', extId: 'EXT-1', kind: 'extinguisher', status: 'Active',
    })
    await setDoc(doc(db, 'permitQr', 'tok-permit'), {
      orgId: VICTIM, permitId: 'p1', storedStatus: 'closed',
    })
    // A LOTO procedure, tenanted by field rather than by path.
    await setDoc(doc(db, 'procedures', 'proc-1'), { orgId: VICTIM, title: 'Line 2 isolation' })
  })
})

const as = (uid) => testEnv.authenticatedContext(uid).firestore()

// The token is printed on the sticker — it is not a secret, only unguessable.
// So "attacker holds the token" is the realistic case, not a stretch.
describe('public QR mirrors cannot be captured by another tenant', () => {
  it('refuses re-pointing an extinguisher mirror into the attacker\'s org', async () => {
    await assertFails(updateDoc(doc(as('mal'), 'qr', 'tok-ext'), { orgId: ATTACKER }))
  })

  it('refuses re-pointing a permit mirror', async () => {
    await assertFails(updateDoc(doc(as('mal'), 'permitQr', 'tok-permit'), { orgId: ATTACKER }))
  })

  // Not just the orgId: with the old rule, one capture write made every later
  // write legitimate, so the mirror the next scanner reads could be rewritten.
  it('refuses a stranger rewriting what the next scanner will see', async () => {
    await assertFails(updateDoc(doc(as('mal'), 'qr', 'tok-ext'), { status: 'Active', physicalDefects: [] }))
  })

  it('refuses a stranger deleting the mirror behind a printed label', async () => {
    await assertFails(deleteDoc(doc(as('mal'), 'qr', 'tok-ext')))
  })

  // The owner must still be able to maintain its own mirrors, or the fix has
  // simply broken the product.
  it('still lets the owning org update its own mirror', async () => {
    await assertSucceeds(updateDoc(doc(as('vic'), 'qr', 'tok-ext'), { status: 'Discharged' }))
    await assertSucceeds(updateDoc(doc(as('vic'), 'permitQr', 'tok-permit'), { storedStatus: 'approved' }))
  })

  it('still lets anyone scan one', async () => {
    await assertSucceeds(getDoc(doc(testEnv.unauthenticatedContext().firestore(), 'qr', 'tok-ext')))
  })
})

describe('LOTO documents cannot be captured by another tenant', () => {
  it('refuses rewriting another org\'s procedure into the attacker\'s org', async () => {
    await assertFails(updateDoc(doc(as('mal'), 'procedures', 'proc-1'), { orgId: ATTACKER }))
  })

  it('refuses editing it in place', async () => {
    await assertFails(updateDoc(doc(as('mal'), 'procedures', 'proc-1'), { title: 'Safe to work' }))
  })

  it('still lets the owner edit its own', async () => {
    await assertSucceeds(updateDoc(doc(as('vic'), 'procedures', 'proc-1'), { title: 'Line 2 isolation v2' }))
  })
})

describe('a member cannot widen their own reach', () => {
  it('refuses self-granting extra sites', async () => {
    await assertFails(updateDoc(doc(as('mem'), 'users', 'mem'), {
      access: { sites: ['site-1', 'site-2'], regions: ['South'], entities: [] },
    }))
  })

  it('refuses moving their own posting to another site', async () => {
    await assertFails(updateDoc(doc(as('mem'), 'users', 'mem'), { siteId: 'site-9' }))
  })

  it('refuses granting themselves a whole region', async () => {
    await assertFails(updateDoc(doc(as('mem'), 'users', 'mem'), {
      access: { sites: ['site-1'], regions: ['South'], entities: [] },
    }))
  })

  // They must still be able to edit the harmless parts of their own profile,
  // and to ASK for access — the request is not the grant.
  it('still lets them edit their own name', async () => {
    await assertSucceeds(updateDoc(doc(as('mem'), 'users', 'mem'), { name: 'Mem Renamed' }))
  })

  it('still lets them request access without granting it', async () => {
    await assertSucceeds(updateDoc(doc(as('mem'), 'users', 'mem'), {
      accessRequest: { sites: ['site-2'], regions: [], entities: [] },
    }))
  })

  it('still lets an admin grant access', async () => {
    await assertSucceeds(updateDoc(doc(as('vic'), 'users', 'mem'), {
      access: { sites: ['site-1', 'site-2'], regions: [], entities: [] },
    }))
  })
})

describe('a joiner cannot choose an elevated role', () => {
  it('refuses self-joining as a manager', async () => {
    await assertFails(setDoc(doc(as('newbie'), 'users', 'newbie'), {
      orgId: VICTIM, role: 'manager', status: 'pending', name: 'New', email: 'n@t.co',
    }))
  })

  it('refuses self-joining as an auditor', async () => {
    await assertFails(setDoc(doc(as('newbie'), 'users', 'newbie'), {
      orgId: VICTIM, role: 'auditor', status: 'pending', name: 'New', email: 'n@t.co',
    }))
  })

  it('still lets them join as a pending member', async () => {
    await assertSucceeds(setDoc(doc(as('newbie'), 'users', 'newbie'), {
      orgId: VICTIM, role: 'member', status: 'pending', name: 'New', email: 'n@t.co',
    }))
  })
})

// The create half of "a member cannot widen their own reach", above. Those
// tests only ever sent updateDoc, and the create rule pinned role and status
// but not access or siteId — so the whole escalation moved one step earlier and
// walked straight through a green suite. Approving a join flips `status` and
// nothing re-asserts what else the joiner wrote, so scope chosen at create is
// scope granted.
describe('a joiner cannot arrive with scope they granted themselves', () => {
  it('refuses joining with an access map', async () => {
    await assertFails(setDoc(doc(as('newbie'), 'users', 'newbie'), {
      orgId: VICTIM, role: 'member', status: 'pending', name: 'New', email: 'n@t.co',
      access: { sites: ['site-1', 'site-2'], regions: [], entities: [] },
    }))
  })

  it('refuses joining with a whole region', async () => {
    await assertFails(setDoc(doc(as('newbie'), 'users', 'newbie'), {
      orgId: VICTIM, role: 'member', status: 'pending', name: 'New', email: 'n@t.co',
      access: { sites: [], regions: ['South'], entities: [] },
    }))
  })

  it('refuses joining with a posted siteId', async () => {
    await assertFails(setDoc(doc(as('newbie'), 'users', 'newbie'), {
      orgId: VICTIM, role: 'member', status: 'pending', name: 'New', email: 'n@t.co',
      siteId: 'site-1',
    }))
  })

  // The shape every legitimate join path actually writes (createPendingMember
  // in src/shared/org/orgData.js) must still go through.
  it('still lets them join carrying an empty access map', async () => {
    await assertSucceeds(setDoc(doc(as('newbie'), 'users', 'newbie'), {
      orgId: VICTIM, role: 'member', status: 'pending', name: 'New', email: 'n@t.co',
      access: { sites: [], regions: [], entities: [] }, accessRequest: null,
    }))
  })

  // An admin provisioning an employee writes the same empty scope
  // (createOne in src/shared/auth/provisioning.js) and must not be blocked.
  it('still lets an admin provision an employee', async () => {
    await assertSucceeds(setDoc(doc(as('vic'), 'users', 'provisioned'), {
      orgId: VICTIM, role: 'member', status: 'approved', name: 'Prov', email: 'p@t.co',
      access: { sites: [], regions: [], entities: [] }, mustChangePassword: true,
    }))
  })

  it('refuses an admin provisioning one straight into another org', async () => {
    await assertFails(setDoc(doc(as('vic'), 'users', 'provisioned'), {
      orgId: ATTACKER, role: 'member', status: 'approved', name: 'Prov', email: 'p@t.co',
      access: { sites: [], regions: [], entities: [] },
    }))
  })
})

// Rules do not cascade into subcollections, so the manager grant on
// /illnesses/{id} stopped at the document and the attachments fell through to
// the generic recursive rule — which excludes col == 'illnesses' from reads.
// The result was a collection nobody at all could read, including the managers
// it exists for: subscribeIllnessFiles failed permission-denied for every role.
// It failed CLOSED, which is why it leaked nothing and why nothing caught it.
// One physical padlock is in one place. Uniqueness used to be checked inside
// the single procedure document the transaction had read, plus a list computed
// in the browser — so two operators on two DIFFERENT procedures both saw lock
// 12 free and both committed, with no contention for Firestore to detect.
// The lock number is now a document ID, which is contention it can see.
describe('a LOTO padlock cannot be claimed twice', () => {
  const claim = (lockNo) => `${VICTIM}__${lockNo}`

  it('lets the first claim through', async () => {
    await assertSucceeds(setDoc(doc(as('vic'), 'lockClaims', claim('12')), {
      orgId: VICTIM, lockNo: '12', procedureId: 'proc-1', equipment: 'Press 4',
    }))
  })

  it('refuses a second claim on the same padlock', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'lockClaims', claim('12')), {
        orgId: VICTIM, lockNo: '12', procedureId: 'proc-1', equipment: 'Press 4',
      })
    })
    // A different procedure trying to take the same padlock.
    await assertFails(setDoc(doc(as('vic'), 'lockClaims', claim('12')), {
      orgId: VICTIM, lockNo: '12', procedureId: 'proc-OTHER', equipment: 'Lathe 2',
    }))
  })

  it('still lets the holding procedure re-assert its own claim', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'lockClaims', claim('12')), {
        orgId: VICTIM, lockNo: '12', procedureId: 'proc-1', equipment: 'Press 4',
      })
    })
    await assertSucceeds(setDoc(doc(as('vic'), 'lockClaims', claim('12')), {
      orgId: VICTIM, lockNo: '12', procedureId: 'proc-1', equipment: 'Press 4', techName: 'Ravi',
    }))
  })

  // The claim id carries the org, so proving you own the org you NAMED is not
  // the same as proving you own the address you are writing at. Without the
  // id-to-payload binding, a stranger with a throwaway org could take out a
  // claim at a victim's lock number — and because readLockClaims does a tx.get
  // on that document inside the lock transaction, and the read rule keys off
  // the claim's own orgId, the victim could then neither read past it nor
  // delete it. Padlock permanently unusable, repeatable across every org in the
  // world-readable orgIndex.
  it('refuses a claim written at another org\'s lock address', async () => {
    await assertFails(setDoc(doc(as('mal'), 'lockClaims', claim('12')), {
      orgId: ATTACKER, lockNo: '12', procedureId: 'squat',
    }))
  })

  it('refuses it even from a member of the victim org naming the wrong org', async () => {
    await assertFails(setDoc(doc(as('vic'), 'lockClaims', `${ATTACKER}__12`), {
      orgId: VICTIM, lockNo: '12', procedureId: 'proc-1',
    }))
  })

  it('refuses another org taking over a live claim', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'lockClaims', claim('12')), {
        orgId: VICTIM, lockNo: '12', procedureId: 'proc-1',
      })
    })
    await assertFails(setDoc(doc(as('mal'), 'lockClaims', claim('12')), {
      orgId: ATTACKER, lockNo: '12', procedureId: 'proc-1',
    }))
  })

  it('lets a writer release one — a padlock outlives the shift that applied it', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'lockClaims', claim('12')), {
        orgId: VICTIM, lockNo: '12', procedureId: 'proc-1',
      })
    })
    await assertSucceeds(deleteDoc(doc(as('mem'), 'lockClaims', claim('12'))))
  })

  it('refuses the read-only auditor releasing one', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'lockClaims', claim('12')), {
        orgId: VICTIM, lockNo: '12', procedureId: 'proc-1',
      })
    })
    await assertFails(deleteDoc(doc(as('aud'), 'lockClaims', claim('12'))))
  })
})

// docSeq was given a monotonic rule because "a counter that can move BACKWARDS
// hands the next record an id already printed on a permit". The legacy refNo
// counters in /meta were left under the generic member rule and had no such
// protection — a one-line setDoc rewound the IRA- and ILL- sequences.
describe('reference-number counters cannot be rewound', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'organizations', VICTIM, 'meta', 'stats'), {
        nextSeq: 42, totalIncidents: 7,
      })
    })
  })

  it('refuses moving the sequence backwards', async () => {
    await assertFails(updateDoc(doc(as('mem'), 'organizations', VICTIM, 'meta', 'stats'), { nextSeq: 1 }))
  })

  it('still lets it move forwards', async () => {
    await assertSucceeds(updateDoc(doc(as('mem'), 'organizations', VICTIM, 'meta', 'stats'), { nextSeq: 43 }))
  })

  // Most writes here are stats deltas that never mention nextSeq. They must
  // still go through, which is why the rule reads the field with a default.
  it('still lets an unrelated stats delta through', async () => {
    await assertSucceeds(updateDoc(doc(as('mem'), 'organizations', VICTIM, 'meta', 'stats'), { totalIncidents: 8 }))
  })

  it('still refuses touching the keyset', async () => {
    await assertFails(setDoc(doc(as('mem'), 'organizations', VICTIM, 'meta', 'cryptoKeys'), { wrapped: 'x' }))
  })

  // Excluding `meta` from structuralOnly moved every grant on the collection
  // into the /meta/{kind} block — including the READ that genericReadable used
  // to refuse for the keyset. A read rule there without notKeyset does not keep
  // the old behaviour, it silently widens it. cryptoKeys.rules.test.js covers
  // this too; it is repeated here because this rule is what now decides it.
  it('still refuses READING the keyset', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'organizations', VICTIM, 'meta', 'cryptoKeys'), { wrapped: 'x' })
    })
    await assertFails(getDoc(doc(as('mem'), 'organizations', VICTIM, 'meta', 'cryptoKeys')))
    await assertFails(getDoc(doc(as('vic'), 'organizations', VICTIM, 'meta', 'cryptoKeys')))
    await assertFails(getDoc(doc(as('aud'), 'organizations', VICTIM, 'meta', 'cryptoKeys')))
  })

  // The permit number is the third counter, and the one printed on a piece of
  // paper somebody signs.
  it('refuses rewinding the permit sequence', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'organizations', VICTIM, 'meta', 'counters'), { permitSeq: 88 })
    })
    await assertFails(updateDoc(doc(as('mem'), 'organizations', VICTIM, 'meta', 'counters'), { permitSeq: 1 }))
  })

  it('still lets the permit sequence advance', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'organizations', VICTIM, 'meta', 'counters'), { permitSeq: 88 })
    })
    await assertSucceeds(updateDoc(doc(as('mem'), 'organizations', VICTIM, 'meta', 'counters'), { permitSeq: 89 }))
  })
})

// /moduleEntitlements existed, was operator-write-only, and was referenced by
// no rule at all — enforcement was React alone, so a member of an org whose
// module had been switched off could still read and write its collections
// straight from the SDK.
describe('module entitlements are enforced in the rules', () => {
  it('allows everything when the org has no entitlement document', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'organizations', VICTIM, 'permits', 'p1'), { title: 'Hot work' })
    })
    await assertSucceeds(getDoc(doc(as('mem'), 'organizations', VICTIM, 'permits', 'p1')))
  })

  it('refuses reading a collection whose module is switched off', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      await setDoc(doc(db, 'organizations', VICTIM, 'permits', 'p1'), { title: 'Hot work' })
      await setDoc(doc(db, 'moduleEntitlements', VICTIM), { ptw: false })
    })
    await assertFails(getDoc(doc(as('mem'), 'organizations', VICTIM, 'permits', 'p1')))
  })

  it('refuses writing to it too', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'moduleEntitlements', VICTIM), { ptw: false })
    })
    await assertFails(
      addDoc(collection(as('vic'), 'organizations', VICTIM, 'permits'), { title: 'Hot work' })
    )
  })

  // Absent key means enabled, so a module added to the registry later is on
  // until an operator turns it off.
  it('leaves modules the document does not mention enabled', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      await setDoc(doc(db, 'organizations', VICTIM, 'incidents', 'i1'), { title: 'real' })
      await setDoc(doc(db, 'moduleEntitlements', VICTIM), { ptw: false })
    })
    await assertSucceeds(getDoc(doc(as('mem'), 'organizations', VICTIM, 'incidents', 'i1')))
  })

  // Shared plumbing is not a module and must never be gated — a site registry
  // that goes dark takes every module with it.
  it('never gates the site registry', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      await setDoc(doc(db, 'organizations', VICTIM, 'sites', 's1'), { name: 'Hosur' })
      await setDoc(doc(db, 'moduleEntitlements', VICTIM), {
        ptw: false, incidents: false, hira: false,
      })
    })
    await assertSucceeds(getDoc(doc(as('mem'), 'organizations', VICTIM, 'sites', 's1')))
  })

  // Turning a module off must not trap the records already in it.
  it('still lets a manager delete from a disabled module', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      await setDoc(doc(db, 'organizations', VICTIM, 'permits', 'p1'), { title: 'Hot work' })
      await setDoc(doc(db, 'moduleEntitlements', VICTIM), { ptw: false })
    })
    await assertSucceeds(deleteDoc(doc(as('vic'), 'organizations', VICTIM, 'permits', 'p1')))
  })
})

describe('illness attachments are readable by managers and nobody else', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      await setDoc(doc(db, 'organizations', VICTIM, 'illnesses', 'ill-1'), { refNo: 'ILL-1' })
      await setDoc(doc(db, 'organizations', VICTIM, 'illnesses', 'ill-1', 'files', 'f1'), {
        name: 'gp-letter.pdf', path: `orgs/${VICTIM}/illness-files/abc`,
      })
    })
  })

  it('lets a manager read one', async () => {
    await assertSucceeds(getDoc(doc(as('vic'), 'organizations', VICTIM, 'illnesses', 'ill-1', 'files', 'f1')))
  })

  it('refuses a plain member', async () => {
    await assertFails(getDoc(doc(as('mem'), 'organizations', VICTIM, 'illnesses', 'ill-1', 'files', 'f1')))
  })

  // The auditor is an outside party: confirming illnesses are recorded does not
  // require reading a named colleague's GP letter.
  it('refuses the auditor', async () => {
    await assertFails(getDoc(doc(as('aud'), 'organizations', VICTIM, 'illnesses', 'ill-1', 'files', 'f1')))
  })

  it('refuses another org entirely', async () => {
    await assertFails(getDoc(doc(as('mal'), 'organizations', VICTIM, 'illnesses', 'ill-1', 'files', 'f1')))
  })
})

describe('auditor is read-only in the rules, not just in the UI', () => {
  it('refuses an auditor creating a record', async () => {
    await assertFails(
      addDoc(collection(as('aud'), 'organizations', VICTIM, 'incidents'), { title: 'invented' })
    )
  })

  it('refuses an auditor editing one', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'organizations', VICTIM, 'incidents', 'i1'), { title: 'real' })
    })
    await assertFails(
      updateDoc(doc(as('aud'), 'organizations', VICTIM, 'incidents', 'i1'), { title: 'edited' })
    )
  })

  it('still lets an auditor read everything they are there to inspect', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'organizations', VICTIM, 'incidents', 'i1'), { title: 'real' })
    })
    await assertSucceeds(getDoc(doc(as('aud'), 'organizations', VICTIM, 'incidents', 'i1')))
  })

  it('still lets a member write', async () => {
    await assertSucceeds(
      addDoc(collection(as('mem'), 'organizations', VICTIM, 'incidents'), { title: 'genuine' })
    )
  })
})

// Reproduction of the bulk Excel import: one batch writing the asset and its
// public QR mirror together, which is what bulkUpsertExtinguishers does.
describe('the extinguisher bulk import', () => {
  const ext = (token) => ({
    serialNo: 'S1', type: 'CO2', capacity: '5kg', entity: 'E', region: 'R',
    centerName: 'C', dateOfDeployment: '', dateOfNextRefill: '', dateOfNextHPT: '',
    status: 'active', physicalDefects: [], deletedAt: null, qrToken: token,
  })
  const mirror = (token, extId) => ({
    orgId: VICTIM, orgName: 'Victim Ltd', extId, token,
    serialNo: 'S1', type: 'CO2', capacity: '5kg', entity: 'E', region: 'R',
    centerName: 'C', dateOfDeployment: '', dateOfNextRefill: '', dateOfNextHPT: '',
    status: 'active', physicalDefects: [],
  })

  it('creates an asset and a fresh mirror in one batch, as an admin', async () => {
    const db = testEnv.authenticatedContext('vic').firestore()
    const batch = writeBatch(db)
    batch.set(doc(db, 'organizations', VICTIM, 'extinguishers', 'new1'), ext('tok-new'))
    batch.set(doc(db, 'qr', 'tok-new'), mirror('tok-new', 'new1'))
    await assertSucceeds(batch.commit())
  })

  it('does the same as an ordinary member, who runs the imports', async () => {
    const db = testEnv.authenticatedContext('mem').firestore()
    const batch = writeBatch(db)
    batch.set(doc(db, 'organizations', VICTIM, 'extinguishers', 'new2'), ext('tok-new2'))
    batch.set(doc(db, 'qr', 'tok-new2'), mirror('tok-new2', 'new2'))
    await assertSucceeds(batch.commit())
  })

  // The case the report describes: the spreadsheet carries a QR link for a code
  // already printed and already in the index, so the mirror write is an UPDATE.
  it('reuses a QR code the site already has printed', async () => {
    const db = testEnv.authenticatedContext('mem').firestore()
    const batch = writeBatch(db)
    batch.set(doc(db, 'organizations', VICTIM, 'extinguishers', 'new3'), ext('tok-ext'))
    batch.set(doc(db, 'qr', 'tok-ext'), mirror('tok-ext', 'new3'))
    await assertSucceeds(batch.commit())
  })
})

describe('bulk import — which half is refused', () => {
  it('the extinguisher document alone', async () => {
    const db = testEnv.authenticatedContext('vic').firestore()
    await assertSucceeds(setDoc(doc(db, 'organizations', VICTIM, 'extinguishers', 'solo1'), {
      serialNo: 'S1', type: 'CO2', capacity: '5kg', status: 'active', qrToken: 'tok-solo',
    }))
  })

  it('the qr mirror alone', async () => {
    const db = testEnv.authenticatedContext('vic').firestore()
    await assertSucceeds(setDoc(doc(db, 'qr', 'tok-solo'), {
      orgId: VICTIM, orgName: 'Victim Ltd', extId: 'solo1', token: 'tok-solo',
      serialNo: 'S1', type: 'CO2', status: 'active',
    }))
  })
})
